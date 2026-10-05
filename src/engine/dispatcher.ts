import { listActionsByStatus, listExecutedBetween, updateAction } from '@/db/repo-actions';
import { setActionStatus } from '@/db/repo-posts';
import { setRelationship, touchAuthorAction } from '@/db/repo-authors';
import { bumpMetric, dateKey } from '@/db/repo-metrics';
import { addEvent } from '@/db/repo-events';
import { engineStateItem, getSettings, patchSettings, selfHandleItem } from '@/shared/settings';
import { RETRY_DELAY_MS } from '@/shared/constants';
import { log } from '@/shared/log';
import { canDispatch } from './autonomy';
import { checkPacing, isWorkingHours } from './pacing';
import { resumeIfDue } from './anomaly-policy';
import type { Action, ActionType } from '@/shared/types';

// Диспетчер: берёт одно queued-действие, проверяет пейсинг, отдаёт исполнителю (content-скрипт), фиксирует результат.
// Исполнитель подставляется извне (background), чтобы движок оставался тестируемым без chrome.*.

export interface ExecResult {
  ok: boolean;
  verified: boolean;
  error?: string;
  resultUrl?: string;
  /** Сбой инфраструктуры (вкладка/порт), а не действия — не считается попыткой. */
  transient?: boolean;
}
export type Executor = (action: Action) => Promise<ExecResult>;


/** Начало текущего дня в TZ (по dateKey) — приближённо через поиск полуночи. */
function dayBounds(now: number, timezone: string): [number, number] {
  const key = dateKey(now, timezone);
  let start = now;
  while (dateKey(start - 60_000, timezone) === key) start -= 60_000;
  return [start, start + 86_400_000];
}

/** Действия, зависшие в «отправляется» (service worker уснул посреди отправки) → обратно в очередь. */
export async function recoverStuckExecuting(now = Date.now(), maxAgeMs = 4 * 60_000): Promise<number> {
  let n = 0;
  for (const a of await listActionsByStatus(['executing'], 200)) {
    if (!a.executingAt || now - a.executingAt > maxAgeMs) {
      await updateAction(a.id, { status: 'queued', error: 'отправка прервалась (фон уснул) — повтор', scheduledFor: now + 30_000 });
      n++;
    }
  }
  if (n) log('info', `recovered ${n} stuck executing actions`);
  return n;
}

/** Комментарии к постам старше maxPostAgeDays из очереди — в expired (поздно, выглядит странно). */
export async function expireStaleQueued(now = Date.now()): Promise<number> {
  const settings = await getSettings();
  const { getPost } = await import('@/db/repo-posts');
  const maxAge = settings.maxPostAgeDays * 86_400_000;
  let n = 0;
  for (const a of await listActionsByStatus(['queued', 'proposed'], 1000)) {
    if (a.type !== 'comment-on-stranger' || !a.targetPostId) continue;
    const p = await getPost(a.targetPostId);
    const ref = p?.postedAt ?? p?.firstSeenAt ?? a.createdAt;
    if (now - ref > maxAge) {
      await updateAction(a.id, { status: 'expired', rejectReason: 'пост старше недели — комментировать поздно', decidedAt: now });
      n++;
    }
  }
  if (n) log('info', `expired ${n} stale queued comments`);
  return n;
}

export async function dispatchOnce(execute: Executor, now = Date.now()): Promise<'idle' | 'executed' | 'deferred' | 'blocked'> {
  await recoverStuckExecuting(now);
  if (Math.random() < 0.1) await expireStaleQueued(now);
  let engine = resumeIfDue(await engineStateItem.getValue(), now);
  const settings = await getSettings();
  // «спал» вне рабочих часов — окно открылось, просыпаемся
  if (engine.status === 'sleeping' && isWorkingHours(now, settings)) engine = { ...engine, status: 'running' };
  await engineStateItem.setValue(engine);
  if (!canDispatch(engine, now)) return 'blocked';

  if (settings.rampUp && !settings.rampStartAt) await patchSettings({ rampStartAt: now });

  const queued = (await listActionsByStatus(['queued'], 300))
    .filter((a) => a.draftText || a.finalText)
    .filter((a) => !a.scheduledFor || a.scheduledFor <= now)
    // свои посты и ответы под ними — вперёд: у них свои лимиты, они не должны ждать за очередью комментариев чужим
    .sort((a, b) => priority(a.type) - priority(b.type) || (a.decidedAt ?? a.createdAt) - (b.decidedAt ?? b.createdAt));
  if (!queued.length) return 'idle';

  const [dayStart, dayEnd] = dayBounds(now, settings.timezone);
  const todayExecuted = await listExecutedBetween(dayStart, dayEnd);
  const lastAll = todayExecuted.reduce<number | undefined>((m, a) => Math.max(m ?? 0, a.executedAt ?? 0) || m, undefined);

  // идём по очереди: первое действие, которому пейсинг разрешает отправку сейчас (лимиты — по типам)
  let action: Action | undefined;
  const blockedTypes = new Set<ActionType>();
  for (const candidate of queued) {
    if (blockedTypes.has(candidate.type)) continue;
    const lastSame = todayExecuted.filter((a) => a.type === candidate.type).reduce<number | undefined>((m, a) => Math.max(m ?? 0, a.executedAt ?? 0) || m, undefined);
    const verdict = checkPacing({ settings, type: candidate.type, now, todayExecuted, lastExecutedAt: lastAll, lastExecutedSameTypeAt: lastSame });
    if (verdict.ok) {
      action = candidate;
      break;
    }
    if (verdict.reason === 'outside_hours') {
      if (engine.status === 'running') await engineStateItem.setValue({ ...engine, status: 'sleeping' });
      return 'deferred';
    }
    if (verdict.reason === 'daily_limit' || verdict.reason === 'same_type_gap') {
      blockedTypes.add(candidate.type);
      await updateAction(candidate.id, { scheduledFor: verdict.retryAt });
      continue;
    }
    // min_gap / session_pause — общие для всех типов: ждём
    await updateAction(candidate.id, { scheduledFor: verdict.retryAt });
    return 'deferred';
  }
  if (!action) return 'deferred';
  if (engine.status !== 'running') {
    await engineStateItem.setValue({ ...engine, status: 'running' });
  }

  await updateAction(action.id, { status: 'executing', attempts: action.attempts + 1, executingAt: now });
  const result = await execute({ ...action, finalText: action.finalText ?? action.draftText });
  await applyResult(action, result, now);
  return 'executed';
}

async function applyResult(action: Action, r: ExecResult, now: number): Promise<void> {
  const settings = await getSettings();
  const day = dateKey(now, settings.timezone);
  if (r.ok) {
    // серия неподтверждённых — в storage: service worker засыпает, переменная модуля обнуляется
    const st0 = await engineStateItem.getValue();
    const unverifiedStreak = r.verified ? 0 : (st0.unverifiedStreak ?? 0) + 1;
    await engineStateItem.setValue({ ...st0, unverifiedStreak });
    await updateAction(action.id, {
      status: 'done',
      executedAt: now,
      verifiedAt: r.verified ? now : undefined,
      verifyAfter: r.verified ? undefined : now + 15 * 60_000 + Math.round(Math.random() * 10 * 60_000),
      outcome: { ...action.outcome, verified: r.verified },
      error: r.verified ? undefined : 'не подтверждено на странице — перепроверю через 15–25 минут',
    });
    if (action.targetPostId) await setActionStatus(action.targetPostId, 'commented');
    await touchAuthorAction(action.targetHandle, now);
    if (action.type === 'comment-on-stranger') await setRelationship(action.targetHandle, 'commented');
    await bumpMetric(day, metricFor(action.type));
    await addEvent({ at: now, kind: 'action', message: `${action.type} → @${action.targetHandle}${r.verified ? '' : ' (не подтверждено)'}`, url: r.resultUrl ?? action.threadUrl });
    if (unverifiedStreak >= 3) {
      const { applyAnomaly } = await import('./anomaly-policy');
      const st = await engineStateItem.getValue();
      await engineStateItem.setValue({ ...applyAnomaly(st, { kind: 'unverified_streak', text: '3 подряд', url: action.threadUrl ?? '', at: now }, now), unverifiedStreak: 0 });
    }
    log('info', `done ${action.type} → @${action.targetHandle} verified=${r.verified}`);
    return;
  }
  if (r.transient) {
    // вкладка/порт — вернём в очередь, попытку не засчитываем
    await updateAction(action.id, { status: 'queued', error: r.error, attempts: action.attempts, scheduledFor: now + 60_000 });
    log('info', `${action.type} → @${action.targetHandle}: временный сбой (${r.error}), повтор через минуту`);
    return;
  }
  const retry = action.attempts + 1 < 2; // всего две попытки
  const delay = RETRY_DELAY_MS[0] + Math.random() * (RETRY_DELAY_MS[1] - RETRY_DELAY_MS[0]);
  await updateAction(action.id, {
    status: retry ? 'queued' : 'failed',
    error: r.error,
    scheduledFor: retry ? now + delay : undefined,
  });
  log('error', `${action.type} → @${action.targetHandle} failed (attempt ${action.attempts + 1}): ${r.error}`);
}

function priority(type: ActionType): number {
  switch (type) {
    case 'publish-post':
      return 0;
    case 'reply-own-post':
      return 1;
    case 'dm-continue':
      return 2;
    case 'reply-thread':
      return 3;
    default:
      return 4;
  }
}

function metricFor(type: ActionType): 'commentsSent' | 'repliesSent' | 'dmFirstSent' | 'dmContinueSent' | 'postsPublished' {
  switch (type) {
    case 'comment-on-stranger':
      return 'commentsSent';
    case 'reply-own-post':
    case 'reply-thread':
      return 'repliesSent';
    case 'dm-first':
      return 'dmFirstSent';
    case 'dm-continue':
      return 'dmContinueSent';
    case 'publish-post':
      return 'postsPublished';
  }
}

export type Verifier = (action: Action) => Promise<boolean | null>; // null — не смогли проверить (вкладка)

/** Повторная проверка неподтверждённых отправок (задача 3 из разбора): нашлось → done+verified, нет → failed. */
export async function reverifyOnce(verify: Verifier, now = Date.now()): Promise<'idle' | 'checked'> {
  const due = (await listActionsByStatus(['done'], 300)).filter(
    (a) => a.outcome.verified === false && !a.outcome.reverified && a.verifyAfter !== undefined && a.verifyAfter <= now && a.threadUrl,
  );
  const a = due[0];
  if (!a) return 'idle';
  const found = await verify(a);
  if (found === null) {
    await updateAction(a.id, { verifyAfter: now + 10 * 60_000 });
    return 'checked';
  }
  const settings = await getSettings();
  if (found) {
    await updateAction(a.id, { verifiedAt: now, outcome: { ...a.outcome, verified: true, reverified: true }, error: undefined });
    log('info', `reverify: ${a.type} → @${a.targetHandle} подтверждён`);
  } else {
    await updateAction(a.id, { status: 'failed', outcome: { ...a.outcome, reverified: true }, error: 'не найден на странице при повторной проверке — Threads не принял' });
    // не засчитываем в отправленное
    await bumpMetric(dateKey(a.executedAt ?? now, settings.timezone), metricFor(a.type), -1);
    if (a.targetPostId) await setActionStatus(a.targetPostId, 'skipped');
    log('error', `reverify: ${a.type} → @${a.targetHandle} НЕ найден — failed`);
  }
  return 'checked';
}

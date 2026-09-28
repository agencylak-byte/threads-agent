import { listActionsByStatus, listExecutedBetween, updateAction } from '@/db/repo-actions';
import { setActionStatus } from '@/db/repo-posts';
import { setRelationship, touchAuthorAction } from '@/db/repo-authors';
import { bumpMetric, dateKey } from '@/db/repo-metrics';
import { addEvent } from '@/db/repo-events';
import { engineStateItem, getSettings, patchSettings, selfHandleItem } from '@/shared/settings';
import { RETRY_DELAY_MS } from '@/shared/constants';
import { log } from '@/shared/log';
import { canDispatch } from './autonomy';
import { checkPacing } from './pacing';
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

let unverifiedStreak = 0;

/** Начало текущего дня в TZ (по dateKey) — приближённо через поиск полуночи. */
function dayBounds(now: number, timezone: string): [number, number] {
  const key = dateKey(now, timezone);
  let start = now;
  while (dateKey(start - 60_000, timezone) === key) start -= 60_000;
  return [start, start + 86_400_000];
}

export async function dispatchOnce(execute: Executor, now = Date.now()): Promise<'idle' | 'executed' | 'deferred' | 'blocked'> {
  let engine = resumeIfDue(await engineStateItem.getValue(), now);
  await engineStateItem.setValue(engine);
  if (!canDispatch(engine, now)) return 'blocked';

  const settings = await getSettings();
  if (settings.rampUp && !settings.rampStartAt) await patchSettings({ rampStartAt: now });

  const queued = (await listActionsByStatus(['queued'], 100))
    .filter((a) => a.draftText || a.finalText)
    .filter((a) => !a.scheduledFor || a.scheduledFor <= now)
    .sort((a, b) => (a.decidedAt ?? a.createdAt) - (b.decidedAt ?? b.createdAt));
  const action = queued[0];
  if (!action) return 'idle';

  const [dayStart, dayEnd] = dayBounds(now, settings.timezone);
  const todayExecuted = await listExecutedBetween(dayStart, dayEnd);
  const lastAll = todayExecuted.reduce<number | undefined>((m, a) => Math.max(m ?? 0, a.executedAt ?? 0) || m, undefined);
  const lastSame = todayExecuted.filter((a) => a.type === action.type).reduce<number | undefined>((m, a) => Math.max(m ?? 0, a.executedAt ?? 0) || m, undefined);

  const verdict = checkPacing({ settings, type: action.type, now, todayExecuted, lastExecutedAt: lastAll, lastExecutedSameTypeAt: lastSame });
  if (!verdict.ok) {
    await updateAction(action.id, { scheduledFor: verdict.retryAt });
    if (verdict.reason === 'outside_hours' && engine.status === 'running') {
      engine = { ...engine, status: 'sleeping' };
      await engineStateItem.setValue(engine);
    }
    return 'deferred';
  }
  if (engine.status !== 'running') {
    await engineStateItem.setValue({ ...engine, status: 'running' });
  }

  await updateAction(action.id, { status: 'executing', attempts: action.attempts + 1 });
  const result = await execute({ ...action, finalText: action.finalText ?? action.draftText });
  await applyResult(action, result, now);
  return 'executed';
}

async function applyResult(action: Action, r: ExecResult, now: number): Promise<void> {
  const settings = await getSettings();
  const day = dateKey(now, settings.timezone);
  if (r.ok) {
    unverifiedStreak = r.verified ? 0 : unverifiedStreak + 1;
    await updateAction(action.id, {
      status: 'done',
      executedAt: now,
      verifiedAt: r.verified ? now : undefined,
      outcome: { ...action.outcome, verified: r.verified },
      error: r.verified ? undefined : 'не подтверждено в DOM',
    });
    if (action.targetPostId) await setActionStatus(action.targetPostId, 'commented');
    await touchAuthorAction(action.targetHandle, now);
    if (action.type === 'comment-on-stranger') await setRelationship(action.targetHandle, 'commented');
    await bumpMetric(day, metricFor(action.type));
    await addEvent({ at: now, kind: 'action', message: `${action.type} → @${action.targetHandle}${r.verified ? '' : ' (не подтверждено)'}`, url: r.resultUrl ?? action.threadUrl });
    if (unverifiedStreak >= 3) {
      unverifiedStreak = 0;
      const { applyAnomaly } = await import('./anomaly-policy');
      const st = await engineStateItem.getValue();
      await engineStateItem.setValue(applyAnomaly(st, { kind: 'unverified_streak', text: '3 подряд', url: action.threadUrl ?? '', at: now }, now));
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

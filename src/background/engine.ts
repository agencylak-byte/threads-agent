import { ALARM_DAILY, ALARM_TICK, TICK_PERIOD_MIN } from '@/shared/constants';
import { setActivityHook, setCollectHook, setDispatchHook, tick } from '@/engine/scheduler';
import { dispatchOnce } from '@/engine/dispatcher';
import { isJobRunning, runJob } from './jobs';
import { executeInTab, initAnomalyHandling } from './executor';
import { dailyMetrics } from './daily';
import { broadcast } from './state';
import { engineStateItem } from '@/shared/settings';
import { log } from '@/shared/log';

// Движок: alarm раз в минуту → tick() (expire → classify → plan → draft → dispatch). Дневной alarm — метрики.

export function initEngine(): void {
  initAnomalyHandling();
  setDispatchHook(async () => {
    if (isJobRunning()) return; // не мешаем сбору
    // за один тик — не больше одного записывающего действия
    const r = await dispatchOnce(executeInTab);
    if (r === 'executed') broadcast('actions');
  });
  setActivityHook(async () => {
    if (isJobRunning()) return;
    const st = await engineStateItem.getValue();
    if (st.status !== 'running') return;
    await runJob({ kind: 'collect-activity' });
  });
  setCollectHook(async () => {
    if (isJobRunning()) return;
    await runJob({ kind: 'collect-all-keywords' });
  });
  browser.runtime.onInstalled.addListener(() => {
    // после обновления расширения пересоздаём дневной alarm на ночь (старый мог быть «через 5 минут»)
    void browser.alarms.clear(ALARM_DAILY).then(() => ensureAlarms());
    // и отпускаем отложенные повторы — новая сборка, пробуем сразу
    void import('@/db/repo-actions').then(async (r) => {
      for (const a of await r.listActionsByStatus(['queued'])) await r.updateAction(a.id, { scheduledFor: undefined });
    });
    void runMigrations().then(() => runMigrationRepropose()).then(() => runMigrationTimezone()).then(() => runMigrationAutoReply()).then(() => runMigrationPace()).then(() => runMigrationAutopilotComments()).then(() => runTick());
  });
  browser.runtime.onStartup.addListener(() => void ensureAlarms());
  void ensureAlarms();
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_TICK) void runTick();
    if (alarm.name === ALARM_DAILY) void dailyMetrics();
  });
}

async function ensureAlarms(): Promise<void> {
  const existing = await browser.alarms.get(ALARM_TICK);
  if (!existing) await browser.alarms.create(ALARM_TICK, { periodInMinutes: TICK_PERIOD_MIN, delayInMinutes: 0.2 });
  // Дневные метрики — ночью (04:10 по местному времени), чтобы не уводить вкладку, пока Лера работает.
  const daily = await browser.alarms.get(ALARM_DAILY);
  if (!daily) await browser.alarms.create(ALARM_DAILY, { periodInMinutes: 60 * 24, when: nextLocalTime(4, 10) });
}

/** Одноразовые миграции данных при обновлении расширения (флаг в storage). */
async function runMigrations(): Promise<void> {
  const { storage } = await import('wxt/utils/storage');
  const flag = storage.defineItem<boolean>('local:migration_commentscore_v1', { fallback: false });
  if (await flag.getValue()) return;
  const [{ resetClassificationWithoutRelevance }, { expireAllProposed }] = await Promise.all([import('@/db/repo-posts'), import('@/db/repo-actions')]);
  const posts = await resetClassificationWithoutRelevance();
  const actions = await expireAllProposed('переоценка по единому баллу «стоит комментировать»');
  await flag.setValue(true);
  log('info', `migration commentscore_v1: ${posts} постов на переоценку, ${actions} предложений снято`);
  broadcast('actions');
}

/** v2: снятые системой предложения не должны блокировать повторное предложение поста. */
async function runMigrationRepropose(): Promise<void> {
  const { storage } = await import('wxt/utils/storage');
  const flag = storage.defineItem<boolean>('local:migration_repropose_v1', { fallback: false });
  if (await flag.getValue()) return;
  const [{ resetActionStatus }, { purgeExpired, listActionsByStatus }] = await Promise.all([import('@/db/repo-posts'), import('@/db/repo-actions')]);
  const purged = await purgeExpired();
  const live = await listActionsByStatus(['proposed', 'approved', 'queued', 'executing', 'rejected', 'done'], 5000);
  const keep = new Set(live.map((a) => a.targetPostId).filter((x): x is string => !!x));
  const reset = await resetActionStatus(keep);
  await flag.setValue(true);
  log('info', `migration repropose_v1: удалено ${purged.length} снятых предложений, ${reset} постов возвращено на рассмотрение`);
  broadcast('actions');
  broadcast('state');
}

/** Автоответы под своими постами → автопилот (один раз; Лера попросила 29.09). */
async function runMigrationAutoReply(): Promise<void> {
  const { storage } = await import('wxt/utils/storage');
  const flag = storage.defineItem<boolean>('local:migration_autoreply_v1', { fallback: false });
  if (await flag.getValue()) return;
  const { autonomyItem } = await import('@/shared/settings');
  const cfg = await autonomyItem.getValue();
  await autonomyItem.setValue({ ...cfg, 'reply-own-post': 'auto' });
  await flag.setValue(true);
  log('info', 'migration autoreply_v1: reply-own-post → auto');
}

/** Комментарии чужим → автопилот (просьба Леры 29.09): предложенные с баллом ≥ autoCommentMin — в очередь. */
async function runMigrationAutopilotComments(): Promise<void> {
  const { storage } = await import('wxt/utils/storage');
  const flag = storage.defineItem<boolean>('local:migration_autopilot_comments_v1', { fallback: false });
  if (await flag.getValue()) return;
  const { dispatchUiRequest } = await import('./handlers');
  await dispatchUiRequest({ type: 'SET_AUTONOMY', actionType: 'comment-on-stranger', mode: 'auto' });
  await dispatchUiRequest({ type: 'SET_AUTONOMY', actionType: 'publish-post', mode: 'auto' });
  const { patchSettings, getSettings } = await import('@/shared/settings');
  const cur = await getSettings();
  await patchSettings({ autoPostsPerDay: Math.max(cur.autoPostsPerDay, 5), limits: { ...cur.limits, 'publish-post': Math.max(cur.limits['publish-post'], 10) } });
  await flag.setValue(true);
  log('info', 'migration autopilot_comments_v1: comment-on-stranger → auto');
}

/** Темп отправки по договорённости 29.09: 40–90 с (один раз в сохранённые настройки). */
async function runMigrationPace(): Promise<void> {
  const { storage } = await import('wxt/utils/storage');
  const flag = storage.defineItem<boolean>('local:migration_pace_v1', { fallback: false });
  if (await flag.getValue()) return;
  const { patchSettings } = await import('@/shared/settings');
  await patchSettings({ minGapSec: [40, 90], sameTypeGapSec: [60, 150], sessionSize: [4, 8], sessionPauseMin: [8, 20] });
  await flag.setValue(true);
  log('info', 'migration pace_v1: 40–90 с между отправками');
}

/** Таймзона → местная (один раз). Лера во Вьетнаме, а окно считалось по Москве. */
async function runMigrationTimezone(): Promise<void> {
  const { storage } = await import('wxt/utils/storage');
  const tzFlag = storage.defineItem<boolean>('local:migration_tz_local_v1', { fallback: false });
  if (!(await tzFlag.getValue())) {
    const { patchSettings, localTimezone } = await import('@/shared/settings');
    await patchSettings({ timezone: localTimezone() });
    // разбудить движок, если он «уснул» по московскому окну
    const st = await engineStateItem.getValue();
    if (st.status === 'sleeping') await engineStateItem.setValue({ ...st, status: 'running' });
    await tzFlag.setValue(true);
    log('info', `migration tz_local_v1: таймзона → ${localTimezone()}`);
  }
}

function nextLocalTime(hour: number, minute: number, now = new Date()): number {
  const t = new Date(now);
  t.setHours(hour, minute, 0, 0);
  if (t.getTime() <= now.getTime()) t.setDate(t.getDate() + 1);
  return t.getTime();
}

/** Тик вручную (после сбора, после запуска движка) — не ждать минуту. */
export async function runTick(): Promise<void> {
  try {
    await tick();
  } catch (e) {
    log('error', 'runTick', String(e));
  } finally {
    broadcast('actions');
    broadcast('state');
  }
}

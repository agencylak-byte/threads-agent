import { ALARM_DAILY, ALARM_TICK, TICK_PERIOD_MIN } from '@/shared/constants';
import { setDispatchHook, tick } from '@/engine/scheduler';
import { dispatchOnce } from '@/engine/dispatcher';
import { isJobRunning } from './jobs';
import { executeInTab, initAnomalyHandling } from './executor';
import { dailyMetrics } from './daily';
import { broadcast } from './state';
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
  browser.runtime.onInstalled.addListener(() => {
    // после обновления расширения пересоздаём дневной alarm на ночь (старый мог быть «через 5 минут»)
    void browser.alarms.clear(ALARM_DAILY).then(() => ensureAlarms());
    // и отпускаем отложенные повторы — новая сборка, пробуем сразу
    void import('@/db/repo-actions').then(async (r) => {
      for (const a of await r.listActionsByStatus(['queued'])) await r.updateAction(a.id, { scheduledFor: undefined });
    });
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

import { ALARM_DAILY, ALARM_TICK, TICK_PERIOD_MIN } from '@/shared/constants';
import { tick } from '@/engine/scheduler';
import { broadcast } from './state';
import { log } from '@/shared/log';

// Движок: alarm раз в минуту → tick(). Дневной alarm — метрики (сбор followers) в фазе 3.

export function initEngine(): void {
  browser.runtime.onInstalled.addListener(() => void ensureAlarms());
  browser.runtime.onStartup.addListener(() => void ensureAlarms());
  void ensureAlarms();
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_TICK) void runTick();
    if (alarm.name === ALARM_DAILY) void dailyHook?.();
  });
}

let dailyHook: (() => Promise<void>) | null = null;
export function setDailyHook(h: (() => Promise<void>) | null): void {
  dailyHook = h;
}

async function ensureAlarms(): Promise<void> {
  const existing = await browser.alarms.get(ALARM_TICK);
  if (!existing) await browser.alarms.create(ALARM_TICK, { periodInMinutes: TICK_PERIOD_MIN, delayInMinutes: 0.2 });
  const daily = await browser.alarms.get(ALARM_DAILY);
  if (!daily) await browser.alarms.create(ALARM_DAILY, { periodInMinutes: 60 * 24, delayInMinutes: 5 });
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

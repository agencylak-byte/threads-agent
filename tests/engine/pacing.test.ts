import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkPacing, dailyLimit, isWorkingHours, limitFactor, minutesInTz, readingPauseMs, typingDelayMs } from '@/engine/pacing';
import { applyAnomaly, resumeIfDue } from '@/engine/anomaly-policy';
import { dispatchOnce } from '@/engine/dispatcher';
import { DEFAULT_SETTINGS, engineStateItem, settingsItem } from '@/shared/settings';
import { resetDbForTests } from '@/db/db';
import { createAction, getAction, listActionsByStatus } from '@/db/repo-actions';
import type { Action } from '@/shared/types';

// 2026-09-25 — пятница. 12:00 МСК = 09:00 UTC.
const FRI_NOON_MSK = Date.UTC(2026, 8, 25, 9, 0);
const FRI_2330_MSK = Date.UTC(2026, 8, 25, 20, 30);
const SAT_NOON_MSK = Date.UTC(2026, 8, 26, 9, 0);
const seq = (...vals: number[]) => {
  let i = 0;
  return () => vals[i++ % vals.length]!;
};

function executed(type: Action['type'], executedAt: number): Action {
  return { id: crypto.randomUUID(), type, status: 'done', targetHandle: 'x', context: '', editedByHuman: false, createdAt: executedAt, executedAt, attempts: 1, dedupeKey: crypto.randomUUID(), autonomyMode: 'auto', outcome: {} };
}

describe('pacing: время и лимиты', () => {
  it('минуты и день недели в таймзоне', () => {
    expect(minutesInTz(FRI_NOON_MSK, 'Europe/Moscow')).toEqual({ minutes: 12 * 60, weekday: 5 });
    const msk = { ...DEFAULT_SETTINGS, timezone: 'Europe/Moscow' };
    expect(isWorkingHours(FRI_NOON_MSK, msk)).toBe(true);
    expect(isWorkingHours(FRI_2330_MSK, msk)).toBe(false);
  });

  it('ramp-up и выходные множат лимит', () => {
    const s = { ...DEFAULT_SETTINGS, timezone: 'Europe/Moscow', rampStartAt: FRI_NOON_MSK - 2 * 86_400_000 };
    expect(limitFactor(FRI_NOON_MSK, s)).toBeCloseTo(0.4);
    expect(dailyLimit('comment-on-stranger', FRI_NOON_MSK, s)).toBe(8);
    expect(limitFactor(FRI_NOON_MSK, { ...s, rampStartAt: FRI_NOON_MSK - 10 * 86_400_000 })).toBeCloseTo(0.7);
    expect(limitFactor(FRI_NOON_MSK, { ...s, rampStartAt: FRI_NOON_MSK - 30 * 86_400_000 })).toBe(1);
    expect(limitFactor(SAT_NOON_MSK, { ...DEFAULT_SETTINGS, timezone: 'Europe/Moscow', rampUp: false })).toBe(0.5);
  });
});

describe('pacing: checkPacing', () => {
  const s = { ...DEFAULT_SETTINGS, rampUp: false, timezone: 'Europe/Moscow' };
  it('вне окна — ждать начала окна', () => {
    const v = checkPacing({ settings: s, type: 'comment-on-stranger', now: FRI_2330_MSK, todayExecuted: [], rng: () => 0 });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('outside_hours');
  });
  it('дневной лимит по типу', () => {
    const today = Array.from({ length: 20 }, (_, i) => executed('comment-on-stranger', FRI_NOON_MSK - (i + 1) * 3_600_000));
    const v = checkPacing({ settings: s, type: 'comment-on-stranger', now: FRI_NOON_MSK, todayExecuted: today, rng: () => 0 });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('daily_limit');
    const other = checkPacing({ settings: s, type: 'reply-own-post', now: FRI_NOON_MSK, todayExecuted: today, lastExecutedAt: FRI_NOON_MSK - 3_600_000, rng: () => 0 });
    expect(other.ok).toBe(true);
  });
  it('минимальный интервал в диапазоне [90,240] с (rng=0 → 90 с, rng=1 → 240 с)', () => {
    const base = { settings: s, type: 'comment-on-stranger' as const, now: FRI_NOON_MSK, todayExecuted: [] };
    expect(checkPacing({ ...base, lastExecutedAt: FRI_NOON_MSK - 100_000, rng: () => 0 }).ok).toBe(true);
    const late = checkPacing({ ...base, lastExecutedAt: FRI_NOON_MSK - 100_000, rng: () => 1 });
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.retryAt).toBe(FRI_NOON_MSK - 100_000 + 240_000);
    const sameType = checkPacing({ ...base, lastExecutedAt: FRI_NOON_MSK - 300_000, lastExecutedSameTypeAt: FRI_NOON_MSK - 300_000, rng: () => 1 });
    expect(sameType.ok).toBe(false);
    if (!sameType.ok) expect(sameType.reason).toBe('same_type_gap');
  });
  it('после пачки из N действий — пауза сессии', () => {
    // rng: minGap→0 (90с), sessionSize→0 (3), sessionPause→0 (12 мин)
    const burst = [1, 2, 3].map((i) => executed('comment-on-stranger', FRI_NOON_MSK - i * 120_000));
    const v = checkPacing({ settings: s, type: 'comment-on-stranger', now: FRI_NOON_MSK, todayExecuted: burst, lastExecutedAt: FRI_NOON_MSK - 120_000, lastExecutedSameTypeAt: FRI_NOON_MSK - 500_000, rng: seq(0) });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('session_pause');
    const later = checkPacing({ settings: s, type: 'comment-on-stranger', now: FRI_NOON_MSK + 13 * 60_000, todayExecuted: burst, lastExecutedAt: FRI_NOON_MSK - 120_000, rng: seq(0) });
    expect(later.ok).toBe(true);
  });
  it('человекоподобные задержки в диапазонах', () => {
    expect(readingPauseMs(0, () => 0)).toBe(1600);
    expect(readingPauseMs(10_000, () => 1)).toBe(7200);
    expect(typingDelayMs(() => 0.5)).toBeGreaterThanOrEqual(60);
    expect(typingDelayMs(() => 0.5)).toBeLessThanOrEqual(140);
    expect(typingDelayMs(() => 0.01)).toBeGreaterThanOrEqual(300);
  });
});

describe('anomaly-policy', () => {
  const a = { kind: 'action_blocked' as const, text: 'x', url: 'u', at: FRI_NOON_MSK };
  it('6ч → 24ч → stop, пауза снимается по сроку', () => {
    const s1 = applyAnomaly({ status: 'running', anomalies24h: [] }, a, FRI_NOON_MSK);
    expect(s1.status).toBe('paused');
    expect(s1.pausedUntil).toBe(FRI_NOON_MSK + 6 * 3_600_000);
    const s2 = applyAnomaly(s1, a, FRI_NOON_MSK + 1000);
    expect(s2.pausedUntil).toBe(FRI_NOON_MSK + 1000 + 24 * 3_600_000);
    const s3 = applyAnomaly(s2, a, FRI_NOON_MSK + 2000);
    expect(s3.status).toBe('stopped');
    expect(resumeIfDue(s1, FRI_NOON_MSK + 7 * 3_600_000).status).toBe('running');
    expect(resumeIfDue(s1, FRI_NOON_MSK + 1000).status).toBe('paused');
    // старые аномалии (> суток) не считаются
    const s4 = applyAnomaly({ status: 'running', anomalies24h: [FRI_NOON_MSK - 2 * 86_400_000, FRI_NOON_MSK - 3 * 86_400_000] }, a, FRI_NOON_MSK);
    expect(s4.status).toBe('paused');
    expect(s4.anomalies24h).toHaveLength(1);
  });
});

describe('dispatcher', () => {
  beforeEach(async () => {
    await resetDbForTests();
    await settingsItem.setValue({ ...DEFAULT_SETTINGS, rampUp: false, timezone: 'Europe/Moscow' });
  });

  it('не запускает при stopped/paused/sleeping-вне-окна и переводит в sleeping вне окна', async () => {
    const exec = vi.fn(async () => ({ ok: true, verified: true }));
    await engineStateItem.setValue({ status: 'stopped', anomalies24h: [] });
    expect(await dispatchOnce(exec, FRI_NOON_MSK)).toBe('blocked');
    await engineStateItem.setValue({ status: 'paused', anomalies24h: [], pausedUntil: FRI_NOON_MSK + 1000 });
    expect(await dispatchOnce(exec, FRI_NOON_MSK)).toBe('blocked');
    await engineStateItem.setValue({ status: 'running', anomalies24h: [] });
    await createAction({ type: 'comment-on-stranger', targetHandle: 'u', targetPostId: 'u/post/1', context: '', dedupeKey: 'k', autonomyMode: 'auto', draftText: 'текст' });
    expect(await dispatchOnce(exec, FRI_2330_MSK)).toBe('deferred');
    expect((await engineStateItem.getValue()).status).toBe('sleeping');
    expect(exec).not.toHaveBeenCalled();
  });

  it('«спящий» движок просыпается, когда окно открылось, и отправляет', async () => {
    await engineStateItem.setValue({ status: 'sleeping', anomalies24h: [] });
    await settingsItem.setValue({ ...DEFAULT_SETTINGS, rampUp: false, timezone: 'Europe/Moscow', minGapSec: [0, 0], sameTypeGapSec: [0, 0] });
    await createAction({ type: 'comment-on-stranger', targetHandle: 'u', targetPostId: 'u/post/1', context: '', dedupeKey: 'k1', autonomyMode: 'auto', draftText: 'x' });
    const exec = vi.fn(async () => ({ ok: true, verified: true }));
    expect(await dispatchOnce(exec, FRI_NOON_MSK)).toBe('executed');
    expect((await engineStateItem.getValue()).status).toBe('running');
  });

  it('исполняет queued с текстом, фиксирует done/verified и лимит', async () => {
    await engineStateItem.setValue({ status: 'running', anomalies24h: [] });
    await settingsItem.setValue({ ...DEFAULT_SETTINGS, rampUp: false, timezone: 'Europe/Moscow', limits: { ...DEFAULT_SETTINGS.limits, 'comment-on-stranger': 1 }, minGapSec: [0, 0], sameTypeGapSec: [0, 0] });
    const a1 = await createAction({ type: 'comment-on-stranger', targetHandle: 'u', targetPostId: 'u/post/1', context: '', dedupeKey: 'k1', autonomyMode: 'auto', draftText: 'один' });
    const a2 = await createAction({ type: 'comment-on-stranger', targetHandle: 'v', targetPostId: 'v/post/2', context: '', dedupeKey: 'k2', autonomyMode: 'auto', draftText: 'два' });
    const exec = vi.fn(async () => ({ ok: true, verified: true, resultUrl: 'r' }));
    expect(await dispatchOnce(exec, FRI_NOON_MSK)).toBe('executed');
    expect(exec).toHaveBeenCalledTimes(1);
    const done = await getAction(a1.id);
    expect(done?.status).toBe('done');
    expect(done?.verifiedAt).toBe(FRI_NOON_MSK);
    // лимит 1/день → второе откладывается на завтра
    expect(await dispatchOnce(exec, FRI_NOON_MSK + 10_000)).toBe('deferred');
    expect((await getAction(a2.id))?.scheduledFor).toBeGreaterThan(FRI_NOON_MSK + 10_000);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('ошибка → retry до 2 попыток, потом failed', async () => {
    await engineStateItem.setValue({ status: 'running', anomalies24h: [] });
    await settingsItem.setValue({ ...DEFAULT_SETTINGS, rampUp: false, timezone: 'Europe/Moscow', minGapSec: [0, 0], sameTypeGapSec: [0, 0] });
    const a = await createAction({ type: 'comment-on-stranger', targetHandle: 'u', targetPostId: 'u/post/1', context: '', dedupeKey: 'k1', autonomyMode: 'auto', draftText: 'x' });
    const exec = vi.fn(async () => ({ ok: false, verified: false, error: 'boom' }));
    expect(await dispatchOnce(exec, FRI_NOON_MSK)).toBe('executed');
    let cur = await getAction(a.id);
    expect(cur?.status).toBe('queued');
    expect(cur?.attempts).toBe(1);
    expect(cur?.scheduledFor).toBeGreaterThan(FRI_NOON_MSK);
    await dispatchOnce(exec, cur!.scheduledFor! + 1);
    cur = await getAction(a.id);
    expect(cur?.status).toBe('failed');
    expect((await listActionsByStatus(['failed'])).length).toBe(1);
  });
});

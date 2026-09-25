import type { Settings } from '@/shared/settings';
import type { Action, ActionType } from '@/shared/types';

// Пейсинг — чистые функции. Решают: можно ли сейчас выполнить действие и когда следующий слот.
// Всё зависит от настроек и списка уже исполненных сегодня действий; rng подменяется в тестах.

export interface PacingInput {
  settings: Settings;
  type: ActionType;
  now: number;
  /** Исполненные действия за сегодня (executedAt в текущем дне TZ), плюс последнее исполненное вообще. */
  todayExecuted: Action[];
  lastExecutedAt?: number;
  lastExecutedSameTypeAt?: number;
  rng?: () => number;
}

export type PacingVerdict =
  | { ok: true }
  | { ok: false; reason: 'outside_hours' | 'daily_limit' | 'min_gap' | 'same_type_gap' | 'session_pause'; retryAt: number };

/** Минуты с полуночи в TZ настроек. */
export function minutesInTz(ts: number, timezone: string): { minutes: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(new Date(ts));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { minutes: hour * 60 + minute, weekday };
}

function parseHm(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function isWorkingHours(ts: number, s: Settings): boolean {
  const { minutes } = minutesInTz(ts, s.timezone);
  return minutes >= parseHm(s.workingHours.start) && minutes < parseHm(s.workingHours.end);
}

/** Множитель лимита: ramp-up по дням с запуска × выходные. */
export function limitFactor(ts: number, s: Settings): number {
  let f = 1;
  if (s.rampUp && s.rampStartAt) {
    const day = Math.floor((ts - s.rampStartAt) / 86_400_000) + 1;
    if (day <= 7) f *= 0.4;
    else if (day <= 14) f *= 0.7;
  }
  const { weekday } = minutesInTz(ts, s.timezone);
  if (weekday === 0 || weekday === 6) f *= s.weekendFactor;
  return f;
}

export function dailyLimit(type: ActionType, ts: number, s: Settings): number {
  return Math.max(0, Math.round(s.limits[type] * limitFactor(ts, s)));
}

function rand(rng: () => number, [min, max]: readonly [number, number]): number {
  return min + (max - min) * rng();
}

/** Следующее начало рабочего окна (сегодня или завтра) в виде timestamp — приближённо, с шагом в минуту. */
function nextWindowStart(ts: number, s: Settings): number {
  const { minutes } = minutesInTz(ts, s.timezone);
  const start = parseHm(s.workingHours.start);
  const delta = minutes < start ? start - minutes : 24 * 60 - minutes + start;
  return ts + delta * 60_000;
}

export function checkPacing(i: PacingInput): PacingVerdict {
  const rng = i.rng ?? Math.random;
  const s = i.settings;
  if (!isWorkingHours(i.now, s)) return { ok: false, reason: 'outside_hours', retryAt: nextWindowStart(i.now, s) + rand(rng, [0, 40]) * 60_000 };

  const sameType = i.todayExecuted.filter((a) => a.type === i.type);
  if (sameType.length >= dailyLimit(i.type, i.now, s)) {
    return { ok: false, reason: 'daily_limit', retryAt: nextWindowStart(i.now, s) };
  }

  if (i.lastExecutedAt) {
    const gap = rand(rng, s.minGapSec) * 1000;
    if (i.now - i.lastExecutedAt < gap) return { ok: false, reason: 'min_gap', retryAt: i.lastExecutedAt + gap };
  }
  if (i.lastExecutedSameTypeAt) {
    const gap = rand(rng, s.sameTypeGapSec) * 1000;
    if (i.now - i.lastExecutedSameTypeAt < gap) return { ok: false, reason: 'same_type_gap', retryAt: i.lastExecutedSameTypeAt + gap };
  }

  // сессии: после пачки из N действий — пауза M минут
  const sessionSize = Math.round(rand(rng, s.sessionSize));
  const recent = i.todayExecuted
    .map((a) => a.executedAt ?? 0)
    .filter(Boolean)
    .sort((a, b) => b - a);
  if (recent.length >= sessionSize) {
    const pauseMs = rand(rng, s.sessionPauseMin) * 60_000;
    const windowMs = sessionSize * s.minGapSec[1] * 1000 * 1.5;
    const inBurst = recent.slice(0, sessionSize).every((t) => i.now - t < windowMs);
    const lastT = recent[0]!;
    if (inBurst && i.now - lastT < pauseMs) return { ok: false, reason: 'session_pause', retryAt: lastT + pauseMs };
  }
  return { ok: true };
}

/** Человекоподобная задержка «на чтение» перед вводом: 2–6 с, пропорционально длине текста. */
export function readingPauseMs(textLength: number, rng: () => number = Math.random): number {
  const base = 2000 + Math.min(4000, textLength * 12);
  return Math.round(base * (0.8 + rng() * 0.4));
}

/** Задержка на символ при вводе: 60–140 мс, иногда пауза 300–900 мс («думает»). */
export function typingDelayMs(rng: () => number = Math.random): number {
  if (rng() < 0.04) return 300 + Math.round(rng() * 600);
  return 60 + Math.round(rng() * 80);
}

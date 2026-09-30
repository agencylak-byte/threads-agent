import { ANOMALY_PAUSE_MS } from '@/shared/constants';
import type { Anomaly, EngineState } from '@/shared/types';

// Реакция на аномалию — чистая функция над EngineState.
// 1-я за сутки → пауза 6 ч; 2-я → 24 ч; 3-я → stop (нужно ручное включение).

const DAY = 86_400_000;

export function applyAnomaly(state: EngineState, anomaly: Anomaly, now = Date.now()): EngineState {
  const recent = [...state.anomalies24h.filter((t) => now - t < DAY), now];
  const count = recent.length;
  if (count >= 3) {
    return { ...state, status: 'stopped', anomalies24h: recent, pausedUntil: undefined, pauseReason: `${label(anomaly)} — 3-я аномалия за сутки, движок остановлен` };
  }
  const pause = ANOMALY_PAUSE_MS[Math.min(count - 1, ANOMALY_PAUSE_MS.length - 1)]!;
  return { ...state, status: 'paused', anomalies24h: recent, pausedUntil: now + pause, pauseReason: label(anomaly) };
}

/** Пауза истекла → running. */
export function resumeIfDue(state: EngineState, now = Date.now()): EngineState {
  if (state.status === 'paused' && state.pausedUntil && state.pausedUntil <= now) {
    return { ...state, status: 'running', pausedUntil: undefined, pauseReason: undefined };
  }
  return state;
}

export function label(a: Anomaly): string {
  switch (a.kind) {
    case 'action_blocked':
      return 'Threads заблокировал действие';
    case 'rate_limited':
      return 'Threads просит повторить позже (слишком часто)';
    case 'captcha':
      return 'капча';
    case 'login_redirect':
      return 'выкинуло на страницу входа';
    case 'challenge':
      return 'проверка аккаунта (challenge)';
    case 'unverified_streak':
      return 'три отправки подряд не подтвердились в DOM';
    case 'selectors_broken':
      return 'селекторы Threads не находят элементы';
    case 'http_429':
      return 'HTTP 429 от Threads';
    case 'load_error':
      return 'экран «Произошла ошибка» не уходит после повтора и перезагрузки';
  }
}

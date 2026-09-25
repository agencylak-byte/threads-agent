import type { ActionStatus, ActionType, AutonomyConfig, AutonomyMode, EngineState } from '@/shared/types';
import { AUTO_NEEDS_CONFIRM } from '@/shared/constants';

// Автономность: какой статус получает новое действие и что движку можно делать в текущем состоянии.

export function initialStatus(mode: AutonomyMode): Extract<ActionStatus, 'proposed' | 'queued'> | null {
  if (mode === 'off') return null;
  return mode === 'auto' ? 'queued' : 'proposed';
}

export function modeFor(cfg: AutonomyConfig, type: ActionType): AutonomyMode {
  return cfg[type] ?? 'suggest';
}

/** 'auto' для чувствительных типов допустим только если это явно подтверждено (UI спрашивает confirm). */
export function isSensitiveAuto(type: ActionType, mode: AutonomyMode): boolean {
  return mode === 'auto' && AUTO_NEEDS_CONFIRM.includes(type);
}

/** Чтение/классификация/черновики разрешены во всех состояниях, кроме stopped. */
export function canPrepare(engine: EngineState): boolean {
  return engine.status !== 'stopped';
}

/** Записывающие действия — только в running (не paused, не sleeping, не stopped). */
export function canDispatch(engine: EngineState, now = Date.now()): boolean {
  if (engine.status !== 'running') return false;
  if (engine.pausedUntil && engine.pausedUntil > now) return false;
  return true;
}

import type { Action } from '@/shared/types';

// Исполнение действий в DOM — фаза 3. Пока честно отвечаем «не реализовано», чтобы SW не ретраил.
export interface ExecResult {
  ok: boolean;
  verified: boolean;
  error?: string;
  resultUrl?: string;
}

export async function executeAction(_action: Action, _selfHandle: string, _likeBefore: boolean): Promise<ExecResult> {
  return { ok: false, verified: false, error: 'Исполнение действий появится в фазе 3' };
}

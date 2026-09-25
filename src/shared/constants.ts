import type { ActionType, AutonomyConfig } from './types';

export const DB_NAME = 'threads-agent';
export const DB_VERSION = 1;

export const THREADS_ORIGIN = 'https://www.threads.com';

export const ACTION_TYPES: readonly ActionType[] = [
  'comment-on-stranger',
  'reply-own-post',
  'reply-thread',
  'dm-first',
  'dm-continue',
  'publish-post',
] as const;

export const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  'comment-on-stranger': 'Комментарий к чужому посту',
  'reply-own-post': 'Ответ под своим постом',
  'reply-thread': 'Ответ в треде',
  'dm-first': 'Первое сообщение в личку',
  'dm-continue': 'Продолжение переписки',
  'publish-post': 'Публикация поста',
};

/** Дневные лимиты по умолчанию (safety envelope). */
export const DEFAULT_LIMITS: Record<ActionType, number> = {
  'comment-on-stranger': 20,
  'reply-own-post': 40,
  'reply-thread': 20,
  'dm-first': 10,
  'dm-continue': 30,
  'publish-post': 3,
};

/** Все действия стартуют в режиме «предложить»; auto включается вручную. */
export const DEFAULT_AUTONOMY: AutonomyConfig = {
  'comment-on-stranger': 'suggest',
  'reply-own-post': 'suggest',
  'reply-thread': 'suggest',
  'dm-first': 'suggest',
  'dm-continue': 'suggest',
  'publish-post': 'suggest',
};

/** Действия, для которых 'auto' требует явного подтверждения в UI. */
export const AUTO_NEEDS_CONFIRM: readonly ActionType[] = ['publish-post', 'dm-first'];

export const DEFAULT_MODEL = 'google/gemini-3.8-flash';
export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

export const ALARM_TICK = 'engine-tick';
export const ALARM_DAILY = 'daily-metrics';
export const TICK_PERIOD_MIN = 1;

export const PORT_NAME = 'threads-agent-content';

export const PROPOSAL_TTL_MS = 48 * 60 * 60 * 1000;
export const RETRY_DELAY_MS: [number, number] = [30 * 60 * 1000, 60 * 60 * 1000];

/** Пауза после аномалии: 1-я → 6 ч, 2-я за сутки → 24 ч, 3-я → стоп. */
export const ANOMALY_PAUSE_MS = [6 * 60 * 60 * 1000, 24 * 60 * 60 * 1000] as const;

export const DRAFT_MAX_CHARS: Record<ActionType, number> = {
  'comment-on-stranger': 280,
  'reply-own-post': 320,
  'reply-thread': 320,
  'dm-first': 500,
  'dm-continue': 500,
  'publish-post': 500,
};

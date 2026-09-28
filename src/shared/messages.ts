import type {
  Action,
  ActionStatus,
  ActionType,
  Anomaly,
  AutonomyMode,
  EngineState,
  ObservedPost,
  ObservedProfile,
  ObservedReply,
} from './types';
import type { Settings } from './settings';
import type { QuestionnaireAnswers, VoiceProfile } from '@/profile/voice-profile';

// Единый контракт сообщений. Три направления:
//   content → SW (через порт), SW → content (через порт), UI ↔ SW (runtime.sendMessage с ответом).

export type CollectMode = 'feed' | 'search' | 'thread' | 'followers' | 'profile' | 'activity' | 'self';

export interface CollectParams {
  mode: CollectMode;
  source: ObservedPost['source'];
  sourceDetail?: string;
  maxPosts: number;
  scrollPauseMs: [number, number];
  /** followers: сколько handle'ов собрать. */
  maxHandles?: number;
}

export type ContentToSw =
  | { type: 'PAGE_READY'; url: string; selfHandle?: string }
  | { type: 'POSTS_OBSERVED'; posts: ObservedPost[]; pageUrl: string }
  | { type: 'PROFILE_OBSERVED'; profile: ObservedProfile }
  | { type: 'THREAD_OBSERVED'; root: ObservedPost; replies: ObservedReply[] }
  | { type: 'HANDLES_OBSERVED'; handles: string[]; sourceDetail: string }
  | { type: 'COLLECT_DONE'; mode: CollectMode; count: number }
  | { type: 'ACTION_RESULT'; actionId: string; ok: boolean; verified: boolean; error?: string; resultUrl?: string; debugHtml?: string }
  | { type: 'ANOMALY'; anomaly: Anomaly }
  | { type: 'SELFTEST_RESULT'; page: string; broken: string[] }
  | { type: 'PAGE_DUMP'; page: string; html: string };

export type SwToContent =
  | { type: 'NAVIGATE'; url: string }
  | { type: 'COLLECT'; params: CollectParams }
  | { type: 'EXECUTE_ACTION'; action: Action; selfHandle: string; likeBefore: boolean }
  | { type: 'RUN_SELFTEST' }
  | { type: 'DUMP_PAGE' };

export type JobKind = 'collect-keyword' | 'collect-competitor' | 'collect-feed' | 'collect-self' | 'collect-activity' | 'collect-voice-source';

export interface JobRequest {
  kind: JobKind;
  /** ключевое слово или handle конкурента; для feed/self не нужен */
  param?: string;
}

export interface StateSnapshot {
  engine: EngineState;
  selfHandle: string;
  counts: { posts: number; authors: number; proposed: number; queued: number; done: number; events: number };
  currentJob: JobRequest | null;
  lastSelftest?: { page: string; broken: string[]; at: number };
  todayCost: number;
  hasApiKey: boolean;
  profileVersion: number | null;
}

/** Запросы UI → SW и типы их ответов. */
export interface UiRequests {
  GET_STATE: { req: Record<string, never>; res: StateSnapshot };
  LIST_ACTIONS: { req: { status: ActionStatus[]; limit?: number }; res: Action[] };
  APPROVE: { req: { actionId: string; text?: string }; res: { ok: boolean } };
  REJECT: { req: { actionId: string; reason?: string; notMyVoice?: boolean }; res: { ok: boolean } };
  REGENERATE: { req: { actionId: string; hint?: string }; res: { ok: boolean; draftText?: string; error?: string } };
  RETRY_ACTION: { req: { actionId: string }; res: { ok: boolean } };
  SET_AUTONOMY: { req: { type: ActionType; mode: AutonomyMode }; res: { ok: boolean } };
  GET_SETTINGS: { req: Record<string, never>; res: { settings: Settings; hasApiKey: boolean } };
  SET_SETTINGS: { req: { patch: Partial<Settings>; apiKey?: string }; res: { settings: Settings } };
  START_JOB: { req: JobRequest; res: { ok: boolean; error?: string } };
  STOP_JOB: { req: Record<string, never>; res: { ok: boolean } };
  ENGINE: { req: { command: 'start' | 'stop' | 'resume' }; res: EngineState };
  EXPORT_CSV: { req: { store: 'posts' | 'authors' | 'actions' | 'events' | 'metrics_daily' | 'own_posts' }; res: { ok: boolean; error?: string } };
  VERIFY_MODEL: { req: Record<string, never>; res: { ok: boolean; model?: string; error?: string } };
  RUN_SELFTEST: { req: Record<string, never>; res: { ok: boolean; broken?: string[]; error?: string } };
  DUMP_PAGE: { req: Record<string, never>; res: { ok: boolean; filename?: string; error?: string } };
  GET_PROFILE: { req: Record<string, never>; res: { profile: VoiceProfile; questionnaire: QuestionnaireAnswers | null } };
  SAVE_QUESTIONNAIRE: { req: { answers: QuestionnaireAnswers }; res: { profile: VoiceProfile } };
  LEARN_VOICE: {
    req: { postIds?: string[]; extraTexts?: string[]; skipCollect?: boolean };
    res: { ok: boolean; error?: string; samplesCount?: number };
  };
  LIST_VOICE_SAMPLES: { req: Record<string, never>; res: { handle: string; posts: Array<{ id: string; text: string; postedAt?: number }> } };
  GENERATE_POST: { req: { topic?: string }; res: { ok: boolean; error?: string } };
  OPEN_URL: { req: { url: string }; res: { ok: boolean } };
}

export type UiRequestType = keyof UiRequests;
export type UiRequest = { [K in UiRequestType]: { type: K } & UiRequests[K]['req'] }[UiRequestType];
export type UiResponse<K extends UiRequestType> = UiRequests[K]['res'];

export type SwToUi = { type: 'STATE_CHANGED'; what: 'state' | 'actions' | 'settings' | 'profile' };

/** Типизированная отправка запроса из UI в service worker. */
export async function request<K extends UiRequestType>(
  type: K,
  req: UiRequests[K]['req'],
): Promise<UiResponse<K>> {
  const res = (await browser.runtime.sendMessage({ type, ...req })) as UiResponse<K> | { __error: string };
  if (res && typeof res === 'object' && '__error' in res) throw new Error(res.__error);
  return res as UiResponse<K>;
}

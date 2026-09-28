// Доменные типы. Время — epoch ms (number), чтобы индексы IndexedDB сортировались без сюрпризов.

export type PostSource = 'keyword' | 'competitor' | 'feed' | 'thread' | 'own' | 'activity';

export interface PostAi {
  lprScore: number; // 0..100 — насколько автор похож на ЛПР/эксперта-заказчика
  niche: string;
  isFreelancer: boolean;
  reason: string;
  model: string;
  at: number;
}

export type PostActionStatus = 'none' | 'proposed' | 'commented' | 'skipped';

/** То, что content-script видит на странице. Ключ поста — `${handle}/post/${code}`. */
export interface ObservedPost {
  id: string;
  url: string;
  code: string;
  authorHandle: string;
  authorName?: string;
  authorBioSnapshot?: string;
  authorFollowersSnapshot?: number;
  text: string;
  likes: number;
  replies: number;
  reposts: number;
  postedAt?: number;
  isReplyTo?: string; // id корневого поста, если это ответ
  source: PostSource;
  sourceDetail?: string; // ключевое слово / handle конкурента / url треда
}

export interface Post extends ObservedPost {
  firstSeenAt: number;
  lastSeenAt: number;
  seenCount: number;
  ai?: PostAi;
  actionStatus: PostActionStatus;
}

export type Relationship =
  | 'stranger'
  | 'commented'
  | 'replied_us'
  | 'dm_open'
  | 'lead'
  | 'client'
  | 'do_not_contact';

export interface Author {
  handle: string;
  displayName?: string;
  bio?: string;
  followers?: number;
  isVerified?: boolean;
  lastSeenAt: number;
  lprScoreMax?: number;
  niche?: string;
  tags: string[];
  relationship: Relationship;
  lastActionAt?: number;
  notes?: string;
}

export type ActionType =
  | 'comment-on-stranger'
  | 'reply-own-post'
  | 'reply-thread'
  | 'dm-first'
  | 'dm-continue'
  | 'publish-post';

export type ActionStatus =
  | 'proposed'
  | 'approved'
  | 'rejected'
  | 'queued'
  | 'executing'
  | 'done'
  | 'failed'
  | 'expired';

export type AutonomyMode = 'off' | 'suggest' | 'auto';
export type AutonomyConfig = Record<ActionType, AutonomyMode>;

export interface LlmUsage {
  model: string;
  promptVersion: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export interface ActionOutcome {
  replyReceivedAt?: number;
  followedAt?: number;
  leadAt?: number;
  verified?: boolean;
}

export interface Action {
  id: string;
  type: ActionType;
  status: ActionStatus;
  targetPostId?: string;
  targetHandle: string;
  threadUrl?: string;
  parentCommentId?: string;
  /** Что видела модель: текст поста/треда, bio — для карточки в очереди и для regenerate. */
  context: string;
  draftText?: string;
  finalText?: string;
  editedByHuman: boolean;
  createdAt: number;
  proposedAt?: number;
  decidedAt?: number;
  scheduledFor?: number;
  executedAt?: number;
  verifiedAt?: number;
  error?: string;
  rejectReason?: string;
  /** Попытки исполнения в DOM (не путать с попытками написать черновик). */
  attempts: number;
  draftAttempts?: number;
  dedupeKey: string;
  autonomyMode: AutonomyMode;
  llm?: LlmUsage;
  outcome: ActionOutcome;
}

export type DmStage = 'first_sent' | 'awaiting' | 'replied' | 'qualifying' | 'lead' | 'closed' | 'ignored';

export interface DmMessage {
  dir: 'in' | 'out';
  text: string;
  at: number;
  actionId?: string;
}

export interface DmThread {
  handle: string;
  threadUrl?: string;
  stage: DmStage;
  messages: DmMessage[];
  lastInboundAt?: number;
  lastOutboundAt?: number;
  unread: boolean;
  summary?: string;
}

export interface OwnPost {
  id: string;
  url: string;
  text: string;
  publishedAt?: number;
  likes: number;
  replies: number;
  reposts: number;
  lastRefreshedAt: number;
  actionId?: string;
  usedForVoice: boolean;
}

export interface MetricsDaily {
  date: string; // YYYY-MM-DD в TZ настроек
  followers?: number;
  following?: number;
  commentsSent: number;
  repliesSent: number;
  dmFirstSent: number;
  dmContinueSent: number;
  postsPublished: number;
  repliesReceived: number;
  dmRepliesReceived: number;
  leads: number;
  likesOnOwnPosts?: number;
  llmCostUsd: number;
}

export type EventKind = 'anomaly' | 'info' | 'error' | 'selftest' | 'voice_feedback' | 'action';

export interface EventRecord {
  id?: number;
  at: number;
  kind: EventKind;
  message: string;
  payload?: unknown;
  url?: string;
}

export interface SyncOutboxItem {
  id?: number;
  store: string;
  recordId: string;
  at: number;
}

export type AnomalyKind =
  | 'action_blocked'
  | 'rate_limited'
  | 'captcha'
  | 'login_redirect'
  | 'challenge'
  | 'unverified_streak'
  | 'selectors_broken'
  | 'http_429';

export interface Anomaly {
  kind: AnomalyKind;
  text: string;
  url: string;
  at: number;
}

export type EngineStatus = 'stopped' | 'running' | 'paused' | 'sleeping';

export interface EngineState {
  status: EngineStatus;
  pausedUntil?: number;
  pauseReason?: string;
  anomalies24h: number[]; // timestamps
  startedAt?: number;
  lastTickAt?: number;
}

export interface ObservedProfile {
  handle: string;
  displayName?: string;
  bio?: string;
  followers?: number;
  isSelf: boolean;
}

export interface ObservedReply {
  post: ObservedPost;
  parentId: string;
}

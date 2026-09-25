// Единый порядок колонок для CSV сейчас и для листов Google Sheets в фазе 5.
// Вложенные поля сплющиваются через подчёркивание (ai_lprScore, outcome_leadAt).

export type ExportStore = 'posts' | 'authors' | 'actions' | 'events' | 'metrics_daily' | 'own_posts';

export const COLUMNS: Record<ExportStore, string[]> = {
  posts: [
    'id', 'url', 'authorHandle', 'authorName', 'authorFollowersSnapshot', 'authorBioSnapshot',
    'text', 'likes', 'replies', 'reposts', 'postedAt', 'firstSeenAt', 'lastSeenAt', 'seenCount',
    'source', 'sourceDetail', 'isReplyTo',
    'ai_lprScore', 'ai_niche', 'ai_isFreelancer', 'ai_reason', 'ai_model', 'ai_at',
    'actionStatus',
  ],
  authors: [
    'handle', 'displayName', 'bio', 'followers', 'isVerified', 'lastSeenAt', 'lprScoreMax', 'niche',
    'tags', 'relationship', 'lastActionAt', 'notes',
  ],
  actions: [
    'id', 'type', 'status', 'targetHandle', 'targetPostId', 'threadUrl', 'parentCommentId',
    'draftText', 'finalText', 'editedByHuman', 'createdAt', 'proposedAt', 'decidedAt', 'scheduledFor',
    'executedAt', 'verifiedAt', 'attempts', 'error', 'rejectReason', 'dedupeKey', 'autonomyMode',
    'llm_model', 'llm_promptVersion', 'llm_tokensIn', 'llm_tokensOut', 'llm_costUsd',
    'outcome_replyReceivedAt', 'outcome_followedAt', 'outcome_leadAt', 'outcome_verified', 'context',
  ],
  events: ['id', 'at', 'kind', 'message', 'url', 'payload'],
  metrics_daily: [
    'date', 'followers', 'following', 'commentsSent', 'repliesSent', 'dmFirstSent', 'dmContinueSent',
    'postsPublished', 'repliesReceived', 'dmRepliesReceived', 'leads', 'likesOnOwnPosts', 'llmCostUsd',
  ],
  own_posts: ['id', 'url', 'text', 'publishedAt', 'likes', 'replies', 'reposts', 'lastRefreshedAt', 'actionId', 'usedForVoice'],
};

const TIME_COLUMNS = new Set([
  'postedAt', 'firstSeenAt', 'lastSeenAt', 'ai_at', 'lastActionAt', 'createdAt', 'proposedAt', 'decidedAt',
  'scheduledFor', 'executedAt', 'verifiedAt', 'outcome_replyReceivedAt', 'outcome_followedAt', 'outcome_leadAt',
  'at', 'lastRefreshedAt', 'publishedAt',
]);

/** Плоская строка по колонкам: вложенные объекты — через `_`, массивы — через `; `, время — ISO. */
export function flattenRecord(record: Record<string, unknown>, columns: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const col of columns) {
    const value = col.includes('_') ? getNested(record, col) : record[col];
    out[col] = formatCell(col, value);
  }
  return out;
}

function getNested(record: Record<string, unknown>, col: string): unknown {
  if (col in record) return record[col];
  const [head, ...rest] = col.split('_');
  const inner = record[head as string];
  if (inner && typeof inner === 'object' && rest.length) return (inner as Record<string, unknown>)[rest.join('_')];
  return undefined;
}

function formatCell(col: string, value: unknown): string {
  if (value === undefined || value === null) return '';
  if (TIME_COLUMNS.has(col) && typeof value === 'number') return new Date(value).toISOString();
  if (Array.isArray(value)) return value.map(String).join('; ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

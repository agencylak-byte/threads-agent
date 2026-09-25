import type { Action, Author, Post } from '@/shared/types';

// Правила «не повторять» — чистые функции, без БД. Данные подаёт planner.

export interface CommentGate {
  post: Post;
  author?: Author;
  selfHandle: string;
  /** Все действия, адресованные этому автору (любой статус). */
  authorActions: Action[];
  existingKeys: Set<string>;
  dedupeKey: string;
  authorCooldownDays: number;
  maxPostAgeDays: number;
  now?: number;
}

const BLOCKED_RELATIONSHIPS = new Set<Author['relationship']>(['do_not_contact', 'client', 'lead', 'dm_open']);

export function commentAllowed(g: CommentGate): { ok: true } | { ok: false; reason: string } {
  const now = g.now ?? Date.now();
  if (g.post.authorHandle === g.selfHandle) return { ok: false, reason: 'свой пост' };
  if (g.existingKeys.has(g.dedupeKey)) return { ok: false, reason: 'уже есть действие по этому посту' };
  if (g.post.ai?.isFreelancer) return { ok: false, reason: 'автор — исполнитель, не ЛПР' };
  if (g.author && BLOCKED_RELATIONSHIPS.has(g.author.relationship)) return { ok: false, reason: `отношение: ${g.author.relationship}` };
  const ageRef = g.post.postedAt ?? g.post.firstSeenAt;
  if (now - ageRef > g.maxPostAgeDays * 86_400_000) return { ok: false, reason: `пост старше ${g.maxPostAgeDays} дн.` };
  const cooldownMs = g.authorCooldownDays * 86_400_000;
  const recent = g.authorActions.find(
    (a) =>
      a.type === 'comment-on-stranger' &&
      a.status !== 'rejected' &&
      a.status !== 'expired' &&
      a.status !== 'failed' &&
      now - (a.executedAt ?? a.createdAt) < cooldownMs,
  );
  if (recent) return { ok: false, reason: `автору уже комментировали за последние ${g.authorCooldownDays} дн.` };
  return { ok: true };
}

/** Черновик считается дублем, если его первые N символов совпадают с одним из недавних. */
export function openerDuplicate(text: string, recentOpeners: string[], chars = 40): boolean {
  const head = norm(text).slice(0, chars);
  if (head.length < 12) return false;
  return recentOpeners.some((o) => norm(o).slice(0, chars) === head);
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

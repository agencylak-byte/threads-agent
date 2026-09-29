import { listCandidates, setActionStatus, listRecentPosts } from '@/db/repo-posts';
import { getAuthor } from '@/db/repo-authors';
import { createAction, DuplicateActionError, hasActionWithKey, listActionsByTargetHandle, makeDedupeKey } from '@/db/repo-actions';
import { commentAllowed } from './dedupe';
import { initialStatus, modeFor } from './autonomy';
import { log } from '@/shared/log';
import type { Settings } from '@/shared/settings';
import type { Action, AutonomyConfig, Post } from '@/shared/types';

// Планировщик: из классифицированных постов и событий → новые Action (без текста; текст пишет draft-шаг).

export interface PlanContext {
  settings: Settings;
  autonomy: AutonomyConfig;
  selfHandle: string;
  now?: number;
}

/** Комментарии чужим: кандидаты по score → фильтры → Action. */
export async function planComments(ctx: PlanContext, limit = 10): Promise<Action[]> {
  const mode = modeFor(ctx.autonomy, 'comment-on-stranger');
  const status = initialStatus(mode);
  if (!status) return [];
  const now = ctx.now ?? Date.now();
  const candidates = await listCandidates(
    ctx.settings.lprMinScore,
    ctx.settings.maxPostAgeDays * 86_400_000,
    limit * 3,
    now,
    ctx.settings.relevanceMin,
    ctx.settings.commentMin,
  );
  const created: Action[] = [];
  for (const post of candidates) {
    if (created.length >= limit) break;
    const dedupeKey = makeDedupeKey('comment-on-stranger', { postId: post.id, handle: post.authorHandle });
    const [author, authorActions, exists] = await Promise.all([
      getAuthor(post.authorHandle),
      listActionsByTargetHandle(post.authorHandle),
      hasActionWithKey(dedupeKey),
    ]);
    const gate = commentAllowed({
      post,
      author,
      selfHandle: ctx.selfHandle,
      authorActions,
      existingKeys: new Set(exists ? [dedupeKey] : []),
      dedupeKey,
      authorCooldownDays: ctx.settings.authorCooldownDays,
      maxPostAgeDays: ctx.settings.maxPostAgeDays,
      now,
    });
    if (!gate.ok) {
      await setActionStatus(post.id, 'skipped');
      continue;
    }
    try {
      const a = await createAction(
        {
          type: 'comment-on-stranger',
          targetHandle: post.authorHandle,
          targetPostId: post.id,
          threadUrl: post.url,
          context: contextFor(post),
          dedupeKey,
          autonomyMode: mode,
        },
        now,
      );
      await setActionStatus(post.id, 'proposed');
      created.push(a);
    } catch (e) {
      if (!(e instanceof DuplicateActionError)) throw e;
    }
  }
  if (created.length) log('info', `planner: +${created.length} comment-on-stranger`);
  return created;
}

/** Ответы на чужие реплики: из /activity и тредов — записи, где нам ответили (isReplyTo на наш пост или на тред с нашим комментарием). */
export async function planReplies(ctx: PlanContext, limit = 10): Promise<Action[]> {
  const now = ctx.now ?? Date.now();
  const recent = await listRecentPosts(200);
  const created: Action[] = [];
  for (const p of recent) {
    if (created.length >= limit) break;
    if (p.authorHandle === ctx.selfHandle) continue;
    if (p.source !== 'activity' && p.source !== 'thread') continue;
    if (p.actionStatus !== 'none') continue;
    if (now - (p.postedAt ?? p.firstSeenAt) > 3 * 86_400_000) continue;
    const isOnOurPost = p.isReplyTo ? p.isReplyTo.startsWith(`${ctx.selfHandle}/post/`) : p.source === 'activity';
    if (!isOnOurPost && p.source === 'thread') {
      // в чужом треде отвечаем, только если мы там уже комментировали
      const ours = p.isReplyTo ? await hasActionWithKey(makeDedupeKey('comment-on-stranger', { postId: p.isReplyTo, handle: '' })) : false;
      if (!ours) continue;
    }
    const type = isOnOurPost ? 'reply-own-post' : 'reply-thread';
    const mode = modeFor(ctx.autonomy, type);
    const status = initialStatus(mode);
    if (!status) continue;
    const dedupeKey = makeDedupeKey(type, { threadUrl: p.isReplyTo ?? p.url, parentId: p.id, handle: p.authorHandle });
    if (await hasActionWithKey(dedupeKey)) continue;
    const author = await getAuthor(p.authorHandle);
    if (author && (author.relationship === 'do_not_contact')) continue;
    try {
      const a = await createAction(
        {
          type,
          targetHandle: p.authorHandle,
          targetPostId: p.id,
          threadUrl: p.url,
          parentCommentId: p.id,
          context: contextFor(p),
          dedupeKey,
          autonomyMode: mode,
        },
        now,
      );
      await setActionStatus(p.id, 'proposed');
      created.push(a);
    } catch (e) {
      if (!(e instanceof DuplicateActionError)) throw e;
    }
  }
  if (created.length) log('info', `planner: +${created.length} replies`);
  return created;
}

export function contextFor(p: Post): string {
  const head = `@${p.authorHandle}${p.authorName ? ` (${p.authorName})` : ''}${p.authorBioSnapshot ? ` — ${p.authorBioSnapshot}` : ''}`;
  const meta = `♥ ${p.likes} · ответов ${p.replies}${p.ai ? ` · стоит комментировать: ${p.ai.commentScore ?? '—'} (автор ${p.ai.lprScore}, тема ${p.ai.relevance ?? '—'}${p.ai.topic ? ` — ${p.ai.topic}` : ''}) · ${p.ai.niche} — ${p.ai.reason}` : ''}`;
  return `${head}\n${meta}\n\n${p.text}`;
}

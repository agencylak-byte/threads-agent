import { listUnclassified, markClassified, getPost } from '@/db/repo-posts';
import { upsertAuthor } from '@/db/repo-authors';
import { expireProposals, listActionsByStatus, recentSentOpeners, updateAction } from '@/db/repo-actions';
import { bumpMetric, dateKey } from '@/db/repo-metrics';
import { apiKeyItem, autonomyItem, engineStateItem, getSettings, selfHandleItem } from '@/shared/settings';
import { PROPOSAL_TTL_MS } from '@/shared/constants';
import { log } from '@/shared/log';
import { classifyPosts } from '@/llm/tasks/classify-lpr';
import { draftComment } from '@/llm/tasks/comment-draft';
import { draftReply } from '@/llm/tasks/reply-draft';
import { openerDuplicate } from './dedupe';
import { planComments, planReplies } from './planner';
import { canPrepare } from './autonomy';
import type { Action, LlmUsage } from '@/shared/types';

// Один тик движка: expire → classify → plan → draft → (dispatch — фаза 3, подключается через хук).
// Тик идемпотентен и защищён от параллельного запуска.

let ticking = false;
let dispatchHook: (() => Promise<void>) | null = null;
let activityHook: (() => Promise<void>) | null = null;
let lastActivityAt = 0;
let collectHook: (() => Promise<void>) | null = null;
let lastCollectAt = 0;
export function setCollectHook(h: (() => Promise<void>) | null): void {
  collectHook = h;
}

export function setDispatchHook(h: (() => Promise<void>) | null): void {
  dispatchHook = h;
}
/** Сбор «Действий» (ответы на наши посты) — для автоответов. */
export function setActivityHook(h: (() => Promise<void>) | null): void {
  activityHook = h;
}

const CLASSIFY_BATCH = 10;
const CLASSIFY_BATCHES_PER_TICK = 3;
const DRAFTS_PER_TICK = 5;

export async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const engine = await engineStateItem.getValue();
    const expired = await expireProposals(PROPOSAL_TTL_MS);
    if (expired) log('info', `expired ${expired} proposals`);
    if (!canPrepare(engine)) return;
    const apiKey = await apiKeyItem.getValue();
    if (!apiKey) return;
    const s = await getSettings();
    if (activityHook && s.autoReplyIntervalMin > 0 && Date.now() - lastActivityAt > s.autoReplyIntervalMin * 60_000) {
      lastActivityAt = Date.now();
      await activityHook();
    }
    if (collectHook && s.autoCollectIntervalMin > 0 && Date.now() - lastCollectAt > s.autoCollectIntervalMin * 60_000 && engine.status === 'running') {
      lastCollectAt = Date.now();
      await collectHook();
    }
    await classifyStep();
    await planStep();
    await draftStep();
    await autoPostStep(s);
    if (dispatchHook) await dispatchHook();
    await engineStateItem.setValue({ ...(await engineStateItem.getValue()), lastTickAt: Date.now() });
  } catch (e) {
    log('error', 'tick failed', String(e));
  } finally {
    ticking = false;
  }
}

async function accountUsage(usage: LlmUsage): Promise<void> {
  const s = await getSettings();
  await bumpMetric(dateKey(Date.now(), s.timezone), 'llmCostUsd', usage.costUsd);
}

export async function classifyStep(): Promise<number> {
  let total = 0;
  for (let i = 0; i < CLASSIFY_BATCHES_PER_TICK; i++) {
    const batch = await listUnclassified(CLASSIFY_BATCH);
    if (!batch.length) break;
    const { ai, usage } = await classifyPosts(batch);
    await accountUsage(usage);
    for (const p of batch) {
      const a = ai.get(p.id) ?? { lprScore: 0, niche: 'не определено', isFreelancer: false, reason: 'модель не вернула оценку', model: usage.model, at: Date.now() };
      await markClassified(p.id, a);
      await upsertAuthor({ handle: p.authorHandle, lprScoreMax: a.lprScore, niche: a.niche || undefined });
      total++;
    }
    if (batch.length < CLASSIFY_BATCH) break;
  }
  if (total) log('info', `classified ${total} posts`);
  return total;
}

export async function planStep(): Promise<void> {
  const [settings, autonomy, selfHandle] = await Promise.all([getSettings(), autonomyItem.getValue(), selfHandleItem.getValue()]);
  if (!selfHandle) return;
  await planComments({ settings, autonomy, selfHandle });
  await planReplies({ settings, autonomy, selfHandle });
}

export async function draftStep(): Promise<number> {
  const pending = (await listActionsByStatus(['proposed', 'queued'], 200)).filter((a) => !a.draftText);
  let n = 0;
  for (const a of pending.slice(0, DRAFTS_PER_TICK)) {
    try {
      await draftFor(a);
      n++;
    } catch (e) {
      log('error', `draft failed for ${a.id}`, String(e));
      const draftAttempts = (a.draftAttempts ?? 0) + 1;
      await updateAction(a.id, { error: String(e), draftAttempts, ...(draftAttempts >= 3 ? { status: 'failed' as const } : {}) });
    }
  }
  return n;
}

/** Сгенерировать (или перегенерировать с подсказкой) текст для действия. */
export async function draftFor(a: Action, hint?: string): Promise<string> {
  const openers = await recentSentOpeners(20);
  const selfHandle = await selfHandleItem.getValue();
  let text = '';
  let usage: LlmUsage;
  if (a.type === 'comment-on-stranger') {
    const post = a.targetPostId ? await getPost(a.targetPostId) : undefined;
    if (!post) throw new Error('пост не найден в базе');
    let r = await draftComment(post, openers, hint);
    if (openerDuplicate(r.text, openers)) r = await draftComment(post, openers, (hint ? hint + '. ' : '') + 'Начни совсем иначе, чем перечисленные зачины');
    text = r.text;
    usage = r.usage;
  } else if (a.type === 'reply-own-post' || a.type === 'reply-thread') {
    const reply = a.targetPostId ? await getPost(a.targetPostId) : undefined;
    if (!reply) throw new Error('реплика не найдена в базе');
    const root = reply.isReplyTo ? await getPost(reply.isReplyTo) : undefined;
    const thread = [
      ...(root ? [{ handle: root.authorHandle, text: root.text, isSelf: root.authorHandle === selfHandle }] : []),
      { handle: reply.authorHandle, text: reply.text, isSelf: false },
    ];
    const r = await draftReply(a.type, thread, { handle: reply.authorHandle, text: reply.text, isSelf: false }, openers, hint);
    text = r.text;
    usage = r.usage;
  } else {
    throw new Error(`draft для ${a.type} не поддерживается в этом инкременте`);
  }
  await accountUsage(usage);
  await updateAction(a.id, { draftText: text, llm: usage, error: undefined });
  return text;
}

/**
 * Автопостинг: если publish-post в автопилоте и сегодня ещё не набрано autoPostsPerDay —
 * взять следующую тему по кругу, написать пост в её голосе и поставить в очередь отправки.
 * Интервал между постами — не меньше рабочего окна / (постов в день + 1).
 */
export async function autoPostStep(s: Awaited<ReturnType<typeof getSettings>>): Promise<void> {
  if (s.autoPostsPerDay <= 0 || !s.postTopics.length) return;
  const autonomy = await autonomyItem.getValue();
  if (autonomy['publish-post'] !== 'auto') return;
  const self = await selfHandleItem.getValue();
  if (!self) return;
  const { isWorkingHours } = await import('./pacing');
  if (!isWorkingHours(Date.now(), s)) return;
  const { listActionsByStatus, listExecutedBetween, createAction, makeDedupeKey } = await import('@/db/repo-actions');
  const pending = (await listActionsByStatus(['proposed', 'queued', 'executing'], 100)).filter((a) => a.type === 'publish-post');
  if (pending.length) return;
  const dayAgo = Date.now() - 24 * 3600_000;
  const publishedToday = (await listExecutedBetween(dayAgo, Date.now() + 1)).filter((a) => a.type === 'publish-post');
  if (publishedToday.length >= s.autoPostsPerDay) return;
  const last = publishedToday.reduce((m, a) => Math.max(m, a.executedAt ?? 0), 0);
  const minSpacingMs = (10 * 3600_000) / (s.autoPostsPerDay + 1);
  if (last && Date.now() - last < minSpacingMs) return;

  const topic = s.postTopics[s.postTopicCursor % s.postTopics.length]!;
  const { draftPost } = await import('@/llm/tasks/post-draft');
  const { listPostsByAuthor } = await import('@/db/repo-posts');
  const recent = (await listPostsByAuthor(self)).slice(0, 10).map((p) => p.text);
  const { variants, usage } = await draftPost(topic, recent);
  await accountUsage(usage);
  const v = variants[0];
  if (!v) return;
  await createAction({
    type: 'publish-post',
    targetHandle: self,
    context: `Автопост · тема: ${topic}\nКрючок: ${v.hook}\nПочему: ${v.why}`,
    dedupeKey: makeDedupeKey('publish-post', { handle: self }),
    autonomyMode: 'auto',
    draftText: v.text,
    llm: usage,
  });
  const { patchSettings } = await import('@/shared/settings');
  await patchSettings({ postTopicCursor: (s.postTopicCursor + 1) % s.postTopics.length });
  log('info', `autopost: тема «${topic.slice(0, 50)}…» → в очередь публикации`);
}

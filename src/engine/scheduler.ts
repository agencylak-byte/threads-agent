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

export function setDispatchHook(h: (() => Promise<void>) | null): void {
  dispatchHook = h;
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
    await classifyStep();
    await planStep();
    await draftStep();
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

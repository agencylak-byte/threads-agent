import { listUnclassified, markClassified, getPost } from '@/db/repo-posts';
import { upsertAuthor } from '@/db/repo-authors';
import { expireProposals, listActionsByStatus, recentSentOpeners, updateAction } from '@/db/repo-actions';
import { bumpMetric, dateKey } from '@/db/repo-metrics';
import { apiKeyItem, autonomyItem, engineStateItem, getSettings, lastActivityAtItem, lastCollectAtItem, llmCreditsOutItem, selfHandleItem } from '@/shared/settings';
import { PROPOSAL_TTL_MS } from '@/shared/constants';
import { log } from '@/shared/log';
import { classifyPosts } from '@/llm/tasks/classify-lpr';
import { draftComment } from '@/llm/tasks/comment-draft';
import { draftReply } from '@/llm/tasks/reply-draft';
import { openerDuplicate } from './dedupe';
import { FACT_GUARD_HINT, checkFacts } from './fact-guard';
import businessFactsMd from '@/profile/seed/business-facts.md?raw';
import { planComments, planReplies } from './planner';
import { canPrepare } from './autonomy';
import type { Action, LlmUsage } from '@/shared/types';

// Один тик движка: expire → classify → plan → draft → (dispatch — фаза 3, подключается через хук).
// Тик идемпотентен и защищён от параллельного запуска.

let ticking = false;
let dispatchHook: (() => Promise<void>) | null = null;
let activityHook: (() => Promise<void>) | null = null;
let collectHook: (() => Promise<void>) | null = null;
let reverifyHook: (() => Promise<void>) | null = null;
export function setReverifyHook(h: (() => Promise<void>) | null): void {
  reverifyHook = h;
}
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
    // Каждый шаг отдельно: раньше ошибка одного шага (нет денег на OpenRouter, таймаут сбора) обрывала весь тик,
    // и 13–16.10 готовые 66 черновиков не отправлялись, хотя отправке модель не нужна.
    // Сначала отправка готового: сбор занимает вкладку на минуты, и раньше отправка за ним не успевала.
    if (dispatchHook) await step('отправка', dispatchHook);
    // Время сборов — в storage: в памяти оно обнулялось при каждом засыпании service worker,
    // и 14–16.10 сбор по ключам шёл почти каждую минуту, занимая вкладку вместо отправки.
    if (activityHook && s.autoReplyIntervalMin > 0 && Date.now() - (await lastActivityAtItem.getValue()) > s.autoReplyIntervalMin * 60_000) {
      await lastActivityAtItem.setValue(Date.now());
      await step('сбор ответов', activityHook);
    }
    if (collectHook && s.autoCollectIntervalMin > 0 && Date.now() - (await lastCollectAtItem.getValue()) > s.autoCollectIntervalMin * 60_000 && engine.status === 'running') {
      await lastCollectAtItem.setValue(Date.now());
      await step('сбор по ключам', collectHook);
    }
    const creditsOutAt = await llmCreditsOutItem.getValue();
    // без денег на модели не долбим OpenRouter каждую минуту: пробуем раз в 30 минут
    const llmAllowed = !creditsOutAt || Date.now() - creditsOutAt > 30 * 60_000;
    if (llmAllowed) {
      await step('оценка постов', classifyStep);
      await step('планирование', planStep);
      await step('черновики', draftStep);
      await step('автопост', () => autoPostStep(s));
    } else {
      await step('планирование', planStep);
    }
    if (reverifyHook) await step('перепроверка', reverifyHook);
    await engineStateItem.setValue({ ...(await engineStateItem.getValue()), lastTickAt: Date.now() });
  } catch (e) {
    log('error', 'tick failed', String(e));
  } finally {
    ticking = false;
  }
}

async function step(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    const msg = String(e);
    if (/OpenRouter HTTP 402|more credits/i.test(msg)) {
      const prev = await llmCreditsOutItem.getValue();
      await llmCreditsOutItem.setValue(Date.now());
      if (!prev) log('anomaly', 'На OpenRouter закончились деньги — тексты не пишутся, пока не пополните баланс. Отправка готовых продолжается.');
      return;
    }
    log('error', `шаг «${name}» не выполнен`, msg);
  }
}

async function accountUsage(usage: LlmUsage): Promise<void> {
  if (await llmCreditsOutItem.getValue()) {
    await llmCreditsOutItem.setValue(0);
    log('info', 'OpenRouter снова отвечает — тексты пишутся');
  }
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
  const backlog = (await listActionsByStatus(['proposed', 'queued'], 1000)).filter((a) => a.type === 'comment-on-stranger').length;
  if (backlog < settings.limits['comment-on-stranger'] * 3) await planComments({ settings, autonomy, selfHandle });
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
    const sources = [post.text, businessFactsMd];
    let verdict = checkFacts(r.text, sources);
    if (!verdict.ok) {
      log('info', `fact-guard: выдуманные цифры ${verdict.fabricated.join(', ')} → перегенерация`);
      r = await draftComment(post, openers, (hint ? hint + '. ' : '') + FACT_GUARD_HINT);
      verdict = checkFacts(r.text, sources);
    }
    text = r.text;
    usage = r.usage;
    if (!verdict.ok) {
      await updateAction(a.id, {
        draftText: text,
        llm: usage,
        status: 'proposed',
        needsReview: true,
        error: `защита от выдуманных цифр: ${verdict.fabricated.join(', ')} — нужно ручное одобрение`,
      });
      log('info', `fact-guard: ${a.id} → на ручное одобрение`);
      return text;
    }
  } else if (a.type === 'reply-own-post' || a.type === 'reply-thread') {
    const reply = a.targetPostId ? await getPost(a.targetPostId) : undefined;
    if (!reply) throw new Error('реплика не найдена в базе');
    const { collectOurTexts, splitReply, describeAuthor, formatGuidance, metaLeak } = await import('./reply-context');
    const { listPostsByAuthor } = await import('@/db/repo-posts');
    const { getAuthor } = await import('@/db/repo-authors');
    const sent = await listActionsByStatus(['done', 'executing', 'queued'], 400);
    const ours = collectOurTexts(selfHandle ? await listPostsByAuthor(selfHandle) : [], sent.filter((x) => x.id !== a.id));
    const split = splitReply(reply.text, ours);
    if (!split) {
      // в карточке только наш собственный текст — отвечать не на что (раньше бот писал «вы скопировали мой пост»)
      await updateAction(a.id, { status: 'rejected', error: 'реплика собеседника не прочиталась — в карточке только наш текст' });
      log('info', `reply ${a.id}: нет реплики собеседника, пропуск`);
      return '';
    }
    const root = reply.isReplyTo ? await getPost(reply.isReplyTo) : undefined;
    const parentText = split.parent?.text ?? (root && root.authorHandle === selfHandle ? root.text : undefined);
    const rootFormat = split.parent?.format ?? (root ? ours.find((o) => o.text.slice(0, 40) === root.text.slice(0, 40))?.format : undefined);
    const thread = [
      ...(root && root.text !== parentText ? [{ handle: root.authorHandle, text: root.text, isSelf: root.authorHandle === selfHandle }] : []),
      ...(parentText ? [{ handle: selfHandle ?? 'мы', text: parentText, isSelf: true }] : []),
      { handle: reply.authorHandle, text: split.message, isSelf: false },
    ];
    const last = { handle: reply.authorHandle, text: split.message, isSelf: false };
    const theirPosts = (await listPostsByAuthor(reply.authorHandle)).filter((p) => p.id !== reply.id && p.source !== 'activity');
    const extra = {
      parentText,
      formatGuidance: formatGuidance(rootFormat),
      authorInfo: describeAuthor(reply.authorHandle, await getAuthor(reply.authorHandle), theirPosts),
    };
    let r = await draftReply(a.type, thread, last, openers, hint, extra);
    const sources = [...thread.map((l) => l.text), businessFactsMd];
    let verdict = checkFacts(r.text, sources);
    let leak = metaLeak(r.text);
    if (!verdict.ok || leak) {
      const why = [hint, !verdict.ok ? FACT_GUARD_HINT : '', leak ? `Без слов «${leak}»: ты живой человек, отвечай по сути реплики` : ''].filter(Boolean).join('. ');
      r = await draftReply(a.type, thread, last, openers, why, extra);
      verdict = checkFacts(r.text, sources);
      leak = metaLeak(r.text);
    }
    text = r.text;
    usage = r.usage;
    if (!verdict.ok || leak) {
      const error = leak ? `ответ звучит как бот («${leak}») — нужно ручное одобрение` : `защита от выдуманных цифр: ${verdict.fabricated.join(', ')} — нужно ручное одобрение`;
      await updateAction(a.id, { draftText: text, llm: usage, status: 'proposed', needsReview: true, error });
      return text;
    }
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
  const self = await selfHandleItem.getValue();
  if (!self) return;
  const { isWorkingHours } = await import('./pacing');
  if (!isWorkingHours(Date.now(), s)) return;
  const { listActionsByStatus, listExecutedBetween, createAction, makeDedupeKey } = await import('@/db/repo-actions');
  // пост, ждущий ручной проверки (защита цифр), автопостинг не держит
  const pending = (await listActionsByStatus(['proposed', 'queued', 'executing'], 100)).filter((a) => a.type === 'publish-post' && !(a.status === 'proposed' && a.needsReview));
  if (pending.length) return;
  // «сегодня» — по календарю в таймзоне настроек, а не последние 24 часа
  const { dateKey: dk } = await import('@/db/repo-metrics');
  const todayKey = dk(Date.now(), s.timezone);
  let dayStart = Date.now();
  while (dk(dayStart - 60_000, s.timezone) === todayKey) dayStart -= 60_000;
  const publishedToday = (await listExecutedBetween(Math.max(dayStart, s.rampStartAt ?? 0), Date.now() + 1)).filter((a) => a.type === 'publish-post' && a.status === 'done');
  if (publishedToday.length >= s.autoPostsPerDay) return;
  const last = publishedToday.reduce((m, a) => Math.max(m, a.executedAt ?? 0), 0);
  // шаг — от длины рабочего окна
  const [sh, sm] = s.workingHours.start.split(':').map(Number);
  const [eh, em] = s.workingHours.end.split(':').map(Number);
  const windowMs = Math.max(60, (eh ?? 21) * 60 + (em ?? 0) - ((sh ?? 9) * 60 + (sm ?? 30))) * 60_000;
  // если день начался со сбоев — догоняем: оставшиеся посты равномерно на оставшееся рабочее время
  const nowLocal = new Intl.DateTimeFormat('en-GB', { timeZone: s.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()).split(':').map(Number);
  const leftMs = Math.max(0, (eh ?? 21) * 60 + (em ?? 0) - ((nowLocal[0] ?? 0) * 60 + (nowLocal[1] ?? 0))) * 60_000;
  const remaining = s.autoPostsPerDay - publishedToday.length;
  const minSpacingMs = Math.min(windowMs / (s.autoPostsPerDay + 1), leftMs / Math.max(1, remaining));
  if (last && Date.now() - last < minSpacingMs) return;

  // формат — тот, что давнее всех не выходил (история — из context прошлых автопостов «Формат: id»)
  const { pickFormat, startsWithBanned } = await import('@/profile/post-formats');
  const recentAuto = (await listActionsByStatus(['done', 'queued', 'executing', 'proposed', 'failed'], 300)).filter((a) => a.type === 'publish-post');
  const formatHistory = recentAuto
    .map((a) => ({ format: /Формат: ([\w-]+)/.exec(a.context ?? '')?.[1] ?? '', at: a.executedAt ?? a.createdAt }))
    .filter((h) => h.format);
  const format = pickFormat(formatHistory, Date.now());

  // тема (если формату нужна): первая по кругу, которой не было последние 14 дней
  const fresh = s.topicHistory.filter((h) => Date.now() - h.at < 14 * 86_400_000);
  const used = new Set(fresh.map((h) => h.topic));
  let topic: string | undefined;
  if (format.needsTopic) {
    for (let i = 0; i < s.postTopics.length; i++) {
      const t = s.postTopics[(s.postTopicCursor + i) % s.postTopics.length]!;
      if (!used.has(t)) {
        topic = t;
        break;
      }
    }
    if (!topic) {
      // все темы были за 14 дней (в т.ч. на несостоявшихся постах) — берём самую давнюю, а не молчим
      const lastAt = new Map(fresh.map((h) => [h.topic, h.at]));
      topic = [...s.postTopics].sort((a, b) => (lastAt.get(a) ?? 0) - (lastAt.get(b) ?? 0))[0];
      if (!topic) return;
      log('info', `autopost: все темы были за 14 дней — беру самую давнюю: ${topic}`);
    }
  }
  const { draftPost } = await import('@/llm/tasks/post-draft');
  const { listPostsByAuthor } = await import('@/db/repo-posts');
  const recent = (await listPostsByAuthor(self)).slice(0, 10).map((p) => p.text);
  let { variants, usage } = await draftPost(topic, recent, undefined, 1, format);
  await accountUsage(usage);
  let v = variants[0];
  if (!v) return;
  const banned = startsWithBanned(v.text);
  if (banned) {
    // один повтор: затёртый зачин режет охват
    ({ variants, usage } = await draftPost(topic, recent, `Не начинай с «${banned}». Начни сразу с сути.`, 1, format));
    await accountUsage(usage);
    v = variants[0] ?? v;
  }
  const verdict = checkFacts(v.text, [businessFactsMd]);
  const needsReview = !verdict.ok;
  await createAction({
    type: 'publish-post',
    targetHandle: self,
    context: `Автопост · Формат: ${format.id} (${format.name}) · тема: ${topic ?? '—'}\nКрючок: ${v.hook}\nПочему: ${v.why}`,
    dedupeKey: makeDedupeKey('publish-post', { handle: self }),
    autonomyMode: needsReview ? 'suggest' : 'auto',
    draftText: v.text,
    llm: usage,
  });
  if (needsReview) {
    const { listActionsByStatus: la, updateAction: ua } = await import('@/db/repo-actions');
    const just = (await la(['proposed'], 50)).find((x) => x.type === 'publish-post' && x.draftText === v.text);
    if (just) await ua(just.id, { needsReview: true, error: `защита от выдуманных цифр: ${verdict.fabricated.join(', ')} — нужно ручное одобрение` });
  }
  log('info', `autopost: формат ${format.id}, тема ${topic ?? '—'}`);
  if (!topic) return;
  const { patchSettings } = await import('@/shared/settings');
  const idx = s.postTopics.indexOf(topic);
  await patchSettings({
    postTopicCursor: (idx + 1) % s.postTopics.length,
    topicHistory: [...fresh, { topic, at: Date.now() }].slice(-100),
  });
  log('info', `autopost: тема «${topic.slice(0, 50)}…» → ${needsReview ? 'на ручное одобрение (цифры)' : 'в очередь публикации'}`);
}

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDbForTests } from '@/db/db';
import { markClassified, upsertPosts, getPost } from '@/db/repo-posts';
import { setRelationship } from '@/db/repo-authors';
import { createAction, listActionsByStatus, makeDedupeKey } from '@/db/repo-actions';
import { commentAllowed, openerDuplicate } from '@/engine/dedupe';
import { planComments, planReplies } from '@/engine/planner';
import { initialStatus, canDispatch, canPrepare } from '@/engine/autonomy';
import { DEFAULT_SETTINGS } from '@/shared/settings';
import { DEFAULT_AUTONOMY } from '@/shared/constants';
import type { Action, ObservedPost, Post } from '@/shared/types';

const NOW = Date.UTC(2026, 8, 25, 12, 0);

function obs(id: string, over: Partial<ObservedPost> = {}): ObservedPost {
  const [handle, , code] = id.split('/');
  return {
    id,
    url: `https://www.threads.com/@${handle}/post/${code}`,
    code: code!,
    authorHandle: handle!,
    text: `Пост ${id}: заявок нет, подрядчик показывает охваты`,
    likes: 5,
    replies: 1,
    reposts: 0,
    source: 'keyword',
    postedAt: NOW - 3600_000,
    ...over,
  };
}

async function classified(id: string, score: number, over: Partial<ObservedPost> = {}, isFreelancer = false): Promise<Post> {
  await upsertPosts([obs(id, over)], NOW - 1000);
  await markClassified(id, { lprScore: score, commentScore: 90, relevance: 90, niche: 'эксперт', isFreelancer, reason: '', model: 'm', at: NOW });
  return (await getPost(id))!;
}

beforeEach(async () => {
  await resetDbForTests();
});

describe('autonomy', () => {
  it('статусы по режиму и права движка', () => {
    expect(initialStatus('off')).toBeNull();
    expect(initialStatus('suggest')).toBe('proposed');
    expect(initialStatus('auto')).toBe('queued');
    expect(canPrepare({ status: 'stopped', anomalies24h: [] })).toBe(false);
    expect(canPrepare({ status: 'sleeping', anomalies24h: [] })).toBe(true);
    expect(canDispatch({ status: 'sleeping', anomalies24h: [] })).toBe(false);
    expect(canDispatch({ status: 'running', anomalies24h: [], pausedUntil: NOW + 1000 }, NOW)).toBe(false);
    expect(canDispatch({ status: 'running', anomalies24h: [] }, NOW)).toBe(true);
  });
});

describe('dedupe.commentAllowed', () => {
  const base = async () => ({
    post: await classified('u/post/1', 90),
    selfHandle: 'me',
    authorActions: [] as Action[],
    existingKeys: new Set<string>(),
    dedupeKey: 'comment:u/post/1',
    authorCooldownDays: 14,
    maxPostAgeDays: 7,
    now: NOW,
  });

  it('пропускает нормальный пост', async () => {
    expect(await commentAllowed(await base())).toEqual({ ok: true });
  });

  it('режет свой пост, дубль ключа, фрилансера, старый пост, кулдаун и заблокированные отношения', async () => {
    const b = await base();
    expect(commentAllowed({ ...b, selfHandle: 'u' }).ok).toBe(false);
    expect(commentAllowed({ ...b, existingKeys: new Set(['comment:u/post/1']) }).ok).toBe(false);
    expect(commentAllowed({ ...b, post: { ...b.post, ai: { ...b.post.ai!, isFreelancer: true } } }).ok).toBe(false);
    expect(commentAllowed({ ...b, post: { ...b.post, postedAt: NOW - 10 * 86_400_000 } }).ok).toBe(false);
    const recent = { type: 'comment-on-stranger', status: 'done', executedAt: NOW - 86_400_000, createdAt: NOW - 86_400_000 } as Action;
    expect(commentAllowed({ ...b, authorActions: [recent] }).ok).toBe(false);
    const old = { ...recent, executedAt: NOW - 20 * 86_400_000 } as Action;
    expect(commentAllowed({ ...b, authorActions: [old] }).ok).toBe(true);
    expect(commentAllowed({ ...b, author: { handle: 'u', tags: [], relationship: 'lead', lastSeenAt: NOW } }).ok).toBe(false);
  });
});

describe('dedupe.openerDuplicate', () => {
  it('сравнивает нормализованные первые 40 символов', () => {
    expect(openerDuplicate('Согласна, но есть нюанс: заявки идут не с постов', ['согласна но есть нюанс заявки идут не с постов а с'])).toBe(true);
    expect(openerDuplicate('Коротко', ['Коротко'])).toBe(false); // слишком короткий зачин не считаем дублем
    expect(openerDuplicate('У клиента было ровно так же, пока не поменяли CTA', ['Согласна, но есть нюанс'])).toBe(false);
  });
});

describe('planner.planComments', () => {
  const ctx = { settings: DEFAULT_SETTINGS, autonomy: DEFAULT_AUTONOMY, selfHandle: 'me', now: NOW };

  it('создаёт proposed для подходящих, пропускает слабых/фрилансеров/свои, помечает посты', async () => {
    await classified('a/post/1', 90);
    await classified('b/post/2', 95, {}, true);
    await classified('c/post/3', 30);
    await classified('me/post/4', 99);
    // пост по теме, но не про бизнес — отсекается порогом relevance
    await upsertPosts([obs('offtopic/post/5')], NOW - 1000);
    await markClassified('offtopic/post/5', { lprScore: 90, commentScore: 20, relevance: 20, niche: 'x', isFreelancer: false, reason: '', model: 'm', at: NOW });
    const created = await planComments(ctx);
    expect(created.map((a) => a.targetHandle)).toEqual(['a']);
    expect(created[0]?.status).toBe('proposed');
    expect(created[0]?.dedupeKey).toBe('comment:a/post/1');
    expect((await getPost('a/post/1'))?.actionStatus).toBe('proposed');
    expect((await getPost('me/post/4'))?.actionStatus).toBe('skipped');
    // повторный прогон ничего не дублирует
    expect(await planComments(ctx)).toEqual([]);
  });

  it('снятое системой предложение (expired) не блокирует повторное, отклонённое Лерой — блокирует', async () => {
    const { expireAllProposed, updateAction, getActionByKey } = await import('@/db/repo-actions');
    const { setActionStatus } = await import('@/db/repo-posts');
    await classified('a/post/1', 90);
    const [first] = await planComments(ctx);
    expect(first?.status).toBe('proposed');
    // система сняла предложение (переоценка) и вернула пост на рассмотрение
    expect(await expireAllProposed('test', NOW)).toBe(1);
    await setActionStatus('a/post/1', 'none');
    const again = await planComments(ctx);
    expect(again.map((x) => x.targetHandle)).toEqual(['a']);
    expect(again[0]?.id).not.toBe(first?.id);
    // а вот отклонённое человеком — больше не предлагаем
    await updateAction(again[0]!.id, { status: 'rejected' });
    await setActionStatus('a/post/1', 'none');
    expect(await planComments(ctx)).toEqual([]);
    expect((await getActionByKey('comment:a/post/1'))?.status).toBe('rejected');
  });

  it('уважает режим off и auto, кулдаун по автору и do_not_contact', async () => {
    await classified('a/post/1', 90);
    expect(await planComments({ ...ctx, autonomy: { ...DEFAULT_AUTONOMY, 'comment-on-stranger': 'off' } })).toEqual([]);
    const auto = await planComments({ ...ctx, autonomy: { ...DEFAULT_AUTONOMY, 'comment-on-stranger': 'auto' } });
    expect(auto[0]?.status).toBe('queued');
    await classified('a/post/2', 90);
    expect(await planComments(ctx)).toEqual([]); // тому же автору — кулдаун 14 дней
    await classified('z/post/9', 90);
    await setRelationship('z', 'do_not_contact');
    expect(await planComments(ctx)).toEqual([]);
  });
});

describe('planner.planReplies', () => {
  it('ответ на наш пост из activity → reply-own-post; в чужом треде — только если мы там комментировали', async () => {
    const ctx = { settings: DEFAULT_SETTINGS, autonomy: DEFAULT_AUTONOMY, selfHandle: 'me', now: NOW };
    await upsertPosts([obs('x/post/r1', { source: 'activity', isReplyTo: 'me/post/root', text: 'А как вы считаете окупаемость?' })], NOW);
    await upsertPosts([obs('y/post/r2', { source: 'thread', isReplyTo: 'q/post/root2', text: 'Спорно' })], NOW);
    let created = await planReplies(ctx);
    expect(created.map((a) => [a.type, a.targetHandle, a.status])).toEqual([['reply-own-post', 'x', 'queued']]);
    // теперь «мы комментировали» q/post/root2
    await createAction({ type: 'comment-on-stranger', targetHandle: 'q', targetPostId: 'q/post/root2', context: '', dedupeKey: makeDedupeKey('comment-on-stranger', { postId: 'q/post/root2', handle: 'q' }), autonomyMode: 'suggest' });
    created = await planReplies(ctx);
    expect(created.map((a) => [a.type, a.targetHandle])).toEqual([['reply-thread', 'y']]);
    // reply-own-post по умолчанию в автопилоте → queued, остальные — proposed
    expect((await listActionsByStatus(['proposed', 'queued'])).length).toBe(3);
  });
});

vi.mock('@/llm/tasks/classify-lpr', () => ({
  classifyPosts: vi.fn(async (posts: Post[]) => ({
    ai: new Map(posts.map((p) => [p.id, { lprScore: p.authorHandle === 'fr' ? 10 : 88, commentScore: 85, niche: 'эксперт', isFreelancer: p.authorHandle === 'fr', reason: 'mock', model: 'mock', at: NOW }])),
    usage: { model: 'mock', promptVersion: 1, tokensIn: 10, tokensOut: 5, costUsd: 0.001 },
  })),
}));

describe('scheduler.classifyStep', () => {
  it('классифицирует батчами и обновляет авторов', async () => {
    const { classifyStep } = await import('@/engine/scheduler');
    const { getAuthor } = await import('@/db/repo-authors');
    await upsertPosts(Array.from({ length: 12 }, (_, i) => obs(`${i === 0 ? 'fr' : 'h' + i}/post/${i}`)), NOW);
    expect(await classifyStep()).toBe(12);
    expect((await getPost('h1/post/1'))?.ai?.lprScore).toBe(88);
    expect((await getPost('fr/post/0'))?.ai?.isFreelancer).toBe(true);
    expect((await getAuthor('h1'))?.lprScoreMax).toBe(88);
  });
});

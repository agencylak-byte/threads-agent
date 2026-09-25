import { beforeEach, describe, expect, it } from 'vitest';
import { resetDbForTests } from '@/db/db';
import { getPost, listCandidates, listUnclassified, markClassified, setActionStatus, upsertPosts } from '@/db/repo-posts';
import { getAuthor, nextRelationship, upsertAuthor } from '@/db/repo-authors';
import { createAction, DuplicateActionError, expireProposals, listActionsByStatus, makeDedupeKey, recentSentOpeners } from '@/db/repo-actions';
import { bumpMetric, dateKey, getMetrics } from '@/db/repo-metrics';
import { toCsv } from '@/db/export-csv';
import { COLUMNS } from '@/db/columns';
import type { ObservedPost } from '@/shared/types';

function post(over: Partial<ObservedPost> = {}): ObservedPost {
  return {
    id: 'user_1/post/ABC',
    url: 'https://www.threads.com/@user_1/post/ABC',
    code: 'ABC',
    authorHandle: 'user_1',
    text: 'Заявок нет, хотя постим каждый день',
    likes: 10,
    replies: 2,
    reposts: 0,
    source: 'keyword',
    sourceDetail: 'заявки',
    ...over,
  };
}

beforeEach(async () => {
  await resetDbForTests();
});

describe('repo-posts', () => {
  it('вставляет новый пост с firstSeen/lastSeen/seenCount=1 и actionStatus=none', async () => {
    const r = await upsertPosts([post()], 1000);
    expect(r).toEqual({ inserted: 1, updated: 0 });
    const p = await getPost('user_1/post/ABC');
    expect(p?.firstSeenAt).toBe(1000);
    expect(p?.seenCount).toBe(1);
    expect(p?.actionStatus).toBe('none');
  });

  it('повторный показ обновляет счётчики, но не затирает ai, actionStatus и source', async () => {
    await upsertPosts([post()], 1000);
    await markClassified('user_1/post/ABC', { lprScore: 85, niche: 'эксперт', isFreelancer: false, reason: 'r', model: 'm', at: 1500 });
    await setActionStatus('user_1/post/ABC', 'commented');
    await upsertPosts([post({ likes: 25, replies: 4, source: 'feed', authorBioSnapshot: 'основатель школы' })], 2000);
    const p = await getPost('user_1/post/ABC');
    expect(p?.likes).toBe(25);
    expect(p?.seenCount).toBe(2);
    expect(p?.lastSeenAt).toBe(2000);
    expect(p?.firstSeenAt).toBe(1000);
    expect(p?.source).toBe('keyword');
    expect(p?.ai?.lprScore).toBe(85);
    expect(p?.actionStatus).toBe('commented');
    expect(p?.authorBioSnapshot).toBe('основатель школы');
  });

  it('listUnclassified возвращает только без ai; listCandidates — по порогу, без фрилансеров и старых', async () => {
    const now = 10_000_000;
    await upsertPosts(
      [
        post({ id: 'a/post/1', authorHandle: 'a', postedAt: now - 1000 }),
        post({ id: 'b/post/2', authorHandle: 'b', postedAt: now - 1000 }),
        post({ id: 'c/post/3', authorHandle: 'c', postedAt: now - 30 * 24 * 3600 * 1000 }),
        post({ id: 'd/post/4', authorHandle: 'd' }),
      ],
      now,
    );
    expect((await listUnclassified(10)).map((p) => p.id).sort()).toEqual(['a/post/1', 'b/post/2', 'c/post/3', 'd/post/4']);
    await markClassified('a/post/1', { lprScore: 90, niche: 'x', isFreelancer: false, reason: '', model: 'm', at: now });
    await markClassified('b/post/2', { lprScore: 90, niche: 'x', isFreelancer: true, reason: '', model: 'm', at: now });
    await markClassified('c/post/3', { lprScore: 95, niche: 'x', isFreelancer: false, reason: '', model: 'm', at: now });
    await markClassified('d/post/4', { lprScore: 40, niche: 'x', isFreelancer: false, reason: '', model: 'm', at: now });
    expect(await listUnclassified(10)).toHaveLength(0);
    const cands = await listCandidates(70, 7 * 24 * 3600 * 1000, 10, now);
    expect(cands.map((p) => p.id)).toEqual(['a/post/1']);
  });
});

describe('repo-authors', () => {
  it('отношение двигается только вглубь', () => {
    expect(nextRelationship('stranger', 'commented')).toBe('commented');
    expect(nextRelationship('lead', 'commented')).toBe('lead');
    expect(nextRelationship('lead', 'do_not_contact')).toBe('do_not_contact');
  });

  it('upsert не затирает bio пустым и держит max lprScore', async () => {
    await upsertAuthor({ handle: 'x', bio: 'основатель', lprScoreMax: 80 }, 1);
    await upsertAuthor({ handle: 'x', lprScoreMax: 60, relationship: 'commented' }, 2);
    const a = await getAuthor('x');
    expect(a?.bio).toBe('основатель');
    expect(a?.lprScoreMax).toBe(80);
    expect(a?.relationship).toBe('commented');
    expect(a?.lastSeenAt).toBe(2);
  });
});

describe('repo-actions', () => {
  const base = { targetHandle: 'u', targetPostId: 'u/post/1', context: 'ctx' } as const;

  it('dedupeKey уникален — второй Action с тем же ключом отбрасывается', async () => {
    const key = makeDedupeKey('comment-on-stranger', { postId: 'u/post/1', handle: 'u' });
    expect(key).toBe('comment:u/post/1');
    const a = await createAction({ ...base, type: 'comment-on-stranger', dedupeKey: key, autonomyMode: 'suggest' });
    expect(a.status).toBe('proposed');
    await expect(
      createAction({ ...base, type: 'comment-on-stranger', dedupeKey: key, autonomyMode: 'suggest' }),
    ).rejects.toBeInstanceOf(DuplicateActionError);
  });

  it('auto-режим создаёт сразу queued; suggest — proposed; expire по TTL', async () => {
    const q = await createAction({ ...base, type: 'reply-own-post', dedupeKey: 'k1', autonomyMode: 'auto' }, 1000);
    expect(q.status).toBe('queued');
    await createAction({ ...base, type: 'comment-on-stranger', dedupeKey: 'k2', autonomyMode: 'suggest', draftText: 'Согласна, но…' }, 1000);
    expect(await expireProposals(500, 2000)).toBe(1);
    expect((await listActionsByStatus(['expired'])).map((a) => a.dedupeKey)).toEqual(['k2']);
  });

  it('recentSentOpeners отдаёт первые символы отправленных текстов', async () => {
    await createAction({ ...base, type: 'comment-on-stranger', dedupeKey: 'k3', autonomyMode: 'auto', draftText: 'У клиента было так: заявки шли с рилсов' });
    expect(await recentSentOpeners(5, 10)).toEqual(['У клиента']);
  });
});

describe('repo-metrics', () => {
  it('dateKey учитывает таймзону; bumpMetric создаёт запись', async () => {
    // 2026-09-25T22:30Z = 26 сентября 01:30 по Москве
    expect(dateKey(Date.UTC(2026, 8, 25, 22, 30), 'Europe/Moscow')).toBe('2026-09-26');
    expect(dateKey(Date.UTC(2026, 8, 25, 22, 30), 'UTC')).toBe('2026-09-25');
    await bumpMetric('2026-09-25', 'commentsSent');
    await bumpMetric('2026-09-25', 'commentsSent');
    await bumpMetric('2026-09-25', 'llmCostUsd', 0.002);
    const m = await getMetrics('2026-09-25');
    expect(m.commentsSent).toBe(2);
    expect(m.llmCostUsd).toBeCloseTo(0.002);
  });
});

describe('export-csv', () => {
  it('стабильные колонки, BOM, экранирование, сплющивание ai_* и ISO-время', () => {
    const csv = toCsv(
      [
        {
          id: 'u/post/1',
          text: 'Текст, с запятой и "кавычками"',
          likes: 3,
          firstSeenAt: Date.UTC(2026, 8, 25, 10, 0),
          ai: { lprScore: 77, niche: 'эксперт' },
          actionStatus: 'none',
        },
      ],
      COLUMNS.posts,
    );
    expect(csv.startsWith('﻿')).toBe(true);
    const [header, row] = csv.replace('﻿', '').split('\r\n');
    expect(header).toBe(COLUMNS.posts.join(','));
    expect(row).toContain('"Текст, с запятой и ""кавычками"""');
    expect(row).toContain('2026-09-25T10:00:00.000Z');
    expect(row).toContain(',77,эксперт,');
  });
});

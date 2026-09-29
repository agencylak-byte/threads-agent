import { openDb } from './db';
import type { ObservedPost, Post, PostActionStatus, PostAi } from '@/shared/types';

// Правило: каждый увиденный пост сохраняется сразу. Повторный показ обновляет счётчики и снимок автора,
// но НЕ трогает ai/actionStatus. Поле classifiedAt (0 = нет) держим отдельно для индекса byClassified.

type StoredPost = Post & { classifiedAt: number };

function toObserved(p: ObservedPost): ObservedPost {
  return p;
}

export async function upsertPosts(observed: ObservedPost[], now = Date.now()): Promise<{ inserted: number; updated: number }> {
  const db = await openDb();
  const tx = db.transaction('posts', 'readwrite');
  let inserted = 0;
  let updated = 0;
  for (const raw of observed) {
    const o = toObserved(raw);
    const existing = (await tx.store.get(o.id)) as StoredPost | undefined;
    if (existing) {
      const next: StoredPost = {
        ...existing,
        ...o,
        // не даём пустым значениям затирать заполненные
        text: o.text || existing.text,
        authorName: o.authorName ?? existing.authorName,
        authorBioSnapshot: o.authorBioSnapshot ?? existing.authorBioSnapshot,
        authorFollowersSnapshot: o.authorFollowersSnapshot ?? existing.authorFollowersSnapshot,
        postedAt: o.postedAt ?? existing.postedAt,
        // источник оставляем первый (откуда впервые нашли)
        source: existing.source,
        sourceDetail: existing.sourceDetail ?? o.sourceDetail,
        firstSeenAt: existing.firstSeenAt,
        lastSeenAt: now,
        seenCount: existing.seenCount + 1,
        ai: existing.ai,
        actionStatus: existing.actionStatus,
        classifiedAt: existing.classifiedAt,
      };
      await tx.store.put(next);
      updated++;
    } else {
      const next: StoredPost = {
        ...o,
        firstSeenAt: now,
        lastSeenAt: now,
        seenCount: 1,
        actionStatus: 'none',
        classifiedAt: 0,
      };
      await tx.store.put(next);
      inserted++;
    }
  }
  await tx.done;
  return { inserted, updated };
}

export async function getPost(id: string): Promise<Post | undefined> {
  return (await openDb()).get('posts', id);
}

export async function countPosts(): Promise<number> {
  return (await openDb()).count('posts');
}

/** Неклассифицированные посты, самые свежие первыми. */
export async function listUnclassified(limit: number): Promise<Post[]> {
  const db = await openDb();
  const all = await db.getAllFromIndex('posts', 'byClassified', IDBKeyRange.only(0));
  return all.sort((a, b) => b.firstSeenAt - a.firstSeenAt).slice(0, limit);
}

export async function markClassified(id: string, ai: PostAi): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('posts', 'readwrite');
  const p = (await tx.store.get(id)) as StoredPost | undefined;
  if (p) await tx.store.put({ ...p, ai, classifiedAt: ai.at } as StoredPost);
  await tx.done;
}

export async function setActionStatus(id: string, actionStatus: PostActionStatus): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('posts', 'readwrite');
  const p = await tx.store.get(id);
  if (p) await tx.store.put({ ...p, actionStatus });
  await tx.done;
}

/** Кандидаты в комментарии: главный порог commentScore, вспомогательные — ЛПР и тема; без действия, не старше N дней. */
export async function listCandidates(
  minScore: number,
  maxAgeMs: number,
  limit: number,
  now = Date.now(),
  minRelevance = 0,
  minComment = 0,
): Promise<Post[]> {
  const db = await openDb();
  const all = await db.getAllFromIndex('posts', 'byLprScore', IDBKeyRange.lowerBound(minScore));
  return all
    .filter((p) => p.actionStatus === 'none' && !p.ai?.isFreelancer && p.source !== 'own')
    .filter((p) => (p.ai?.commentScore ?? 0) >= minComment && (p.ai?.relevance ?? 0) >= minRelevance)
    .filter((p) => (p.postedAt ? now - p.postedAt <= maxAgeMs : now - p.firstSeenAt <= maxAgeMs))
    .sort((a, b) => (b.ai?.commentScore ?? 0) - (a.ai?.commentScore ?? 0) || b.firstSeenAt - a.firstSeenAt)
    .slice(0, limit);
}

/** Миграция: посты, оценённые старым промтом (без commentScore), отправить на переоценку. Возвращает число. */
export async function resetClassificationWithoutRelevance(): Promise<number> {
  const db = await openDb();
  const tx = db.transaction('posts', 'readwrite');
  let n = 0;
  let cursor = await tx.store.openCursor();
  while (cursor) {
    const p = cursor.value as StoredPost;
    if (p.ai && p.ai.commentScore === undefined && p.actionStatus !== 'commented') {
      await cursor.update({ ...p, classifiedAt: 0, actionStatus: p.actionStatus === 'proposed' ? 'none' : p.actionStatus } as StoredPost);
      n++;
    }
    cursor = await cursor.continue();
  }
  await tx.done;
  return n;
}

/** Вернуть посты в 'none' (кроме прокомментированных) — чтобы планировщик рассмотрел их заново. */
export async function resetActionStatus(keepIds: Set<string>): Promise<number> {
  const db = await openDb();
  const tx = db.transaction('posts', 'readwrite');
  let n = 0;
  let cursor = await tx.store.openCursor();
  while (cursor) {
    const p = cursor.value;
    if ((p.actionStatus === 'skipped' || p.actionStatus === 'proposed') && !keepIds.has(p.id)) {
      await cursor.update({ ...p, actionStatus: 'none' });
      n++;
    }
    cursor = await cursor.continue();
  }
  await tx.done;
  return n;
}

export async function listPostsByAuthor(handle: string): Promise<Post[]> {
  return (await openDb()).getAllFromIndex('posts', 'byAuthor', handle);
}

export async function listRecentPosts(limit: number): Promise<Post[]> {
  const db = await openDb();
  const out: Post[] = [];
  let cursor = await db.transaction('posts').store.index('byLastSeen').openCursor(null, 'prev');
  while (cursor && out.length < limit) {
    out.push(cursor.value);
    cursor = await cursor.continue();
  }
  return out;
}

export async function getAllPosts(): Promise<Post[]> {
  return (await openDb()).getAll('posts');
}

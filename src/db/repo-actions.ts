import { openDb } from './db';
import type { Action, ActionStatus, ActionType, AutonomyMode } from '@/shared/types';

// Единственная точка создания Action: здесь же защита от дублей по dedupeKey.

export class DuplicateActionError extends Error {
  constructor(public readonly dedupeKey: string) {
    super(`Action with dedupeKey "${dedupeKey}" already exists`);
  }
}

export function makeDedupeKey(type: ActionType, target: { postId?: string; threadUrl?: string; parentId?: string; handle: string }): string {
  switch (type) {
    case 'comment-on-stranger':
      return `comment:${target.postId}`;
    case 'reply-own-post':
    case 'reply-thread':
      return `reply:${target.threadUrl ?? target.postId}:${target.parentId ?? ''}`;
    case 'dm-first':
      return `dm1:${target.handle}`;
    case 'dm-continue':
      return `dm:${target.handle}:${target.parentId ?? Date.now()}`;
    case 'publish-post':
      return `post:${target.postId ?? crypto.randomUUID()}`;
  }
}

export interface NewAction {
  type: ActionType;
  targetHandle: string;
  targetPostId?: string;
  threadUrl?: string;
  parentCommentId?: string;
  context: string;
  dedupeKey: string;
  autonomyMode: AutonomyMode;
  draftText?: string;
  llm?: Action['llm'];
}

export async function createAction(input: NewAction, now = Date.now()): Promise<Action> {
  const db = await openDb();
  const tx = db.transaction('actions', 'readwrite');
  const dup = await tx.store.index('byDedupeKey').get(input.dedupeKey);
  if (dup && dup.status === 'expired') {
    await tx.store.delete(dup.id);
  } else if (dup) {
    await tx.done;
    throw new DuplicateActionError(input.dedupeKey);
  }
  const status: ActionStatus = input.autonomyMode === 'auto' ? 'queued' : 'proposed';
  const action: Action = {
    id: crypto.randomUUID(),
    status,
    editedByHuman: false,
    createdAt: now,
    proposedAt: status === 'proposed' ? now : undefined,
    attempts: 0,
    outcome: {},
    ...input,
  };
  await tx.store.put(action);
  await tx.done;
  return action;
}

export async function getActionByKey(dedupeKey: string): Promise<Action | undefined> {
  return (await openDb()).getFromIndex('actions', 'byDedupeKey', dedupeKey);
}

/**
 * Занят ли ключ. Просроченное/снятое системой предложение (expired) место НЕ занимает —
 * удаляем его, чтобы пост можно было предложить заново. Отклонённое Лерой (rejected) — занимает.
 */
export async function hasActionWithKey(dedupeKey: string): Promise<boolean> {
  const db = await openDb();
  const existing = await db.getFromIndex('actions', 'byDedupeKey', dedupeKey);
  if (!existing) return false;
  if (existing.status === 'expired') {
    await db.delete('actions', existing.id);
    return false;
  }
  return true;
}

/** Удалить все expired-действия. Возвращает id постов, у которых они были. */
export async function purgeExpired(): Promise<string[]> {
  const db = await openDb();
  const tx = db.transaction('actions', 'readwrite');
  const postIds: string[] = [];
  let cursor = await tx.store.index('byStatus').openCursor('expired');
  while (cursor) {
    if (cursor.value.targetPostId) postIds.push(cursor.value.targetPostId);
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
  return postIds;
}

export async function getAction(id: string): Promise<Action | undefined> {
  return (await openDb()).get('actions', id);
}

export async function updateAction(id: string, patch: Partial<Action>): Promise<Action | undefined> {
  const db = await openDb();
  const tx = db.transaction('actions', 'readwrite');
  const a = await tx.store.get(id);
  if (!a) {
    await tx.done;
    return undefined;
  }
  const next = { ...a, ...patch };
  await tx.store.put(next);
  await tx.done;
  return next;
}

export async function listActionsByStatus(statuses: ActionStatus[], limit = 200): Promise<Action[]> {
  const db = await openDb();
  const out: Action[] = [];
  for (const s of statuses) out.push(...(await db.getAllFromIndex('actions', 'byStatus', s)));
  return out.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

export async function listActionsByTargetHandle(handle: string): Promise<Action[]> {
  return (await openDb()).getAllFromIndex('actions', 'byTargetHandle', handle);
}

export async function listActionsByTargetPost(postId: string): Promise<Action[]> {
  return (await openDb()).getAllFromIndex('actions', 'byTargetPost', postId);
}

/** Исполненные действия с executedAt в [from, to). */
export async function listExecutedBetween(from: number, to: number): Promise<Action[]> {
  return (await openDb()).getAllFromIndex('actions', 'byExecutedAt', IDBKeyRange.bound(from, to, false, true));
}

/** Первые N символов последних отправленных текстов — для антидубля зачинов в промтах. */
export async function recentSentOpeners(limit: number, chars = 40): Promise<string[]> {
  const done = await listActionsByStatus(['done', 'executing', 'queued', 'approved'], limit);
  return done
    .map((a) => (a.finalText ?? a.draftText ?? '').slice(0, chars).trim())
    .filter(Boolean);
}

export async function countActionsByStatus(status: ActionStatus): Promise<number> {
  return (await openDb()).countFromIndex('actions', 'byStatus', status);
}

/** Просроченные предложения → expired. Возвращает число. */
export async function expireProposals(ttlMs: number, now = Date.now()): Promise<number> {
  const db = await openDb();
  const tx = db.transaction('actions', 'readwrite');
  let n = 0;
  let cursor = await tx.store.index('byStatus').openCursor('proposed');
  while (cursor) {
    if (now - (cursor.value.proposedAt ?? cursor.value.createdAt) > ttlMs) {
      await cursor.update({ ...cursor.value, status: 'expired', decidedAt: now });
      n++;
    }
    cursor = await cursor.continue();
  }
  await tx.done;
  return n;
}

/** Снять с очереди все предложенные (без текста или с текстом) — например, после смены правил отбора. */
export async function expireAllProposed(reason: string, now = Date.now()): Promise<number> {
  const db = await openDb();
  const tx = db.transaction('actions', 'readwrite');
  let n = 0;
  let cursor = await tx.store.index('byStatus').openCursor('proposed');
  while (cursor) {
    await cursor.update({ ...cursor.value, status: 'expired', rejectReason: reason, decidedAt: now });
    n++;
    cursor = await cursor.continue();
  }
  await tx.done;
  return n;
}

export async function getAllActions(): Promise<Action[]> {
  return (await openDb()).getAll('actions');
}

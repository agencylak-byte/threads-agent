import { openDb } from './db';
import type { EventKind, EventRecord } from '@/shared/types';

export async function addEvent(e: EventRecord): Promise<number> {
  const db = await openDb();
  const { id: _id, ...rest } = e;
  return db.add('events', rest as EventRecord);
}

export async function listEvents(limit = 100, kind?: EventKind): Promise<EventRecord[]> {
  const db = await openDb();
  const out: EventRecord[] = [];
  const idx = kind ? db.transaction('events').store.index('byKind') : db.transaction('events').store.index('byAt');
  let cursor = await idx.openCursor(kind ? IDBKeyRange.only(kind) : null, 'prev');
  while (cursor && out.length < limit) {
    out.push(cursor.value);
    cursor = await cursor.continue();
  }
  return kind ? out.sort((a, b) => b.at - a.at) : out;
}

export async function countEvents(): Promise<number> {
  return (await openDb()).count('events');
}

/** Чистка: держим не больше N последних событий. */
export async function pruneEvents(keep = 5000): Promise<void> {
  const db = await openDb();
  const total = await db.count('events');
  if (total <= keep) return;
  const tx = db.transaction('events', 'readwrite');
  let toDelete = total - keep;
  let cursor = await tx.store.index('byAt').openCursor();
  while (cursor && toDelete > 0) {
    await cursor.delete();
    toDelete--;
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function getAllEvents(): Promise<EventRecord[]> {
  return (await openDb()).getAll('events');
}

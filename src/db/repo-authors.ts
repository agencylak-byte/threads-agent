import { openDb } from './db';
import type { Author, ObservedProfile, Relationship } from '@/shared/types';

const RELATIONSHIP_RANK: Record<Relationship, number> = {
  stranger: 0,
  commented: 1,
  replied_us: 2,
  dm_open: 3,
  lead: 4,
  client: 5,
  do_not_contact: 99,
};

/** Отношение двигается только «вглубь» (кроме явного ручного сброса). */
export function nextRelationship(current: Relationship, proposed: Relationship): Relationship {
  return RELATIONSHIP_RANK[proposed] >= RELATIONSHIP_RANK[current] ? proposed : current;
}

export async function upsertAuthor(
  partial: Partial<Author> & { handle: string },
  now = Date.now(),
): Promise<Author> {
  const db = await openDb();
  const tx = db.transaction('authors', 'readwrite');
  const existing = await tx.store.get(partial.handle);
  const next: Author = existing
    ? {
        ...existing,
        ...partial,
        displayName: partial.displayName ?? existing.displayName,
        bio: partial.bio ?? existing.bio,
        followers: partial.followers ?? existing.followers,
        tags: partial.tags ?? existing.tags,
        lprScoreMax: Math.max(existing.lprScoreMax ?? 0, partial.lprScoreMax ?? 0) || existing.lprScoreMax,
        relationship: partial.relationship ? nextRelationship(existing.relationship, partial.relationship) : existing.relationship,
        lastSeenAt: now,
      }
    : {
        tags: [],
        relationship: 'stranger',
        ...partial,
        handle: partial.handle,
        lastSeenAt: now,
      };
  await tx.store.put(next);
  await tx.done;
  return next;
}

export async function upsertAuthorFromProfile(p: ObservedProfile, now = Date.now()): Promise<Author> {
  return upsertAuthor(
    { handle: p.handle, displayName: p.displayName, bio: p.bio, followers: p.followers },
    now,
  );
}

export async function getAuthor(handle: string): Promise<Author | undefined> {
  return (await openDb()).get('authors', handle);
}

export async function setRelationship(handle: string, relationship: Relationship, force = false): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('authors', 'readwrite');
  const a = await tx.store.get(handle);
  if (a) {
    await tx.store.put({ ...a, relationship: force ? relationship : nextRelationship(a.relationship, relationship) });
  } else {
    await tx.store.put({ handle, tags: [], relationship, lastSeenAt: Date.now() });
  }
  await tx.done;
}

export async function touchAuthorAction(handle: string, at = Date.now()): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('authors', 'readwrite');
  const a = await tx.store.get(handle);
  await tx.store.put(a ? { ...a, lastActionAt: at } : { handle, tags: [], relationship: 'stranger', lastSeenAt: at, lastActionAt: at });
  await tx.done;
}

export async function countAuthors(): Promise<number> {
  return (await openDb()).count('authors');
}

export async function getAllAuthors(): Promise<Author[]> {
  return (await openDb()).getAll('authors');
}

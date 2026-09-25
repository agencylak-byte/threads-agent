import { openDb } from './db';
import type { DmMessage, DmStage, DmThread } from '@/shared/types';

// Личка — фаза 4. Репозиторий заложен, чтобы схема и типы были стабильны с первого релиза.

export async function getThread(handle: string): Promise<DmThread | undefined> {
  return (await openDb()).get('dm_threads', handle);
}

export async function appendMessage(handle: string, msg: DmMessage, threadUrl?: string): Promise<DmThread> {
  const db = await openDb();
  const tx = db.transaction('dm_threads', 'readwrite');
  const t: DmThread = (await tx.store.get(handle)) ?? { handle, stage: 'awaiting', messages: [], unread: false };
  const exists = t.messages.some((m) => m.dir === msg.dir && m.text === msg.text && Math.abs(m.at - msg.at) < 60_000);
  const next: DmThread = exists
    ? t
    : {
        ...t,
        threadUrl: threadUrl ?? t.threadUrl,
        messages: [...t.messages, msg].sort((a, b) => a.at - b.at),
        lastInboundAt: msg.dir === 'in' ? Math.max(t.lastInboundAt ?? 0, msg.at) : t.lastInboundAt,
        lastOutboundAt: msg.dir === 'out' ? Math.max(t.lastOutboundAt ?? 0, msg.at) : t.lastOutboundAt,
        unread: msg.dir === 'in' ? true : t.unread,
        stage: t.stage === 'first_sent' && msg.dir === 'in' ? 'replied' : t.stage,
      };
  await tx.store.put(next);
  await tx.done;
  return next;
}

export async function setStage(handle: string, stage: DmStage, summary?: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('dm_threads', 'readwrite');
  const t = await tx.store.get(handle);
  if (t) await tx.store.put({ ...t, stage, summary: summary ?? t.summary, unread: false });
  await tx.done;
}

export async function listThreadsByStage(stage: DmStage): Promise<DmThread[]> {
  return (await openDb()).getAllFromIndex('dm_threads', 'byStage', stage);
}

export async function listUnread(): Promise<DmThread[]> {
  return (await (await openDb()).getAll('dm_threads')).filter((t) => t.unread);
}

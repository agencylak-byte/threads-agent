import type { DBSchema, IDBPDatabase } from 'idb';
import type {
  Action,
  Author,
  DmThread,
  EventRecord,
  MetricsDaily,
  OwnPost,
  Post,
  SyncOutboxItem,
} from '@/shared/types';

// Схема IndexedDB v1 — все store'ы заложены сразу, включая для фаз 4–5 (личка, синк).

export interface ThreadsAgentDB extends DBSchema {
  posts: {
    key: string;
    value: Post;
    indexes: {
      byAuthor: string;
      bySource: string;
      byFirstSeen: number;
      byLastSeen: number;
      byLprScore: number;
      byActionStatus: string;
      byClassified: number; // 0 = не классифицирован
    };
  };
  authors: {
    key: string;
    value: Author;
    indexes: { byRelationship: string; byLprScoreMax: number; byLastActionAt: number; byLastSeen: number };
  };
  actions: {
    key: string;
    value: Action;
    indexes: {
      byStatus: string;
      byType: string;
      byTargetPost: string;
      byTargetHandle: string;
      byScheduledFor: number;
      byExecutedAt: number;
      byCreatedAt: number;
      byDedupeKey: string; // unique
    };
  };
  dm_threads: {
    key: string;
    value: DmThread;
    indexes: { byStage: string; byLastInbound: number };
  };
  own_posts: {
    key: string;
    value: OwnPost;
    indexes: { byPublishedAt: number };
  };
  metrics_daily: {
    key: string;
    value: MetricsDaily;
  };
  events: {
    key: number;
    value: EventRecord;
    indexes: { byAt: number; byKind: string };
  };
  sync_outbox: {
    key: number;
    value: SyncOutboxItem;
    indexes: { byStore: string };
  };
}

export type DB = IDBPDatabase<ThreadsAgentDB>;
export type StoreName = keyof ThreadsAgentDB & string;

/** Создание store'ов и индексов при первой установке. Вызывается из openDb(). */
export function upgradeV1(db: IDBPDatabase<ThreadsAgentDB>): void {
  const posts = db.createObjectStore('posts', { keyPath: 'id' });
  posts.createIndex('byAuthor', 'authorHandle');
  posts.createIndex('bySource', 'source');
  posts.createIndex('byFirstSeen', 'firstSeenAt');
  posts.createIndex('byLastSeen', 'lastSeenAt');
  posts.createIndex('byLprScore', 'ai.lprScore');
  posts.createIndex('byActionStatus', 'actionStatus');
  posts.createIndex('byClassified', 'classifiedAt');

  const authors = db.createObjectStore('authors', { keyPath: 'handle' });
  authors.createIndex('byRelationship', 'relationship');
  authors.createIndex('byLprScoreMax', 'lprScoreMax');
  authors.createIndex('byLastActionAt', 'lastActionAt');
  authors.createIndex('byLastSeen', 'lastSeenAt');

  const actions = db.createObjectStore('actions', { keyPath: 'id' });
  actions.createIndex('byStatus', 'status');
  actions.createIndex('byType', 'type');
  actions.createIndex('byTargetPost', 'targetPostId');
  actions.createIndex('byTargetHandle', 'targetHandle');
  actions.createIndex('byScheduledFor', 'scheduledFor');
  actions.createIndex('byExecutedAt', 'executedAt');
  actions.createIndex('byCreatedAt', 'createdAt');
  actions.createIndex('byDedupeKey', 'dedupeKey', { unique: true });

  const dm = db.createObjectStore('dm_threads', { keyPath: 'handle' });
  dm.createIndex('byStage', 'stage');
  dm.createIndex('byLastInbound', 'lastInboundAt');

  const own = db.createObjectStore('own_posts', { keyPath: 'id' });
  own.createIndex('byPublishedAt', 'publishedAt');

  db.createObjectStore('metrics_daily', { keyPath: 'date' });

  const events = db.createObjectStore('events', { keyPath: 'id', autoIncrement: true });
  events.createIndex('byAt', 'at');
  events.createIndex('byKind', 'kind');

  const outbox = db.createObjectStore('sync_outbox', { keyPath: 'id', autoIncrement: true });
  outbox.createIndex('byStore', 'store');
}

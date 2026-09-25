import { openDb } from './db';
import type { MetricsDaily } from '@/shared/types';

export function emptyMetrics(date: string): MetricsDaily {
  return {
    date,
    commentsSent: 0,
    repliesSent: 0,
    dmFirstSent: 0,
    dmContinueSent: 0,
    postsPublished: 0,
    repliesReceived: 0,
    dmRepliesReceived: 0,
    leads: 0,
    llmCostUsd: 0,
  };
}

/** YYYY-MM-DD в указанной таймзоне. */
export function dateKey(ts: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ts));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export async function getMetrics(date: string): Promise<MetricsDaily> {
  return (await (await openDb()).get('metrics_daily', date)) ?? emptyMetrics(date);
}

type NumericKey = {
  [K in keyof MetricsDaily]-?: NonNullable<MetricsDaily[K]> extends number ? K : never;
}[keyof MetricsDaily];

export async function bumpMetric(date: string, key: NumericKey, delta = 1): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('metrics_daily', 'readwrite');
  const m = (await tx.store.get(date)) ?? emptyMetrics(date);
  const current = (m[key] as number | undefined) ?? 0;
  await tx.store.put({ ...m, [key]: current + delta });
  await tx.done;
}

export async function setMetric(date: string, patch: Partial<MetricsDaily>): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('metrics_daily', 'readwrite');
  const m = (await tx.store.get(date)) ?? emptyMetrics(date);
  await tx.store.put({ ...m, ...patch, date });
  await tx.done;
}

export async function listMetrics(days = 30): Promise<MetricsDaily[]> {
  const all = await (await openDb()).getAll('metrics_daily');
  return all.sort((a, b) => a.date.localeCompare(b.date)).slice(-days);
}

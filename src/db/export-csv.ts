import { COLUMNS, flattenRecord, type ExportStore } from './columns';
import { getAllPosts } from './repo-posts';
import { getAllAuthors } from './repo-authors';
import { getAllActions } from './repo-actions';
import { getAllEvents } from './repo-events';
import { listMetrics } from './repo-metrics';
import { openDb } from './db';

const BOM = '﻿';

function escapeCell(s: string): string {
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV c BOM (чтобы Excel/Sheets поняли UTF-8), разделитель — запятая. */
export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const lines = [columns.join(',')];
  for (const r of rows) {
    const flat = flattenRecord(r, columns);
    lines.push(columns.map((c) => escapeCell(flat[c] ?? '')).join(','));
  }
  return BOM + lines.join('\r\n') + '\r\n';
}

export async function loadStoreRows(store: ExportStore): Promise<Record<string, unknown>[]> {
  switch (store) {
    case 'posts':
      return (await getAllPosts()) as unknown as Record<string, unknown>[];
    case 'authors':
      return (await getAllAuthors()) as unknown as Record<string, unknown>[];
    case 'actions':
      return (await getAllActions()) as unknown as Record<string, unknown>[];
    case 'events':
      return (await getAllEvents()) as unknown as Record<string, unknown>[];
    case 'metrics_daily':
      return (await listMetrics(3650)) as unknown as Record<string, unknown>[];
    case 'own_posts':
      return (await (await openDb()).getAll('own_posts')) as unknown as Record<string, unknown>[];
  }
}

export async function exportStoreCsv(store: ExportStore): Promise<string> {
  return toCsv(await loadStoreRows(store), COLUMNS[store]);
}

/** Скачивание через chrome.downloads (service worker: без Blob URL, через data:). */
export async function downloadCsv(store: ExportStore, now = new Date()): Promise<void> {
  const csv = await exportStoreCsv(store);
  const stamp = now.toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const url = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  await browser.downloads.download({ url, filename: `threads-agent/${store}-${stamp}.csv`, saveAs: false });
}

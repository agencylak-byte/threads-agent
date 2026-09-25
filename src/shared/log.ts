import type { EventKind, EventRecord } from './types';

// Структурный лог: в консоль всегда; в store `events` — если подключён sink (в service worker).

type Sink = (e: EventRecord) => Promise<void> | void;
let sink: Sink | null = null;

export function setLogSink(s: Sink | null): void {
  sink = s;
}

export function log(kind: EventKind, message: string, payload?: unknown, url?: string): void {
  const e: EventRecord = { at: Date.now(), kind, message, payload, url };
  const fn = kind === 'error' ? console.error : kind === 'anomaly' ? console.warn : console.info;
  fn(`[threads-agent:${kind}] ${message}`, payload ?? '');
  if (sink) void Promise.resolve(sink(e)).catch(() => {});
}

import { PORT_NAME } from '@/shared/constants';
import type { ContentToSw, SwToContent } from '@/shared/messages';
import { log } from '@/shared/log';

// Реестр портов content-скриптов: по одному на вкладку threads.com.
// Даёт «запрос → ожидание конкретного ответа» поверх односторонних сообщений порта.

type Listener = (msg: ContentToSw, tabId: number) => void;

const ports = new Map<number, chrome.runtime.Port>();
const listeners = new Set<Listener>();

export function initPorts(): void {
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME) return;
    const tabId = port.sender?.tab?.id;
    if (tabId === undefined) return;
    ports.set(tabId, port);
    port.onMessage.addListener((msg: ContentToSw) => {
      for (const l of listeners) {
        try {
          l(msg, tabId);
        } catch (e) {
          log('error', 'port listener failed', String(e));
        }
      }
    });
    port.onDisconnect.addListener(() => {
      if (ports.get(tabId) === port) ports.delete(tabId);
    });
  });
}

export function onContentMessage(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function hasPort(tabId: number): boolean {
  return ports.has(tabId);
}

export function sendToTab(tabId: number, msg: SwToContent): boolean {
  const p = ports.get(tabId);
  if (!p) return false;
  try {
    p.postMessage(msg);
    return true;
  } catch {
    ports.delete(tabId);
    return false;
  }
}

/** Ждём первое сообщение из вкладки, удовлетворяющее предикату. */
export function waitForMessage<T extends ContentToSw>(
  tabId: number,
  predicate: (m: ContentToSw) => m is T,
  timeoutMs: number,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`timeout waiting for content message (${timeoutMs}ms)`));
    }, timeoutMs);
    const off = onContentMessage((m, fromTab) => {
      if (fromTab !== tabId || !predicate(m)) return;
      clearTimeout(timer);
      off();
      resolve(m);
    });
  });
}

/** Ждём, пока вкладка подключит порт (после навигации content-скрипт грузится заново). */
export async function waitForPort(tabId: number, timeoutMs = 20_000): Promise<void> {
  const started = Date.now();
  while (!ports.has(tabId)) {
    if (Date.now() - started > timeoutMs) throw new Error('content script did not connect');
    await new Promise((r) => setTimeout(r, 200));
  }
}

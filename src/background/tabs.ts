import { workTabItem } from '@/shared/settings';
import { THREADS_ORIGIN } from '@/shared/constants';
import { sendToTab, waitForMessage, waitForPort } from './ports';
import type { ContentToSw } from '@/shared/messages';

// Одна «рабочая» вкладка threads.com. Все джобы и действия идут через неё.

function isThreadsUrl(url?: string): boolean {
  return !!url && /^https:\/\/(www\.)?threads\.com\//.test(url);
}

export async function getWorkTab(create = true): Promise<number> {
  // Если пользователь сейчас смотрит на threads.com — работаем с этой вкладкой (у фоновой вкладки лента не отрисована).
  const [active] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  if (active?.id !== undefined && isThreadsUrl(active.url)) {
    await workTabItem.setValue(active.id);
    return active.id;
  }
  const saved = await workTabItem.getValue();
  if (saved !== null) {
    try {
      const t = await browser.tabs.get(saved);
      if (t.id !== undefined && isThreadsUrl(t.url)) return t.id;
    } catch {
      // вкладка закрыта
    }
  }
  const existing = (await browser.tabs.query({ url: ['*://www.threads.com/*', '*://threads.com/*'] })).find(
    (t) => t.id !== undefined,
  );
  if (existing?.id !== undefined) {
    await workTabItem.setValue(existing.id);
    return existing.id;
  }
  if (!create) throw new Error('Нет открытой вкладки threads.com');
  const created = await browser.tabs.create({ url: THREADS_ORIGIN + '/', active: false });
  if (created.id === undefined) throw new Error('Не удалось создать вкладку');
  await workTabItem.setValue(created.id);
  return created.id;
}

function samePage(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.pathname.replace(/\/$/, '') === ub.pathname.replace(/\/$/, '') && ua.search === ub.search;
  } catch {
    return a === b;
  }
}

const isPageReady = (m: ContentToSw): m is Extract<ContentToSw, { type: 'PAGE_READY' }> => m.type === 'PAGE_READY';

/** Переходим по URL и ждём PAGE_READY от content-скрипта. */
export async function navigateWorkTab(url: string, timeoutMs = 25_000): Promise<{ selfHandle?: string }> {
  const tabId = await getWorkTab();
  const tab = await browser.tabs.get(tabId);
  if (tab.url && samePage(tab.url, url)) {
    const hasPort = await waitForPort(tabId, 5000).then(() => true).catch(() => false);
    if (hasPort) {
      // страница уже открыта — просим content подтвердить готовность
      const ready = waitForMessage(tabId, isPageReady, 4000).catch(() => null);
      sendToTab(tabId, { type: 'NAVIGATE', url });
      const r = await ready;
      if (r) return { selfHandle: r.selfHandle };
    }
    // порта нет (расширение обновилось, а вкладка старая) — перезагружаем вкладку
    const ready = waitForMessage(tabId, isPageReady, timeoutMs);
    await browser.tabs.reload(tabId);
    const r = await ready;
    return { selfHandle: r.selfHandle };
  }
  const ready = waitForMessage(tabId, isPageReady, timeoutMs);
  // Полная загрузка вместо SPA-перехода: content-скрипт стартует заново, порт переподключается — так надёжнее.
  await browser.tabs.update(tabId, { url });
  const r = await ready;
  return { selfHandle: r.selfHandle };
}

export async function activateWorkTab(): Promise<void> {
  const tabId = await getWorkTab();
  await browser.tabs.update(tabId, { active: true });
}

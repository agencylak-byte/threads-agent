import { getSettings, lastWindowCreateItem, workTabItem, workWindowItem } from '@/shared/settings';
import { THREADS_ORIGIN } from '@/shared/constants';
import { sendToTab, waitForMessage, waitForPort } from './ports';
import type { ContentToSw } from '@/shared/messages';

// Одна «рабочая» вкладка threads.com. Все джобы и действия идут через неё.

function isThreadsUrl(url?: string): boolean {
  return !!url && /^https:\/\/(www\.)?threads\.com\//.test(url);
}

export async function getWorkTab(create = true): Promise<number> {
  const settings = await getSettings();
  if (settings.dedicatedWindow) return getDedicatedWorkTab(create);
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

/**
 * Отдельное окно Chrome под расширение: одна вкладка threads.com, которую двигаем мы.
 * Лера работает в своём окне и панели; это окно можно отодвинуть, но не сворачивать (свёрнутое Chrome не рисует).
 */
let windowLock: Promise<number> | null = null;

async function getDedicatedWorkTab(create: boolean): Promise<number> {
  // один вызов за раз: параллельные задачи не должны открывать по окну каждая
  if (windowLock) return windowLock;
  windowLock = resolveDedicatedWorkTab(create).finally(() => {
    windowLock = null;
  });
  return windowLock;
}

/**
 * Окно «наше», если ВСЕ его вкладки — threads.com (или пустые/новые). У Леры в рабочем окне много разных вкладок,
 * а в нашем Threads иногда сам открывает вторую вкладку — это не повод заводить новое окно.
 */
async function findOurWindows(): Promise<Array<{ windowId: number; tabId: number }>> {
  const all = await browser.windows.getAll({ populate: true, windowTypes: ['normal'] });
  const out: Array<{ windowId: number; tabId: number }> = [];
  const [focused] = await browser.windows.getAll({ windowTypes: ['normal'] }).then((ws) => ws.filter((w) => w.focused));
  for (const w of all) {
    const tabs = (w.tabs ?? []).filter((t) => t.id !== undefined);
    if (w.id === undefined || !tabs.length) continue;
    const allThreads = tabs.every((t) => isThreadsUrl(t.url) || !t.url || t.url === 'chrome://newtab/' || t.url === 'about:blank');
    const threadsTab = tabs.find((t) => isThreadsUrl(t.url));
    if (allThreads && threadsTab?.id !== undefined && w.id !== focused?.id) out.push({ windowId: w.id, tabId: threadsTab.id });
  }
  return out;
}

/** Убрать лишние окна, оставить одно (вызывается на каждом тике — дёшево). */
export async function tidyWorkWindows(): Promise<void> {
  const saved = await workWindowItem.getValue();
  const ours = await findOurWindows();
  if (!ours.length) return;
  const keep = ours.find((w) => w.windowId === saved) ?? ours[0]!;
  await workWindowItem.setValue(keep.windowId);
  await workTabItem.setValue(keep.tabId);
  for (const w of ours) if (w.windowId !== keep.windowId) await browser.windows.remove(w.windowId).catch(() => undefined);
}

async function resolveDedicatedWorkTab(create: boolean): Promise<number> {
  const savedWin = await workWindowItem.getValue();
  if (savedWin !== null) {
    try {
      const w = await browser.windows.get(savedWin, { populate: true });
      const tab = w.tabs?.find((t) => isThreadsUrl(t.url)) ?? w.tabs?.[0];
      if (tab?.id !== undefined) {
        if (!isThreadsUrl(tab.url)) await browser.tabs.update(tab.id, { url: THREADS_ORIGIN + '/' });
        await workTabItem.setValue(tab.id);
        if (w.state === 'minimized') await browser.windows.update(savedWin, { state: 'normal' });
        await closeExtraWindows(savedWin);
        return tab.id;
      }
    } catch {
      // окно закрыто
    }
  }
  // после обновления/рестарта id мог потеряться — переиспользуем уже открытое «наше» окно
  const ours = await findOurWindows();
  if (ours.length) {
    const keep = ours[0]!;
    await workWindowItem.setValue(keep.windowId);
    await workTabItem.setValue(keep.tabId);
    await closeExtraWindows(keep.windowId);
    return keep.tabId;
  }
  if (!create) throw new Error('Рабочее окно закрыто — нажмите «Открыть рабочее окно» в «Здоровье»');
  // последняя защита от размножения: если за сегодня уже создавали окно, а его не нашли — не плодим, а ищем любую вкладку threads
  const anyThreads = (await browser.tabs.query({ url: ['*://www.threads.com/*', '*://threads.com/*'] })).find((t) => t.id !== undefined && t.windowId !== undefined);
  const lastCreate = await lastWindowCreateItem.getValue();
  if (anyThreads?.id !== undefined && Date.now() - lastCreate < 6 * 3600_000) {
    await workWindowItem.setValue(anyThreads.windowId!);
    await workTabItem.setValue(anyThreads.id);
    return anyThreads.id;
  }
  const w = await browser.windows.create({ url: THREADS_ORIGIN + '/', type: 'normal', width: 960, height: 900, left: 40, top: 40, focused: false });
  const tab = w?.tabs?.[0];
  if (!w || w.id === undefined || tab?.id === undefined) throw new Error('Не удалось открыть рабочее окно');
  await workWindowItem.setValue(w.id);
  await workTabItem.setValue(tab.id);
  await lastWindowCreateItem.setValue(Date.now());
  return tab.id;
}

/** Закрыть лишние «наши» окна (по одной вкладке threads.com), кроме keepWindowId. */
async function closeExtraWindows(keepWindowId: number): Promise<void> {
  for (const w of await findOurWindows()) {
    if (w.windowId !== keepWindowId) await browser.windows.remove(w.windowId).catch(() => undefined);
  }
}

export async function closeAllWorkWindows(): Promise<number> {
  const ours = await findOurWindows();
  for (const w of ours) await browser.windows.remove(w.windowId).catch(() => undefined);
  await workWindowItem.setValue(null);
  return ours.length;
}

export async function openWorkWindow(): Promise<number> {
  return getDedicatedWorkTab(true);
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

import { q } from './selectors';
import type { Anomaly, AnomalyKind } from '@/shared/types';

// Наблюдение за признаками ограничений: тосты/диалоги с типичными текстами (ru/en), капча, редирект на login.
// Полностью подключается к движку в фазе 3; сам детектор нужен уже сейчас, чтобы копить события.

// «Повторите попытку позже» — это обычный экран ошибки загрузки Threads, а не ограничение аккаунта (разбор коллеги, задача 2).
const PATTERNS: Array<[RegExp, AnomalyKind]> = [
  [/действие заблокировано|action blocked/i, 'action_blocked'],
  [/we limit how often|мы ограничиваем|слишком часто|too many requests|rate limit/i, 'rate_limited'],
  [/подозрительн|suspicious|подтвердите, что вы|confirm it.?s you/i, 'challenge'],
];

const LOAD_ERROR = /произошла ошибка|something went wrong|не удалось загрузить|couldn.?t load|повторите попытку позже|try again later/i;

/** Экран ошибки загрузки: текст ошибки и ни одной карточки поста на странице. */
export function detectLoadError(root: ParentNode = document): HTMLElement | null {
  if (root.querySelector('[data-pressable-container]')) return null;
  const nodes = Array.from(root.querySelectorAll<HTMLElement>('main, div[role="main"], body > div, span, div'));
  for (const n of nodes) {
    const t = (n.textContent ?? '').trim();
    if (t.length < 300 && LOAD_ERROR.test(t)) return n;
  }
  return null;
}

/** Нажать «Повторить попытку»/«Retry», если есть. */
export function clickRetry(root: ParentNode = document): boolean {
  const btn = Array.from(root.querySelectorAll<HTMLElement>('div[role="button"], button, a')).find((b) =>
    /повторить попытку|повторить|retry|try again/i.test((b.textContent ?? '').trim()) && (b.textContent ?? '').trim().length < 40,
  );
  if (!btn) return false;
  btn.click();
  return true;
}

/**
 * Лечение экрана ошибки до ввода текста: кнопка «Повторить» → ждём; снова экран → перезагрузка вкладки.
 * Возвращает true, если страница живая.
 */
export async function healLoadError(): Promise<boolean> {
  if (!detectLoadError()) return true;
  if (clickRetry()) {
    await new Promise((r) => setTimeout(r, 4000));
    if (!detectLoadError()) return true;
  }
  location.reload();
  await new Promise((r) => setTimeout(r, 6000));
  return !detectLoadError();
}

export function detectAnomaly(root: ParentNode = document, url = location.href): Anomaly | null {
  if (detectLoadError(root)) return null; // не блок — лечится повтором/перезагрузкой
  const path = new URL(url).pathname;
  if (/\/(login|accounts\/login|challenge|checkpoint)/.test(path)) {
    return { kind: path.includes('challenge') || path.includes('checkpoint') ? 'challenge' : 'login_redirect', text: path, url, at: Date.now() };
  }
  if (q('captcha', root)) return { kind: 'captcha', text: 'captcha iframe', url, at: Date.now() };
  const toasts = Array.from(root.querySelectorAll<HTMLElement>('div[role="alert"], div[role="status"], div[aria-live], div[role="dialog"]'));
  for (const t of toasts) {
    const text = (t.textContent ?? '').trim().slice(0, 300);
    if (!text) continue;
    for (const [re, kind] of PATTERNS) if (re.test(text)) return { kind, text, url, at: Date.now() };
  }
  return null;
}

export function startAnomalyWatch(onAnomaly: (a: Anomaly) => void): () => void {
  let lastKey = '';
  const check = () => {
    const a = detectAnomaly();
    if (!a) return;
    const key = `${a.kind}:${a.text.slice(0, 60)}`;
    if (key === lastKey) return; // тот же тост висит — не спамим
    lastKey = key;
    onAnomaly(a);
    setTimeout(() => {
      if (lastKey === key) lastKey = '';
    }, 60_000);
  };
  const obs = new MutationObserver(check);
  obs.observe(document.body, { childList: true, subtree: true });
  const timer = setInterval(check, 3000);
  return () => {
    obs.disconnect();
    clearInterval(timer);
  };
}

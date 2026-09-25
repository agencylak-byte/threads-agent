import { q } from './selectors';
import type { Anomaly, AnomalyKind } from '@/shared/types';

// Наблюдение за признаками ограничений: тосты/диалоги с типичными текстами (ru/en), капча, редирект на login.
// Полностью подключается к движку в фазе 3; сам детектор нужен уже сейчас, чтобы копить события.

const PATTERNS: Array<[RegExp, AnomalyKind]> = [
  [/действие заблокировано|action blocked/i, 'action_blocked'],
  [/повторите попытку позже|try again later|we limit how often|слишком часто|too many/i, 'rate_limited'],
  [/подозрительн|suspicious|подтвердите, что вы|confirm it.?s you/i, 'challenge'],
];

export function detectAnomaly(root: ParentNode = document, url = location.href): Anomaly | null {
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

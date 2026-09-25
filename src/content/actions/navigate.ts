import { sleep, waitFor } from '../dom-utils';
import { pageKind } from '../selectors';

// Навигация внутри SPA Threads. Переход по URL делает SW (chrome.tabs.update); здесь — ожидание рендера.

export function sameUrl(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.pathname === ub.pathname && ua.search === ub.search;
  } catch {
    return a === b;
  }
}

/** Ждём, пока страница станет «той»: URL совпал и на ней есть хоть какой-то контент нужного типа. */
export async function waitForPage(expectedUrl: string, timeoutMs = 15_000): Promise<void> {
  await waitFor(() => sameUrl(location.href, expectedUrl), { timeoutMs, intervalMs: 200 });
  const kind = pageKind(location.href);
  const probe = () => {
    switch (kind) {
      case 'feed':
      case 'search':
      case 'post':
      case 'profile':
      case 'activity':
        return document.querySelector('a[href^="/@"]') !== null;
      default:
        return document.body.childElementCount > 0;
    }
  };
  await waitFor(probe, { timeoutMs, intervalMs: 250 });
  await sleep(800); // дать React дорисовать счётчики
}

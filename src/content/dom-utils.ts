// Мелкие помощники для работы с DOM и паузами. Здесь нет селекторов Threads.

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function randomBetween(min: number, max: number, rng: () => number = Math.random): number {
  return min + (max - min) * rng();
}

export const jitter = (range: readonly [number, number]): Promise<void> => sleep(randomBetween(range[0], range[1]));

/** Ждёт, пока predicate вернёт значение (не null/undefined/false), или падает по таймауту. */
export async function waitFor<T>(
  predicate: () => T | null | undefined | false,
  { timeoutMs = 8000, intervalMs = 150 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const started = Date.now();
  for (;;) {
    const v = predicate();
    if (v) return v;
    if (Date.now() - started > timeoutMs) throw new Error('waitFor: timeout');
    await sleep(intervalMs);
  }
}

export function isVisible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < (window.innerHeight || 0) + 200;
}

export function textOf(el: Element | null | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Ближайший предок, удовлетворяющий селектору, включая сам элемент. */
export function closestIn(el: Element, selector: string): Element | null {
  return el.closest(selector);
}

export function scrollIntoViewSmooth(el: Element): void {
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export async function scrollBy(px: number): Promise<void> {
  window.scrollBy({ top: px, behavior: 'smooth' });
  await sleep(300);
}

export function atPageBottom(margin = 600): boolean {
  return window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - margin;
}

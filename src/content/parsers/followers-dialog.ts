import { handleFromHref, q } from '../selectors';

// Диалог/страница подписчиков → список handle'ов. Работает и для /followers, и для модального окна.

export function parseFollowers(root: ParentNode = document, exclude: string[] = []): string[] {
  const scope = q('dialog', root) ?? root;
  const links = Array.from(scope.querySelectorAll<HTMLAnchorElement>('a[href^="/@"]'));
  const out: string[] = [];
  const seen = new Set<string>(exclude);
  for (const a of links) {
    const href = a.getAttribute('href') ?? '';
    if (href.includes('/post/')) continue;
    const h = handleFromHref(href);
    if (!h || seen.has(h)) continue;
    seen.add(h);
    out.push(h);
  }
  return out;
}

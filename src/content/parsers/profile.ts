import { LABELS, handleFromHref, q, qa } from '../selectors';
import { textOf } from '../dom-utils';
import { parseCount } from './numbers';
import type { ObservedProfile } from '@/shared/types';

// Шапка профиля /@handle → ObservedProfile. Подписчики ищем по тексту «N подписчиков» / «N followers».

export function parseProfile(url: string, root: ParentNode = document, selfHandle?: string): ObservedProfile | null {
  const handle = handleFromHref(new URL(url).pathname);
  if (!handle) return null;
  const header = q('profileHeader', root) ?? root;

  const nameEl = header.querySelector('h1, h2');
  const displayName = textOf(nameEl) || undefined;

  const followers = findFollowers(root);

  const bio = qa<HTMLElement>('profileBio', header)
    .map(textOf)
    .filter((t) => t && t !== handle && t !== displayName && !LABELS.followers.some((f) => t.toLowerCase().includes(f)))
    .filter((t) => t.length > 2)
    .slice(0, 3)
    .join('\n') || undefined;

  return { handle, displayName, bio, followers, isSelf: !!selfHandle && selfHandle === handle };
}

function findFollowers(root: ParentNode): number | undefined {
  const link = root.querySelector('a[href$="/followers"]');
  if (link) {
    const n = parseCount(textOf(link));
    if (n > 0) return n;
  }
  const candidates = Array.from(root.querySelectorAll<HTMLElement>('a, span, div[role="button"]'));
  for (const el of candidates) {
    const t = textOf(el);
    if (t.length > 40) continue;
    const low = t.toLowerCase();
    if (LABELS.followers.some((f) => low.includes(f))) {
      const n = parseCount(t);
      if (n > 0) return n;
    }
  }
  return undefined;
}

/** Свой handle — из ссылки «Профиль» в левом меню. */
export function detectSelfHandle(root: ParentNode = document): string | null {
  const nav = q<HTMLAnchorElement>('navProfileLink', root);
  const h = handleFromHref(nav?.getAttribute('href'));
  if (h) return h;
  // fallback: единственная ссылка /@handle вне контейнеров постов
  const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href^="/@"]')).filter(
    (a) => !a.closest('[data-pressable-container]') && !a.closest('article') && !a.getAttribute('href')?.includes('/post/'),
  );
  const handles = new Set(links.map((a) => handleFromHref(a.getAttribute('href'))).filter(Boolean));
  return handles.size === 1 ? (Array.from(handles)[0] as string) : null;
}

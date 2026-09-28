import { LABELS, handleFromHref, q, qa } from '../selectors';
import { textOf } from '../dom-utils';
import { parseCount } from './numbers';
import type { ObservedProfile } from '@/shared/types';

// Шапка профиля /@handle → ObservedProfile. Реальная вёрстка (снимок 25.09.2026):
//   <h1 dir="auto" translate="no">Имя</h1> → <span dir="auto" translate="no">handle</span> → <span dir="auto">bio</span>
//   → теги → <div role="button"><span dir="auto"><span title="1234">1,2 тыс.</span> подписчиков</span></div> → вкладки «Ветки/Ответы…».

export function parseProfile(url: string, root: ParentNode = document, selfHandle?: string): ObservedProfile | null {
  const handle = handleFromHref(new URL(url).pathname);
  if (!handle) return null;

  const nameEl = findNameHeading(root, handle);
  const displayName = textOf(nameEl) || undefined;
  const followers = findFollowers(root);
  const bio = nameEl ? findBio(nameEl, root, handle, displayName) : undefined;

  return { handle, displayName, bio, followers, isSelf: !!selfHandle && selfHandle === handle };
}

/** Имя — h1, чей текст не равен handle (первый h1 в колонке — заголовок столбца с handle). */
function findNameHeading(root: ParentNode, handle: string): HTMLElement | null {
  const all = qa<HTMLElement>('profileHeader', root);
  return all.find((h) => textOf(h) && textOf(h) !== handle && !h.closest('a')) ?? all[0] ?? null;
}

/** Bio — текстовые span'ы между именем и вкладками профиля, исключая handle, теги-ссылки, подписчиков, кнопки. */
function findBio(nameEl: HTMLElement, root: ParentNode, handle: string, displayName?: string): string | undefined {
  const tabs = root.querySelector('a[href$="/replies"], a[href$="/media"], a[aria-label="Ответы"], a[aria-label="Replies"]');
  const spans = Array.from(root.querySelectorAll<HTMLElement>('span[dir="auto"]'));
  const parts: string[] = [];
  for (const s of spans) {
    if (!(nameEl.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
    if (tabs && !(s.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING)) break;
    if (s.closest('a, [role="button"], [data-pressable-container], [inert]')) continue;
    if (s.querySelector('span[dir="auto"]')) continue;
    const t = textOf(s);
    if (!t || t === handle || t === displayName || t === '+') continue;
    if (LABELS.followers.some((f) => t.toLowerCase().includes(f))) continue;
    parts.push(t);
    if (parts.length >= 3) break;
  }
  return parts.join('\n') || undefined;
}

function findFollowers(root: ParentNode): number | undefined {
  const link = root.querySelector('a[href$="/followers"]');
  if (link) {
    const n = parseCount(link.querySelector('[title]')?.getAttribute('title') ?? textOf(link));
    if (n > 0) return n;
  }
  const candidates = Array.from(root.querySelectorAll<HTMLElement>('div[role="button"], a, span'));
  for (const el of candidates) {
    const t = textOf(el);
    if (!t || t.length > 40) continue;
    const low = t.toLowerCase();
    if (!LABELS.followers.some((f) => low.includes(f))) continue;
    const titled = el.querySelector('[title]')?.getAttribute('title');
    const n = parseCount(titled ?? t);
    if (n > 0 || /^0\b/.test(t)) return n;
  }
  return undefined;
}

/** Свой handle — из ссылки «Профиль» в левом меню. */
export function detectSelfHandle(root: ParentNode = document): string | null {
  const nav = q<HTMLAnchorElement>('navProfileLink', root);
  const h = handleFromHref(nav?.getAttribute('href'));
  if (h) return h;
  const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href^="/@"]')).filter(
    (a) => !a.closest('[data-pressable-container]') && !a.closest('article') && !a.getAttribute('href')?.includes('/post/'),
  );
  const handles = new Set(links.map((a) => handleFromHref(a.getAttribute('href'))).filter(Boolean));
  return handles.size === 1 ? (Array.from(handles)[0] as string) : null;
}

import { q, qa, postCodeFromHref, handleFromHref } from '../selectors';
import { textOf } from '../dom-utils';
import { countNear, parseCount } from './numbers';
import type { ObservedPost, PostSource } from '@/shared/types';

// Один контейнер поста → ObservedPost. Работает в ленте, поиске, профиле и на странице треда.
// Не знает про сеть и БД — чистая функция от DOM-узла.

export function postId(handle: string, code: string): string {
  return `${handle}/post/${code}`;
}

export function findPostContainers(root: ParentNode = document): Element[] {
  const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href*="/post/"]'));
  const seen = new Set<Element>();
  const out: Element[] = [];
  for (const link of links) {
    const container = qa('postContainer', root).find((c) => c.contains(link)) ?? containerFromLink(link);
    if (container && !seen.has(container)) {
      seen.add(container);
      out.push(container);
    }
  }
  return out;
}

/** Если нет data-pressable-container — берём предка, у которого есть и время, и автор. */
function containerFromLink(link: Element): Element | null {
  let el: Element | null = link.parentElement;
  for (let depth = 0; el && depth < 12; depth++) {
    if (el.querySelector('time[datetime]') && el.querySelector('a[href^="/@"]')) return el;
    el = el.parentElement;
  }
  return null;
}

export function parsePostCard(container: Element, source: PostSource, sourceDetail?: string): ObservedPost | null {
  const links = Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href*="/post/"]'));
  const permalink = links.find((a) => a.querySelector('time')) ?? links[0];
  const ref = postCodeFromHref(permalink?.getAttribute('href'));
  if (!ref) return null;

  const authorLink = qa<HTMLAnchorElement>('authorLink', container).find((a) => !a.getAttribute('href')?.includes('/post/'));
  const authorHandle = handleFromHref(authorLink?.getAttribute('href')) ?? ref.handle;

  const timeEl = permalink?.querySelector('time') ?? q<HTMLTimeElement>('time', container);
  const postedAt = timeEl?.getAttribute('datetime') ? Date.parse(timeEl.getAttribute('datetime')!) : undefined;

  const text = extractText(container, authorHandle);

  const likes = countNear(q('likeIcon', container));
  const replies = countNear(q('replyIcon', container));
  const reposts = countNear(q('repostIcon', container));

  return {
    id: postId(ref.handle, ref.code),
    url: `https://www.threads.com/@${ref.handle}/post/${ref.code}`,
    code: ref.code,
    authorHandle,
    authorName: authorLink ? textOf(authorLink) || undefined : undefined,
    text,
    likes,
    replies,
    reposts,
    postedAt: postedAt && Number.isFinite(postedAt) ? postedAt : undefined,
    source,
    sourceDetail,
  };
}

/** Текст поста: все dir=auto-блоки минус служебные (автор, время, счётчики). */
function extractText(container: Element, authorHandle: string): string {
  const blocks = Array.from(container.querySelectorAll<HTMLElement>('div[dir="auto"], span[dir="auto"]'));
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const b of blocks) {
    if (b.closest('a[href^="/@"]') || b.closest('time') || b.closest('[role="button"]')) continue;
    // берём только «листовые» блоки, чтобы не дублировать текст вложенных
    if (b.querySelector('div[dir="auto"], span[dir="auto"]')) continue;
    const t = textOf(b);
    if (!t || t === authorHandle || seen.has(t)) continue;
    if (/^\d[\d\s.,]*\s*(тыс|млн|k|m)?\.?$/i.test(t)) continue;
    if (parseCount(t) > 0 && t.length < 8) continue;
    seen.add(t);
    parts.push(t);
  }
  return parts.join('\n').trim();
}

export function parseAllPosts(root: ParentNode, source: PostSource, sourceDetail?: string): ObservedPost[] {
  const out: ObservedPost[] = [];
  const ids = new Set<string>();
  for (const c of findPostContainers(root)) {
    const p = parsePostCard(c, source, sourceDetail);
    if (p && !ids.has(p.id)) {
      ids.add(p.id);
      out.push(p);
    }
  }
  return out;
}

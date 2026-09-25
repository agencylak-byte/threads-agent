import { postCodeFromHref } from '../selectors';
import { findPostContainers, parsePostCard } from './post-card';
import type { ObservedPost, ObservedReply } from '@/shared/types';

// Страница поста /@handle/post/CODE → корневой пост + ответы (кто комментировал и что).

export function parseThreadPage(
  url: string,
  root: ParentNode = document,
): { root: ObservedPost; replies: ObservedReply[] } | null {
  const ref = postCodeFromHref(new URL(url).pathname);
  if (!ref) return null;
  const rootId = `${ref.handle}/post/${ref.code}`;
  let rootPost: ObservedPost | null = null;
  const replies: ObservedReply[] = [];
  const seen = new Set<string>();
  for (const c of findPostContainers(root)) {
    const p = parsePostCard(c, 'thread', url);
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    if (p.id === rootId) {
      rootPost = p;
    } else {
      replies.push({ post: { ...p, isReplyTo: rootId }, parentId: rootId });
    }
  }
  return rootPost ? { root: rootPost, replies } : null;
}

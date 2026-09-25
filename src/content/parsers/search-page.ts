import { parseAllPosts } from './post-card';
import type { ObservedPost } from '@/shared/types';

/** Страница /search?q=… — те же карточки постов; sourceDetail = ключевое слово. */
export function parseSearchPage(keyword: string, root: ParentNode = document): ObservedPost[] {
  return parseAllPosts(root, 'keyword', keyword);
}

export function keywordFromUrl(url: string): string {
  return new URL(url).searchParams.get('q') ?? '';
}

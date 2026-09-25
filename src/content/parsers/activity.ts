import { parseAllPosts } from './post-card';
import type { ObservedPost } from '@/shared/types';

// /activity — ответы на наши посты и комментарии. Карточки там устроены как посты
// (есть автор, время, ссылка на пост), поэтому переиспользуем парсер поста.
// Кандидаты на reply-own-post/reply-thread отбираются позже по authorHandle !== self.

export function parseActivity(root: ParentNode = document): ObservedPost[] {
  return parseAllPosts(root, 'activity', 'activity');
}

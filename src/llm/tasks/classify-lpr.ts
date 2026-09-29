import { z } from 'zod';
import { parseJsonWith } from '../json-parse';
import { BUSINESS_FACTS, runPrompt } from './shared';
import promptMd from '@/prompts/classify-lpr.md?raw';
import type { LlmUsage, Post, PostAi } from '@/shared/types';

const ItemSchema = z.object({
  id: z.string(),
  commentScore: z.number().min(0).max(100),
  lprScore: z.number().min(0).max(100),
  relevance: z.number().min(0).max(100).default(50),
  isFreelancer: z.boolean().default(false),
  topic: z.string().default(''),
  niche: z.string().default('не определено'),
  reason: z.string().default(''),
});
// модель иногда отдаёт голый массив вместо {items:[…]}
const ResultSchema = z.union([z.object({ items: z.array(ItemSchema) }), z.array(ItemSchema).transform((items) => ({ items }))]);

export function formatPostsForClassify(posts: Post[]): string {
  return posts
    .map(
      (p, i) =>
        `### Пост ${i + 1} (id: ${p.id})\nАвтор: @${p.authorHandle}${p.authorName ? ` (${p.authorName})` : ''}\nBio: ${p.authorBioSnapshot ?? '—'}\nПодписчиков: ${p.authorFollowersSnapshot ?? '—'}\nЛайки/ответы: ${p.likes}/${p.replies}\nТекст:\n${p.text.slice(0, 900)}`,
    )
    .join('\n\n');
}

/** До 10 постов за вызов. Возвращает ai-оценки по id (пропущенные моделью — без записи). */
export async function classifyPosts(posts: Post[]): Promise<{ ai: Map<string, PostAi>; usage: LlmUsage }> {
  const { result, usage } = await runPrompt({
    promptMd,
    vars: { businessFacts: BUSINESS_FACTS, posts: formatPostsForClassify(posts) },
    maxTokens: 1500,
    temperature: 0.2,
  });
  const parsed = parseJsonWith(ResultSchema, result.text);
  const ai = new Map<string, PostAi>();
  const now = Date.now();
  for (const it of parsed.items) {
    if (!posts.some((p) => p.id === it.id)) continue;
    ai.set(it.id, {
      commentScore: Math.round(it.commentScore),
      lprScore: Math.round(it.lprScore),
      relevance: Math.round(it.relevance),
      topic: it.topic || undefined,
      niche: it.niche,
      isFreelancer: it.isFreelancer,
      reason: it.reason,
      model: usage.model,
      at: now,
    });
  }
  return { ai, usage };
}

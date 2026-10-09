import { z } from 'zod';
import { parseJsonWith } from '../json-parse';
import { BUSINESS_FACTS, PLAYBOOK, fmtHint, llmContext, runPrompt } from './shared';
import { clampText } from './comment-draft';
import promptMd from '@/prompts/post-draft.md?raw';
import { DRAFT_MAX_CHARS } from '@/shared/constants';
import type { LlmUsage } from '@/shared/types';
import { BANNED_POST_OPENERS, recentOpeners, type PostFormat } from '@/profile/post-formats';

const ResultSchema = z.object({
  variants: z.array(z.object({ text: z.string().min(1), hook: z.string().default(''), why: z.string().default('') })).min(1),
});

export interface PostVariant {
  text: string;
  hook: string;
  why: string;
}

export async function draftPost(topic: string | undefined, recentPosts: string[], hint?: string, variantsCount = 3, format?: PostFormat): Promise<{ variants: PostVariant[]; usage: LlmUsage }> {
  const ctx = await llmContext();
  const hardMax = DRAFT_MAX_CHARS['publish-post'];
  const maxChars = Math.min(hardMax, format?.maxChars ?? hardMax);
  const { result, usage } = await runPrompt({
    promptMd,
    vars: {
      voice: ctx.voice,
      businessFacts: BUSINESS_FACTS,
      playbook: PLAYBOOK,
      topic: topic?.trim() || 'на выбор модели: из мира собственника (заявки, окупаемость, подрядчики) или линия «строю агентство на ИИ-агентах»',
      recentPosts: recentPosts.length ? recentPosts.map((p, i) => `${i + 1}. ${p.slice(0, 200)}`).join('\n') : '—',
      maxChars,
      formatName: format?.name ?? 'на выбор: короткое мнение, вопрос собственникам или жизненная ситуация',
      formatInstruction: format?.instruction ?? 'Коротко и живо, финал — вопрос, на который хочется ответить про себя.',
      bannedOpeners: [...BANNED_POST_OPENERS, ...recentOpeners(recentPosts.slice(0, 15))].map((o) => `«${o}»`).join(', '),
      variantsCount,
      hint: fmtHint(hint),
    },
    maxTokens: variantsCount > 1 ? 1800 : 800,
    temperature: 0.9,
  });
  const parsed = parseJsonWith(ResultSchema, result.text);
  return { variants: parsed.variants.map((v) => ({ ...v, text: clampText(v.text, hardMax) })).slice(0, 3), usage };
}

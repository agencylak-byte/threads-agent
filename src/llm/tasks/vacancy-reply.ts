import { z } from 'zod';
import { parseJsonWith } from '../json-parse';
import { BUSINESS_FACTS, fmtHint, fmtOpeners, llmContext, runPrompt } from './shared';
import { clampText, type CommentDraft } from './comment-draft';
import promptMd from '@/prompts/vacancy-reply.md?raw';
import type { Post } from '@/shared/types';

// Отклик на вакансию (20.10): представиться, показать, что прочитали, дать контакт в Telegram.

const ResultSchema = z.object({ text: z.string().min(1), reasoning: z.string().default('') });

/** Отклик длиннее обычного комментария, но в пределах лимита ответа Threads (500). */
export const VACANCY_MAX_CHARS = 450;

export async function draftVacancyReply(post: Post, usedOpeners: string[], hint?: string): Promise<CommentDraft> {
  const ctx = await llmContext();
  const { result, usage } = await runPrompt({
    promptMd,
    vars: {
      voice: ctx.voice,
      businessFacts: BUSINESS_FACTS,
      authorHandle: post.authorHandle,
      authorName: post.authorName ? ` (${post.authorName})` : '',
      authorBio: post.authorBioSnapshot ?? '—',
      role: post.ai?.vacancy?.role ?? '—',
      postText: post.text.slice(0, 1500),
      maxChars: VACANCY_MAX_CHARS,
      address: ctx.profile.address,
      usedOpeners: fmtOpeners(usedOpeners),
      hint: fmtHint(hint),
    },
    maxTokens: 500,
    temperature: 0.7,
  });
  const parsed = parseJsonWith(ResultSchema, result.text);
  return { text: clampText(parsed.text, VACANCY_MAX_CHARS), reasoning: parsed.reasoning, usage };
}

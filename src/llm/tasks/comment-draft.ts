import { z } from 'zod';
import { parseJsonWith } from '../json-parse';
import { PLAYBOOK, fmtHint, fmtOpeners, llmContext, runPrompt } from './shared';
import promptMd from '@/prompts/comment-draft.md?raw';
import { DRAFT_MAX_CHARS } from '@/shared/constants';
import type { LlmUsage, Post } from '@/shared/types';

const ResultSchema = z.object({
  text: z.string().min(1),
  reasoning: z.string().default(''),
  scheme: z.string().default(''),
});

export interface CommentDraft {
  text: string;
  reasoning: string;
  usage: LlmUsage;
}

export async function draftComment(post: Post, usedOpeners: string[], hint?: string): Promise<CommentDraft> {
  const ctx = await llmContext();
  const maxChars = DRAFT_MAX_CHARS['comment-on-stranger'];
  const { result, usage } = await runPrompt({
    promptMd,
    vars: {
      voice: ctx.voice,
      playbook: PLAYBOOK,
      authorHandle: post.authorHandle,
      authorName: post.authorName ? ` (${post.authorName})` : '',
      authorBio: post.authorBioSnapshot ?? '—',
      authorFollowers: post.authorFollowersSnapshot ?? '—',
      niche: post.ai?.niche ?? 'не определено',
      postText: post.text.slice(0, 1500),
      maxChars,
      address: ctx.profile.address,
      usedOpeners: fmtOpeners(usedOpeners),
      hint: fmtHint(hint),
    },
    maxTokens: 400,
    temperature: 0.8,
  });
  const parsed = parseJsonWith(ResultSchema, result.text);
  return { text: clampText(parsed.text, maxChars), reasoning: parsed.reasoning, usage };
}

/** Модель иногда превышает лимит — режем по последнему предложению, не по слову. */
export function clampText(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('?'), cut.lastIndexOf('!'));
  return end >= max * 0.4 ? cut.slice(0, end + 1) : cut.trim();
}

import { z } from 'zod';
import { parseJsonWith } from '../json-parse';
import { PLAYBOOK, fmtHint, fmtOpeners, llmContext, runPrompt } from './shared';
import { clampText } from './comment-draft';
import promptMd from '@/prompts/reply-draft.md?raw';
import { DRAFT_MAX_CHARS } from '@/shared/constants';
import type { ActionType, LlmUsage } from '@/shared/types';

const ResultSchema = z.object({
  text: z.string().min(1),
  reasoning: z.string().default(''),
  inviteToDm: z.boolean().default(false),
});

export interface ThreadLine {
  handle: string;
  text: string;
  isSelf: boolean;
}

export interface ReplyDraft {
  text: string;
  reasoning: string;
  inviteToDm: boolean;
  usage: LlmUsage;
}

export async function draftReply(
  type: Extract<ActionType, 'reply-own-post' | 'reply-thread'>,
  thread: ThreadLine[],
  last: ThreadLine,
  usedOpeners: string[],
  hint?: string,
): Promise<ReplyDraft> {
  const ctx = await llmContext();
  const maxChars = DRAFT_MAX_CHARS[type];
  const { result, usage } = await runPrompt({
    promptMd,
    vars: {
      voice: ctx.voice,
      playbook: PLAYBOOK,
      replyKind:
        type === 'reply-own-post'
          ? 'Ответ на комментарий под НАШИМ постом. Мы — хозяева ветки: держим тон, развиваем мысль, благодарим без пустого «спасибо».'
          : 'Ответ в ЧУЖОЙ ветке, где мы уже оставили комментарий и автор ответил. Продолжаем разговор как равный собеседник.',
      thread: thread.map((l) => `${l.isSelf ? 'МЫ' : '@' + l.handle}: ${l.text}`).join('\n'),
      authorHandle: last.handle,
      lastMessage: last.text,
      maxChars,
      address: ctx.profile.address,
      usedOpeners: fmtOpeners(usedOpeners),
      hint: fmtHint(hint),
    },
    maxTokens: 400,
    temperature: 0.8,
  });
  const parsed = parseJsonWith(ResultSchema, result.text);
  return { text: clampText(parsed.text, maxChars), reasoning: parsed.reasoning, inviteToDm: parsed.inviteToDm, usage };
}

import { chat, type ChatResult } from '../openrouter';
import { renderPrompt } from '../prompt-render';
import { apiKeyItem, getSettings, voiceProfileItem } from '@/shared/settings';
import { SEED_PROFILE } from '@/profile/seed-profile';
import { toPromptBlock, type VoiceProfile } from '@/profile/voice-profile';
import { log } from '@/shared/log';
import type { LlmUsage } from '@/shared/types';
import businessFactsMd from '@/profile/seed/business-facts.md?raw';
import playbookMd from '@/profile/seed/playbook.md?raw';

// Общее для всех LLM-задач: ключ, модель с fallback, профиль голоса, seed-тексты, учёт usage.

export const BUSINESS_FACTS = businessFactsMd;
export const PLAYBOOK = playbookMd;

export async function llmContext(): Promise<{ apiKey: string; model: string; fallbackModel: string; profile: VoiceProfile; voice: string }> {
  const [apiKey, settings, profile] = await Promise.all([apiKeyItem.getValue(), getSettings(), voiceProfileItem.getValue()]);
  if (!apiKey) throw new Error('Не задан ключ OpenRouter');
  const p = profile ?? SEED_PROFILE;
  return { apiKey, model: settings.model, fallbackModel: settings.fallbackModel, profile: p, voice: toPromptBlock(p) };
}

export interface TaskCall {
  promptMd: string;
  vars: Record<string, string | number | undefined>;
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
}

/** Рендер → вызов (с fallback-моделью при ошибке) → usage. */
export async function runPrompt(call: TaskCall): Promise<{ result: ChatResult; usage: LlmUsage }> {
  const ctx = await llmContext();
  const rendered = renderPrompt(call.promptMd, call.vars);
  const attempt = (model: string) =>
    chat({
      apiKey: ctx.apiKey,
      model,
      system: rendered.system,
      user: rendered.user,
      maxTokens: call.maxTokens ?? 1024,
      temperature: call.temperature ?? 0.7,
      json: call.json ?? true,
    });
  let result: ChatResult;
  try {
    result = await attempt(ctx.model);
  } catch (e) {
    if (!ctx.fallbackModel) throw e;
    log('error', `основная модель ${ctx.model} не ответила, пробую ${ctx.fallbackModel}`, String(e));
    result = await attempt(ctx.fallbackModel);
  }
  const usage: LlmUsage = {
    model: result.model,
    promptVersion: rendered.version,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costUsd: result.costUsd,
  };
  return { result, usage };
}

export function fmtOpeners(openers: string[]): string {
  return openers.length ? openers.map((o) => `«${o}»`).join(', ') : '—';
}

export function fmtHint(hint?: string): string {
  return hint ? `- Пожелание автора к этому черновику: ${hint}` : '';
}

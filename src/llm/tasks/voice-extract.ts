import { parseJsonWith } from '../json-parse';
import { llmContext, runPrompt } from './shared';
import promptMd from '@/prompts/voice-extract.md?raw';
import { ExtractedVoiceSchema, type ExtractedVoice } from '@/profile/voice-profile';
import type { LlmUsage } from '@/shared/types';

/** Снять голос с её постов. samples — тексты постов/комментариев (30–80 штук). */
export async function extractVoice(samples: string[]): Promise<{ extracted: ExtractedVoice; usage: LlmUsage }> {
  if (samples.length < 5) throw new Error(`Слишком мало постов для снятия голоса: ${samples.length} (нужно ≥ 5)`);
  const ctx = await llmContext();
  const { result, usage } = await runPrompt({
    promptMd,
    vars: {
      samplesCount: samples.length,
      identity: `${ctx.profile.identity.name}, ${ctx.profile.identity.role}`,
      samples: samples.map((s, i) => `--- ${i + 1} ---\n${s.slice(0, 1200)}`).join('\n\n'),
    },
    maxTokens: 2500,
    temperature: 0.3,
  });
  return { extracted: parseJsonWith(ExtractedVoiceSchema, result.text), usage };
}

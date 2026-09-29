import { z } from 'zod';
import { storage } from 'wxt/utils/storage';
import { DEFAULT_AUTONOMY, DEFAULT_LIMITS, DEFAULT_MODEL } from './constants';
import type { AutonomyConfig, EngineState } from './types';
import type { VoiceProfile } from '@/profile/voice-profile';
import type { QuestionnaireAnswers } from '@/profile/voice-profile';
import keywordsSeed from '@/profile/seed/keywords.json';
import competitorsSeed from '@/profile/seed/competitors.json';

// Настройки — маленькие и часто читаемые, живут в chrome.storage.local (не в IndexedDB).

const range = z.tuple([z.number().nonnegative(), z.number().nonnegative()]);

export function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow';
  } catch {
    return 'Europe/Moscow';
  }
}

export const SettingsSchema = z.object({
  model: z.string().default(DEFAULT_MODEL),
  fallbackModel: z.string().default(''),
  keywords: z.array(z.string()).default(keywordsSeed.keywords),
  competitors: z.array(z.string()).default(competitorsSeed.competitors),
  /** Главный порог: балл «стоит комментировать» (0–100). */
  commentMin: z.number().min(0).max(100).default(70),
  /** Вспомогательные пороги (автор похож на клиента; пост по теме). */
  lprMinScore: z.number().min(0).max(100).default(50),
  relevanceMin: z.number().min(0).max(100).default(40),
  limits: z
    .object({
      'comment-on-stranger': z.number().int().min(0),
      'reply-own-post': z.number().int().min(0),
      'reply-thread': z.number().int().min(0),
      'dm-first': z.number().int().min(0),
      'dm-continue': z.number().int().min(0),
      'publish-post': z.number().int().min(0),
    })
    .default(DEFAULT_LIMITS),
  /** Секунды между любыми записывающими действиями. */
  minGapSec: range.default([90, 240]),
  /** Секунды между действиями одного типа. */
  sameTypeGapSec: range.default([180, 420]),
  /** Пачка действий и пауза между пачками (минуты). */
  sessionSize: range.default([3, 6]),
  sessionPauseMin: range.default([12, 35]),
  workingHours: z.object({ start: z.string(), end: z.string() }).default({ start: '09:30', end: '21:00' }),
  weekendFactor: z.number().min(0).max(1).default(0.5),
  rampUp: z.boolean().default(true),
  /** Когда движок впервые запущен — точка отсчёта ramp-up. */
  rampStartAt: z.number().optional(),
  /** Окно и дневные лимиты считаются в этой таймзоне; по умолчанию — местная (у Леры Вьетнам). */
  timezone: z.string().default(localTimezone()),
  collectMaxPosts: z.number().int().min(5).max(500).default(60),
  collectScrollPauseMs: range.default([1500, 4000]),
  authorCooldownDays: z.number().int().min(0).default(14),
  maxPostAgeDays: z.number().int().min(1).default(7),
  likeBeforeComment: z.boolean().default(false),
  /** Только чтение аккаунта конкурентов: сколько подписчиков брать за обход. */
  competitorFollowersPerRun: z.number().int().min(5).max(200).default(40),
  /** Откуда снимать голос: handle другого (старого) аккаунта Леры в Threads; пусто — свой аккаунт. */
  voiceSourceHandle: z.string().default(''),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});

export const settingsItem = storage.defineItem<Settings>('local:settings', { fallback: DEFAULT_SETTINGS });
export const apiKeyItem = storage.defineItem<string>('local:apiKey', { fallback: '' });
export const autonomyItem = storage.defineItem<AutonomyConfig>('local:autonomy', { fallback: DEFAULT_AUTONOMY });
export const engineStateItem = storage.defineItem<EngineState>('local:engineState', {
  fallback: { status: 'stopped', anomalies24h: [] },
});
export const selfHandleItem = storage.defineItem<string>('local:selfHandle', { fallback: '' });
export const voiceProfileItem = storage.defineItem<VoiceProfile | null>('local:voiceProfile', { fallback: null });
export const questionnaireItem = storage.defineItem<QuestionnaireAnswers | null>('local:questionnaire', {
  fallback: null,
});
export const workTabItem = storage.defineItem<number | null>('session:workTabId', { fallback: null });

export async function getSettings(): Promise<Settings> {
  const raw = await settingsItem.getValue();
  // parse — чтобы новые поля с default'ами появлялись у старых сохранённых настроек
  return SettingsSchema.parse({ ...DEFAULT_SETTINGS, ...raw });
}

export async function patchSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = SettingsSchema.parse({ ...(await getSettings()), ...patch });
  await settingsItem.setValue(next);
  return next;
}

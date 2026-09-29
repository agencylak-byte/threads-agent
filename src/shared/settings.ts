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
  /** В автопилоте (без одобрения) комментируем только посты с баллом не ниже этого. */
  autoCommentMin: z.number().min(0).max(100).default(80),
  /** Автопостинг: постов в день (0 — выключено), темы по кругу. */
  autoPostsPerDay: z.number().int().min(0).max(10).default(5),
  postTopics: z.array(z.string()).default([
    'подрядчик показывает охваты, а заявок нет: где на самом деле теряются заявки',
    'что я автоматизировала в агентстве с помощью ИИ-агентов и что при этом сломалось',
    'клиент просит скидку — почему это почти всегда про непонятный оффер, а не про цену',
    'почему «постим каждый день» не даёт заявок: один следующий шаг вместо трёх призывов',
    'как собственнику за 5 минут проверить, работает ли его SMM: три вопроса подрядчику',
    'экспертный контент, который убивает доверие: слишком много пользы за раз',
    'что изменилось в продвижении экспертов в 2026: органика против бюджета',
    'ошибка запуска курса, которую вижу чаще всего: прогрев без доказательств',
    'зачем агентству ИИ-сотрудники и почему это не про «уволить людей»',
    'первый месяц с новым клиентом: что должно произойти, чтобы он остался',
    'рилс «залетел», а заявок ноль: чем охват отличается от спроса',
    'сколько на самом деле стоит SMM для эксперта и из чего складывается цена',
    'три вопроса, по которым видно, что подрядчик по маркетингу вас не понимает',
    'как я передаю проект команде после брифа, чтобы клиент не почувствовал разницы',
    'что делать, если контент есть, а продаж нет: разбор одной воронки',
    'почему мы отказались от «прогревов» в старом смысле и что вместо них',
    'клиенты уходят через 2–3 месяца: что я поменяла в агентстве, чтобы держать',
    'один день основателя агентства на ИИ-агентах: что делаю сама, что делают агенты',
    'самый частый вопрос от собственников на брифе и мой честный ответ',
    'куда я бы вложила первые 50 тысяч на продвижение эксперта в 2026',
  ]),
  postTopicCursor: z.number().int().min(0).default(0),
  /** Автосбор по ключам раз в N минут (0 — только вручную). */
  autoCollectIntervalMin: z.number().int().min(0).max(1440).default(180),
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
  minGapSec: range.default([40, 90]),
  /** Секунды между действиями одного типа. */
  sameTypeGapSec: range.default([60, 150]),
  /** Пачка действий и пауза между пачками (минуты). */
  sessionSize: range.default([4, 8]),
  sessionPauseMin: range.default([8, 20]),
  workingHours: z.object({ start: z.string(), end: z.string() }).default({ start: '09:30', end: '21:00' }),
  weekendFactor: z.number().min(0).max(1).default(0.5),
  rampUp: z.boolean().default(true),
  /** Когда движок впервые запущен — точка отсчёта ramp-up. */
  rampStartAt: z.number().optional(),
  /** Окно и дневные лимиты считаются в этой таймзоне; по умолчанию — местная (у Леры Вьетнам). */
  timezone: z.string().default(localTimezone()),
  collectMaxPosts: z.number().int().min(5).max(500).default(60),
  /** Сбор по ключам: сколько экранов пролистать на ключ и сколько ключей брать за прогон (по кругу). */
  collectScreens: z.number().int().min(1).max(30).default(5),
  collectKeywordsPerRun: z.number().int().min(1).max(12).default(3),
  keywordCursor: z.number().int().min(0).default(0),
  /** Автоответы: как часто заглядывать в «Действия» за новыми ответами (минуты); 0 — выключено. */
  autoReplyIntervalMin: z.number().int().min(0).max(240).default(30),
  /** Работать в отдельном окне Chrome, чтобы не мешать вкладкам Леры. */
  dedicatedWindow: z.boolean().default(true),
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
export const workWindowItem = storage.defineItem<number | null>('local:workWindowId', { fallback: null });

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

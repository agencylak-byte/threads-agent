import { z } from 'zod';

// Профиль голоса — единый источник «как звучит Лера» для всех промтов.
// Собирается из четырёх слоёв: seed (факты из CLAUDE.md) → анкета → извлечённое из её постов.
// Схема по методу из `brand-voice-и-tone-of-voice.md`: кто говорит → 4 оси → словарь/анти-словарь → пары «так/не так».

/** Ось тона: диапазон [min, max] по шкале 0..10. */
const axis = z.tuple([z.number().min(0).max(10), z.number().min(0).max(10)]);

export const ExampleSchema = z.object({
  text: z.string().min(1),
  why: z.string().default(''),
});

export const VoiceProfileSchema = z.object({
  version: z.number().int().min(1).default(1),
  identity: z.object({
    name: z.string(),
    role: z.string(),
    handle: z.string().optional(),
    oneLiner: z.string(),
  }),
  positioning: z.string(),
  audience: z.object({
    who: z.string(),
    pains: z.array(z.string()).default([]),
    language: z.array(z.string()).default([]),
    notFor: z.array(z.string()).default([]),
  }),
  /** Слова и обороты, которыми она реально говорит. */
  vocabulary: z.array(z.string()).default([]),
  /** Чего никогда не говорит. */
  antiVocabulary: z.array(z.string()).default([]),
  /**
   * 4 оси NNGroup, каждая — рабочий диапазон 0..10:
   * formal: 0 формальный ↔ 10 свой; humor: 0 серьёзный ↔ 10 с юмором;
   * respect: 0 почтительный ↔ 10 дерзкий; emotion: 0 сухой ↔ 10 эмоциональный.
   */
  toneAxes: z.object({ formal: axis, humor: axis, respect: axis, emotion: axis }),
  /** 5–7 речевых привычек («начинает с ситуации», «короткие абзацы»…). */
  habits: z.array(z.string()).default([]),
  /** Средняя длина в символах. */
  avgLength: z.object({
    post: z.number().int().positive(),
    comment: z.number().int().positive(),
    dm: z.number().int().positive(),
  }),
  emojiPolicy: z.enum(['none', 'rare', 'moderate']),
  address: z.enum(['вы', 'ты', 'по ситуации']),
  /** Типичные зачины (для антидубля и для узнаваемости). */
  openers: z.array(z.string()).default([]),
  /** Ходы, которые запрещены («продавать в первом касании»…). */
  forbiddenMoves: z.array(z.string()).default([]),
  examples: z.object({
    good: z.array(ExampleSchema).default([]),
    bad: z.array(ExampleSchema).default([]),
  }),
  leadDefinition: z.string(),
  /** Типичные следующие шаги в диалоге, по возрастанию «тепла». */
  nextSteps: z.array(z.string()).default([]),
  /** Ниши, с которыми не работаем. */
  stopNiches: z.array(z.string()).default([]),
  sources: z.object({
    seedVersion: z.string(),
    questionnaireAt: z.string().optional(),
    extractedAt: z.string().optional(),
    samplesCount: z.number().int().min(0).default(0),
  }),
});

export type VoiceProfile = z.infer<typeof VoiceProfileSchema>;
export type VoiceProfileInput = z.input<typeof VoiceProfileSchema>;

/** Часть профиля, которую возвращает модель после чтения её постов (см. prompts/voice-extract.md). */
export const ExtractedVoiceSchema = VoiceProfileSchema.pick({
  vocabulary: true,
  antiVocabulary: true,
  toneAxes: true,
  habits: true,
  avgLength: true,
  emojiPolicy: true,
  openers: true,
  examples: true,
}).extend({
  address: VoiceProfileSchema.shape.address.optional(),
  summary: z.string().default(''),
});
export type ExtractedVoice = z.infer<typeof ExtractedVoiceSchema>;

/** Часть профиля, которую задаёт анкета в UI. */
export const QuestionnaireAnswersSchema = z.object({
  address: VoiceProfileSchema.shape.address.optional(),
  forbiddenMoves: z.array(z.string()).optional(),
  stopNiches: z.array(z.string()).optional(),
  nextSteps: z.array(z.string()).optional(),
  leadDefinition: z.string().optional(),
  antiVocabulary: z.array(z.string()).optional(),
  emojiPolicy: VoiceProfileSchema.shape.emojiPolicy.optional(),
  topicsAvoid: z.array(z.string()).optional(),
  oneLiner: z.string().optional(),
});
export type QuestionnaireAnswers = z.infer<typeof QuestionnaireAnswersSchema>;

function unionStrings(...lists: Array<readonly string[] | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const raw of list ?? []) {
      const s = raw.trim();
      const key = s.toLowerCase();
      if (!s || seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
  }
  return out;
}

/**
 * Слияние слоёв. Правила:
 * - массивы объединяются без дублей (seed → анкета → извлечённое);
 * - тон, длина, эмодзи, зачины, примеры — извлечённое из её постов важнее seed;
 * - обращение, запреты, стоп-ниши, определение лида — анкета важнее всего (это её явное решение).
 */
export function mergeProfile(
  seed: VoiceProfile,
  questionnaire?: QuestionnaireAnswers | null,
  extracted?: ExtractedVoice | null,
  now: () => Date = () => new Date(),
): VoiceProfile {
  const q = questionnaire ?? {};
  const e = extracted ?? null;
  const merged: VoiceProfileInput = {
    ...seed,
    version: seed.version + (e || questionnaire ? 1 : 0),
    identity: { ...seed.identity, oneLiner: q.oneLiner?.trim() || seed.identity.oneLiner },
    vocabulary: unionStrings(seed.vocabulary, e?.vocabulary),
    antiVocabulary: unionStrings(seed.antiVocabulary, q.antiVocabulary, e?.antiVocabulary),
    toneAxes: e?.toneAxes ?? seed.toneAxes,
    habits: unionStrings(e?.habits, seed.habits),
    avgLength: e?.avgLength ?? seed.avgLength,
    emojiPolicy: q.emojiPolicy ?? e?.emojiPolicy ?? seed.emojiPolicy,
    address: q.address ?? e?.address ?? seed.address,
    openers: unionStrings(e?.openers, seed.openers),
    forbiddenMoves: unionStrings(seed.forbiddenMoves, q.forbiddenMoves, q.topicsAvoid?.map((t) => `Не писать о: ${t}`)),
    examples: {
      good: [...(e?.examples.good ?? []), ...seed.examples.good].slice(0, 12),
      bad: [...(e?.examples.bad ?? []), ...seed.examples.bad].slice(0, 12),
    },
    leadDefinition: q.leadDefinition?.trim() || seed.leadDefinition,
    nextSteps: q.nextSteps?.length ? q.nextSteps : seed.nextSteps,
    stopNiches: unionStrings(seed.stopNiches, q.stopNiches),
    sources: {
      ...seed.sources,
      questionnaireAt: questionnaire ? now().toISOString() : seed.sources.questionnaireAt,
      extractedAt: e ? now().toISOString() : seed.sources.extractedAt,
      samplesCount: e ? Math.max(seed.sources.samplesCount, 0) : seed.sources.samplesCount,
    },
  };
  return VoiceProfileSchema.parse(merged);
}

function axisLine(label: string, left: string, right: string, [min, max]: [number, number]): string {
  return `- ${label}: ${left} 0 … 10 ${right} — обычно ${min}–${max}`;
}

function list(items: readonly string[], empty = '—'): string {
  return items.length ? items.map((s) => `- ${s}`).join('\n') : `- ${empty}`;
}

/** Блок для вставки в промты: компактно, по-русски, без лишнего. */
export function toPromptBlock(p: VoiceProfile): string {
  const good = p.examples.good.map((x) => `- Так: «${x.text}»${x.why ? ` — ${x.why}` : ''}`).join('\n');
  const bad = p.examples.bad.map((x) => `- Не так: «${x.text}»${x.why ? ` — ${x.why}` : ''}`).join('\n');
  return [
    `## Кто говорит`,
    `${p.identity.name} — ${p.identity.role}. ${p.identity.oneLiner}`,
    `Позиционирование: ${p.positioning}`,
    ``,
    `## Кому`,
    `${p.audience.who}`,
    `Боли: ${p.audience.pains.join('; ') || '—'}`,
    `Язык: ${p.audience.language.join(', ') || '—'}`,
    `Не для: ${p.audience.notFor.join(', ') || '—'}`,
    ``,
    `## Как звучит`,
    axisLine('Дистанция', 'формальный', 'свой', p.toneAxes.formal),
    axisLine('Юмор', 'серьёзный', 'с юмором', p.toneAxes.humor),
    axisLine('Смелость', 'почтительный', 'дерзкий', p.toneAxes.respect),
    axisLine('Эмоция', 'сухой', 'эмоциональный', p.toneAxes.emotion),
    `Обращение: ${p.address}. Эмодзи: ${p.emojiPolicy === 'none' ? 'нет' : p.emojiPolicy === 'rare' ? 'редко' : 'умеренно'}.`,
    `Длина: пост ~${p.avgLength.post} зн., комментарий ~${p.avgLength.comment} зн., личка ~${p.avgLength.dm} зн.`,
    `Речевые привычки:`,
    list(p.habits),
    `Словарь: ${p.vocabulary.join(', ') || '—'}`,
    `Анти-словарь (никогда): ${p.antiVocabulary.join(', ') || '—'}`,
    `Зачины-образцы (для понимания интонации; копировать нельзя, свой заход лучше): ${p.openers.join(' | ') || '—'}`,
    ``,
    `## Чего не делает`,
    list(p.forbiddenMoves),
    `Стоп-ниши: ${p.stopNiches.join(', ') || '—'}`,
    ``,
    `## Так / не так`,
    good || '- (примеров пока нет)',
    bad || '',
    ``,
    `## Следующие шаги в диалоге`,
    list(p.nextSteps),
    `Лид: ${p.leadDefinition}`,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

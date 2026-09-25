import { describe, expect, it } from 'vitest';
import { SEED_PROFILE } from '@/profile/seed-profile';
import {
  ExtractedVoiceSchema,
  VoiceProfileSchema,
  mergeProfile,
  toPromptBlock,
  type ExtractedVoice,
} from '@/profile/voice-profile';
import { parseAnswers, QUESTIONS } from '@/profile/questionnaire';

const fixedNow = () => new Date('2026-09-25T10:00:00.000Z');

const extracted: ExtractedVoice = ExtractedVoiceSchema.parse({
  summary: 'Спокойно, по делу, с примером.',
  toneAxes: { formal: [7, 9], humor: [4, 6], respect: [5, 7], emotion: [2, 4] },
  habits: ['начинает с ситуации', 'один абзац — одна мысль'],
  vocabulary: ['заявки', 'механика', 'считаем'],
  antiVocabulary: ['вовлечёнка', 'прогрев'],
  openers: ['У клиента было так:', 'Смотрите:'],
  avgLength: { post: 520, comment: 160, dm: 300 },
  emojiPolicy: 'none',
  address: 'ты',
  examples: {
    good: [{ text: 'Заявок нет не потому, что мало постов.', why: 'тезис против ожидания' }],
    bad: [{ text: 'Команда профессионалов поможет вашему бизнесу!', why: 'клише' }],
  },
});

describe('VoiceProfileSchema', () => {
  it('seed-профиль валиден и содержит обязательные блоки', () => {
    expect(() => VoiceProfileSchema.parse(SEED_PROFILE)).not.toThrow();
    expect(SEED_PROFILE.antiVocabulary.length).toBeGreaterThan(3);
    expect(SEED_PROFILE.forbiddenMoves).toContain('продавать в первом касании');
  });

  it('отвергает ось вне диапазона 0..10', () => {
    expect(() =>
      VoiceProfileSchema.parse({ ...SEED_PROFILE, toneAxes: { ...SEED_PROFILE.toneAxes, humor: [0, 11] } }),
    ).toThrow();
  });
});

describe('mergeProfile', () => {
  it('без слоёв возвращает seed без потерь', () => {
    const merged = mergeProfile(SEED_PROFILE, null, null, fixedNow);
    expect(merged).toEqual(SEED_PROFILE);
  });

  it('извлечённое перекрывает тон/длину/зачины, а массивы объединяются без дублей', () => {
    const merged = mergeProfile(SEED_PROFILE, null, extracted, fixedNow);
    expect(merged.toneAxes).toEqual(extracted.toneAxes);
    expect(merged.avgLength).toEqual(extracted.avgLength);
    expect(merged.openers).toEqual(['У клиента было так:', 'Смотрите:']);
    // 'заявки' есть и в seed, и в extracted — один раз
    expect(merged.vocabulary.filter((w) => w === 'заявки')).toHaveLength(1);
    expect(merged.vocabulary).toContain('считаем');
    expect(merged.antiVocabulary).toContain('вовлечёнка');
    expect(merged.antiVocabulary.filter((w) => w === 'прогрев')).toHaveLength(1);
    expect(merged.examples.good[0]?.text).toBe('Заявок нет не потому, что мало постов.');
    expect(merged.sources.extractedAt).toBe('2026-09-25T10:00:00.000Z');
    expect(merged.version).toBe(SEED_PROFILE.version + 1);
  });

  it('анкета важнее извлечённого для обращения, эмодзи, лида и запретов', () => {
    const answers = parseAnswers({
      address: 'вы',
      emojiPolicy: 'rare',
      leadDefinition: 'Только созвон или контакт.',
      forbiddenMoves: 'не называть цены\nне упоминать клиентов по имени',
      topicsAvoid: 'политика',
      stopNiches: 'крипта',
    });
    const merged = mergeProfile(SEED_PROFILE, answers, extracted, fixedNow);
    expect(merged.address).toBe('вы');
    expect(merged.emojiPolicy).toBe('rare');
    expect(merged.leadDefinition).toBe('Только созвон или контакт.');
    expect(merged.forbiddenMoves).toContain('не называть цены');
    expect(merged.forbiddenMoves).toContain('Не писать о: политика');
    expect(merged.stopNiches).toContain('крипта');
    expect(merged.stopNiches).toContain('казино и беттинг');
    expect(merged.sources.questionnaireAt).toBe('2026-09-25T10:00:00.000Z');
  });
});

describe('questionnaire', () => {
  it('каждый вопрос маппится на поле ответов, списки режутся по строкам, пустое выбрасывается', () => {
    const ids = new Set(QUESTIONS.map((q) => q.id));
    expect(ids.size).toBe(QUESTIONS.length);
    const parsed = parseAnswers({ nextSteps: ' разбор \n\nсозвон ', oneLiner: '', antiVocabulary: [] });
    expect(parsed).toEqual({ nextSteps: ['разбор', 'созвон'] });
  });
});

describe('toPromptBlock', () => {
  it('содержит ключевые блоки и не содержит пустых строк подряд', () => {
    const block = toPromptBlock(mergeProfile(SEED_PROFILE, null, extracted, fixedNow));
    for (const h of ['## Кто говорит', '## Кому', '## Как звучит', '## Чего не делает', '## Так / не так', '## Следующие шаги']) {
      expect(block).toContain(h);
    }
    expect(block).toContain('Анти-словарь (никогда): ');
    expect(block).toContain('вовлечёнка');
    expect(block).not.toMatch(/\n\n\n/);
  });
});

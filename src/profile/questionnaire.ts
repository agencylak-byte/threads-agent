import { QuestionnaireAnswersSchema, type QuestionnaireAnswers } from './voice-profile';

// Короткая анкета в UI (Настройки → Голос). Ответы ложатся поверх seed в mergeProfile().

export type QuestionType = 'choice' | 'multi' | 'text' | 'list';

export interface Question {
  id: keyof QuestionnaireAnswers;
  text: string;
  hint?: string;
  type: QuestionType;
  options?: string[];
}

export const QUESTIONS: Question[] = [
  {
    id: 'address',
    text: 'Как обращаетесь к незнакомым людям в комментариях?',
    type: 'choice',
    options: ['вы', 'ты', 'по ситуации'],
  },
  {
    id: 'oneLiner',
    text: 'Одной фразой: кто вы и что делаете (как сказали бы на нетворкинге)?',
    type: 'text',
    hint: 'Например: «Строю SMM-агентство на ИИ-агентах, помогаю экспертам получать заявки из контента».',
  },
  {
    id: 'topicsAvoid',
    text: 'О чём вы точно НЕ пишете публично?',
    type: 'list',
    hint: 'Каждая тема с новой строки: политика, личная жизнь, клиенты по имени…',
  },
  {
    id: 'stopNiches',
    text: 'С какими нишами не работаете?',
    type: 'list',
    hint: 'Каждая с новой строки.',
  },
  {
    id: 'antiVocabulary',
    text: 'Слова и обороты, которые вас раздражают в чужих текстах и которых себе не позволяете?',
    type: 'list',
    hint: 'Каждый с новой строки. Они уйдут в анти-словарь.',
  },
  {
    id: 'emojiPolicy',
    text: 'Эмодзи?',
    type: 'choice',
    options: ['none', 'rare', 'moderate'],
  },
  {
    id: 'nextSteps',
    text: 'Какие следующие шаги вы обычно предлагаете человеку, когда разговор потеплел? По порядку.',
    type: 'list',
    hint: 'Например: разбор аккаунта → созвон 15 минут → КП.',
  },
  {
    id: 'leadDefinition',
    text: 'Что для вас «заявка» в переписке?',
    type: 'text',
    hint: 'По умолчанию: спросил цену/условия/КП, попросил разбор, согласился на созвон или дал контакт.',
  },
  {
    id: 'forbiddenMoves',
    text: 'Чего расширение не должно делать от вашего имени никогда?',
    type: 'list',
    hint: 'Например: не называть цены, не упоминать конкретных клиентов, не шутить про политику.',
  },
];

const EMOJI_LABELS: Record<string, string> = { none: 'нет', rare: 'редко', moderate: 'умеренно' };

export function optionLabel(q: Question, value: string): string {
  return q.id === 'emojiPolicy' ? (EMOJI_LABELS[value] ?? value) : value;
}

/** Из «сырых» строк формы в валидные ответы: списки режем по строкам, пустое выкидываем. */
export function parseAnswers(raw: Record<string, string | string[] | undefined>): QuestionnaireAnswers {
  const out: Record<string, unknown> = {};
  for (const q of QUESTIONS) {
    const v = raw[q.id];
    if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    if (q.type === 'list') {
      const items = (Array.isArray(v) ? v : v.split('\n')).map((s) => s.trim()).filter(Boolean);
      if (items.length) out[q.id] = items;
    } else {
      out[q.id] = Array.isArray(v) ? v[0] : v;
    }
  }
  return QuestionnaireAnswersSchema.parse(out);
}

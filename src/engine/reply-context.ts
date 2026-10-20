import type { Action, Author, Post } from '@/shared/types';

// Контекст для ответа в ветке (разбор 13.10).
// На странице «Действия» карточка ответа содержит и цитату нашего поста, и реплику собеседника,
// а парсер склеивал их в один текст под именем собеседника. Модель видела наш собственный пост
// «от @человека» и писала «вы скопировали мой пост», «у вас бот сломался».
// Здесь отделяем нашу цитату от реплики, находим наш пост-родителя и его формат.

const norm = (s: string) => s.toLowerCase().replace(/[«»"'“”]/g, '').replace(/\s+/g, ' ').trim();

/** Служебные строки карточки, не относящиеся к реплике. */
const SERVICE_LINE = /^(\d[\d\s.,]*\s*(тыс\.?|млн)?\s*просмотр\S*|в ответ @\S+|перевести|показать перевод|ещё|автор)$/i;

export interface OurText {
  text: string;
  /** id формата автопоста, если это наш автопост. */
  format?: string;
  kind: 'post' | 'reply' | 'comment';
}

export interface ReplyContext {
  /** Что на самом деле написал собеседник. */
  message: string;
  /** Наша реплика/пост, на который он ответил (если удалось определить). */
  parent?: OurText;
}

/** Наши тексты: свои посты из базы + отправленные действия. */
export function collectOurTexts(ownPosts: Post[], sent: Action[]): OurText[] {
  const out: OurText[] = [];
  for (const a of sent) {
    const t = a.finalText ?? a.draftText;
    if (!t) continue;
    const kind = a.type === 'publish-post' ? 'post' : a.type === 'comment-on-stranger' ? 'comment' : 'reply';
    out.push({ text: t, kind, format: /Формат: ([\w-]+)/.exec(a.context ?? '')?.[1] });
  }
  for (const p of ownPosts) if (!out.some((o) => sameStart(o.text, p.text))) out.push({ text: p.text, kind: 'post' });
  return out;
}

function sameStart(a: string, b: string, n = 50): boolean {
  const x = norm(a).slice(0, n);
  const y = norm(b).slice(0, n);
  return x.length >= 15 && x === y;
}

/**
 * Отделить реплику собеседника от цитаты нашего текста.
 * null — реплики не осталось (в карточке только наш текст): отвечать не на что.
 */
export function splitReply(raw: string, ours: OurText[]): ReplyContext | null {
  const lines = raw.split('\n').map((l) => l.trim()).filter((l) => l && !SERVICE_LINE.test(l));
  let parent: OurText | undefined;
  const keep: string[] = [];
  for (const line of lines) {
    const nl = norm(line);
    const hit = nl.length >= 12 ? ours.find((o) => norm(o.text).includes(nl)) : undefined;
    if (hit) {
      // строка — кусок нашего текста: это цитата родителя, а не реплика
      parent ??= hit;
      continue;
    }
    keep.push(line);
  }
  let message = keep.join('\n').trim();
  // склейка без переводов строк: наш текст целиком в начале/конце одной строки
  for (const o of ours) {
    const head = norm(o.text).slice(0, 40);
    if (head.length < 15) continue;
    const nm = norm(message);
    if (nm.includes(head)) {
      parent ??= o;
      const full = norm(o.text);
      message = nm.replace(full, '').replace(head, '').trim();
    }
  }
  if (message.replace(/[^\p{L}\p{N}]/gu, '').length < 2) return null;
  return { message, parent };
}

/** Как отвечать под нашим автопостом этого формата — чтобы держать одну линию. */
export function formatGuidance(format?: string): string {
  switch (format) {
    case 'community':
      return (
        'Наш пост — перекличка «давайте знакомиться». Собеседник рассказал о себе. Ответь как живой человек: ' +
        'поздоровайся по-человечески («Привет! Рада знакомству»), отметь одну деталь из того, что он написал, и сразу дай ' +
        'один конкретный фидбэк по его аккаунту или позиционированию на основе справки ниже (что цепляет, чего не хватает, ' +
        'что бы ты поправила первым). Если данных о профиле нет — задай один вопрос: с какой целью ведёт соцсети и что сейчас с заявками. ' +
        'НЕ обещай «посмотрю позже» — либо фидбэк сейчас, либо вопрос. Без продажи.'
      );
    case 'binary':
    case 'hot-take':
    case 'rant':
    case 'manifest':
      return (
        'Наш пост — тема для обсуждения/провокация, а не наша личная ситуация. Позиция автора поста неизменна: ' +
        'SMM нужен бизнесу ради заявок, а не ради картинок; за результат отвечают обе стороны — нужно на берегу договариваться о целях. ' +
        'Не переобувайся: не соглашайся с тем, что противоречит этой позиции, и не спорь с тем, что ей соответствует. ' +
        'Если собеседник говорит, что ты противоречишь себе или «а что вы хотели» — спокойно поясни, что это не наш случай, ' +
        'а тема, на которой хотелось услышать мнения рынка, и уточни его взгляд. Признавай удачные аргументы, но держи линию.'
      );
    case 'checklist':
    case 'offer':
    case 'breakdown':
    case 'how-we':
      return (
        'Наш пост — полезный разбор или оффер бесплатного разбора профиля. Если человек написал «разбор», нишу или ссылку на профиль — ' +
        'поблагодари по-человечески и сразу дай 1–2 конкретных наблюдения по его профилю на основе справки ниже (что мешает заявкам, что поправить первым). ' +
        'Затем пригласи на подробный разбор: «Если хотите, разберу целиком — напишите мне в Telegram @gashenko1». ' +
        'Если человек спорит или дополняет — ответь по сути, держи ту же позицию, при живом интересе тоже позови в Telegram @gashenko1.'
      );
    case 'life':
      return 'Наш пост — лёгкий жизненный мем. Отвечай так же легко, с самоиронией, без экспертизы и без продажи.';
    default:
      return 'Держи ту же позицию, что в нашем посте: не противоречь себе. Если собеседник указал на противоречие — поясни мысль, не извиняйся за «ошибки».';
  }
}

/** Короткая справка о собеседнике для фидбэка по аккаунту. */
export function describeAuthor(handle: string, author: Author | undefined, theirPosts: Post[]): string {
  const lines = [`@${handle}${author?.displayName ? ` (${author.displayName})` : ''}`];
  if (author?.bio) lines.push(`Bio: ${author.bio}`);
  if (author?.followers !== undefined) lines.push(`Подписчиков: ${author.followers}`);
  const posts = theirPosts.filter((p) => p.text && p.text.length > 20).slice(0, 3);
  if (posts.length) lines.push('Их недавние посты:', ...posts.map((p, i) => `${i + 1}. ${p.text.slice(0, 250).replace(/\n+/g, ' ')}`));
  if (lines.length === 1) lines.push('О профиле данных нет — опирайся на то, что человек написал о себе.');
  return lines.join('\n');
}

/** Фразы, которые выдают бота или ломают разговор. Такой ответ не отправляем. */
const META_LEAK = /(скопир\S*|сбой|глюк\S*|заглюч\S*|у (вас|тебя) бот|бот\S* (сломал|заглюч|перепутал)\S*|сломал\S* бот|перепутал\S*,? кто кому|алгоритм\S* тестир\S*|(я|мы) не бот|случайно (продублир|скопир)\S*)/i;

export function metaLeak(text: string): string | null {
  const m = META_LEAK.exec(text);
  return m ? m[0] : null;
}

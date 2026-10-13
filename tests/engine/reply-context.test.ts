import { describe, expect, it } from 'vitest';
import { formatGuidance, metaLeak, splitReply, type OurText } from '@/engine/reply-context';

const community: OurText = {
  kind: 'post',
  format: 'community',
  text: 'Давайте перекличку и саморекламу в комментах. Я Лера, строю SMM-агентство LAK на ИИ-агентах.\nРасскажите, какой у вас бизнес и что сейчас с заявками?',
};
const binary: OurText = { kind: 'post', format: 'binary', text: 'Взяли SMM-щика за копейки. Контент выкладывает вовремя, но за месяц ни одной заявки. Норм или стрем?' };

describe('реплика под нашим постом', () => {
  it('отделяет цитату нашего поста от реплики собеседника', () => {
    const raw = `${community.text}\n8 просмотров\nЯ логопед из Екатеринбурга, сейчас живу в Азии`;
    const r = splitReply(raw, [community, binary]);
    expect(r?.message).toBe('Я логопед из Екатеринбурга, сейчас живу в Азии');
    expect(r?.parent?.format).toBe('community');
  });
  it('если в карточке только наш текст — отвечать не на что', () => {
    expect(splitReply(community.text, [community])).toBeNull();
  });
  it('склейка в одну строку тоже разбирается', () => {
    const r = splitReply(binary.text + ' А что вы хотели за копейки?', [binary]);
    expect(r?.message.toLowerCase()).toContain('а что вы хотели за копейки');
    expect(r?.parent?.format).toBe('binary');
  });
  it('обычная реплика без цитаты остаётся как есть', () => {
    expect(splitReply('НОРМ', [binary])?.message).toBe('НОРМ');
  });
});

describe('ответ не должен звучать как бот', () => {
  it('ловит «скопировали» и «бот сломался»', () => {
    expect(metaLeak('Максим, вы так лихо скопировали мой же пост')).not.toBeNull();
    expect(metaLeak('Кажется, у вас бот сломался')).not.toBeNull();
    expect(metaLeak('Похоже, произошёл сбой')).not.toBeNull();
  });
  it('не трогает обычный разговор про ИИ и копирайтеров', () => {
    expect(metaLeak('Какую задачу сами бы скинули ботам? Копирайтеров не убираем')).toBeNull();
  });
  it('для провокации — держать линию, для переклички — фидбэк сразу', () => {
    expect(formatGuidance('binary')).toMatch(/не наш случай/);
    expect(formatGuidance('community')).toMatch(/НЕ обещай/);
  });
});

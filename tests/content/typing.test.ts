import { describe, expect, it } from 'vitest';
import { editorMatches } from '@/content/actions/typing';

const ed = (t: string) => {
  const d = document.createElement('div');
  d.textContent = t;
  return d;
};

describe('editorMatches', () => {
  const text = 'Вот именно, в точку. А какую рутину у себя первой отдали нейросетям?';
  it('ровно наш текст — ок', () => expect(editorMatches(ed(text), text)).toBe(true));
  it('тройной дубль — нет', () => expect(editorMatches(ed(text + text + text), text)).toBe(false));
  it('пустое поле — нет', () => expect(editorMatches(ed(''), text)).toBe(false));
});

describe('склеенные абзацы', () => {
  it('Lexical склеил абзацы без пробела — это всё равно наш текст', () => {
    const text = 'Давайте перекличку.\nЯ Лера, строю агентство.\n\nРасскажите про свой бизнес?';
    expect(editorMatches(ed('Давайте перекличку.Я Лера, строю агентство.Расскажите про свой бизнес?'), text)).toBe(true);
  });
});

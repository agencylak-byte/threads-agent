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

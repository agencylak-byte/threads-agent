import type { z } from 'zod';

// Модель иногда оборачивает JSON в ```json … ``` или добавляет текст до/после. Достаём первый
// сбалансированный объект/массив и валидируем zod-схемой.

export function extractJson(text: string): string {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) s = fence[1].trim();
  const start = findStart(s);
  if (start < 0) throw new Error('json: не найдено начало объекта');
  const end = findEnd(s, start);
  return s.slice(start, end + 1);
}

function findStart(s: string): number {
  const a = s.indexOf('{');
  const b = s.indexOf('[');
  if (a < 0) return b;
  if (b < 0) return a;
  return Math.min(a, b);
}

/** Индекс закрывающей скобки с учётом строк и экранирования; если обрезано — до конца строки. */
function findEnd(s: string, start: number): number {
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') {
      stack.pop();
      if (!stack.length) return i;
    }
  }
  return s.length - 1;
}

export function parseJsonWith<T>(schema: z.ZodType<T>, text: string): T {
  const raw = extractJson(text);
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error(`json: невалидный JSON (${(e as Error).message}); начало: ${raw.slice(0, 120)}`);
  }
  const r = schema.safeParse(data);
  if (!r.success) throw new Error(`json: не по схеме — ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return r.data;
}

// Разбор чисел из UI: «1,2 тыс.», «12 345», «1.2K», «3M», «1 млн», «—».

// \b в JS не знает кириллицу — границу слова делаем через lookahead.
const SUFFIX: Array<[RegExp, number]> = [
  [/^\s*(тыс|k)(?![a-zа-яё])/i, 1_000],
  [/^\s*(млн|m)(?![a-zа-яё])/i, 1_000_000],
  [/^\s*(млрд|b)(?![a-zа-яё])/i, 1_000_000_000],
];

export function parseCount(raw: string | null | undefined): number {
  if (!raw) return 0;
  const s = raw.replace(/ /g, ' ').trim().toLowerCase();
  if (!s) return 0;
  const m = s.match(/(\d[\d\s]*(?:[.,]\d+)?)/);
  if (!m || !m[1]) return 0;
  let numStr = m[1].replace(/\s/g, '');
  // «1,2 тыс.» — запятая как десятичный; «12,345» без суффикса — как тысячный разделитель
  const rest = s.slice(s.indexOf(m[1]) + m[1].length);
  const mult = SUFFIX.find(([re]) => re.test(rest))?.[1] ?? 1;
  if (mult === 1) {
    numStr = numStr.replace(/,(\d{3})(?!\d)/g, '$1').replace(/\.(\d{3})(?!\d)/g, '$1');
  }
  numStr = numStr.replace(',', '.');
  const n = Number(numStr);
  return Number.isFinite(n) ? Math.round(n * mult) : 0;
}

/** Первое число в тексте вокруг иконки: «Нравится 12», «12», «1,2 тыс.». */
export function countNear(el: Element | null): number {
  if (!el) return 0;
  const host = el.closest('[role="button"], a, div') ?? el.parentElement;
  const text = (host?.textContent ?? '').trim();
  return parseCount(text);
}

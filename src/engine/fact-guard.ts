// Защита от выдуманных цифр и кейсов (задача 1 из разбора коллеги, 30.09.2026).
// Модель понимает «приведи пример из опыта» как «сочини правдоподобный»: у Артура 70% чисел в комментариях были выдуманы.
// Правило: число в черновике допустимо, только если оно есть в тексте поста или в фактах о LAK.
// Число рядом с маркером личного опыта («у нас», «у клиента», «на проекте», «мы сделали») без источника — отклонить.

const EXPERIENCE_MARKERS =
  /(у нас|у наших|у клиент|у заказчик|на проект|мы сделал|мы подним|мы вырост|мы получ|мы вышл|мы привел|мы довел|в нашем|наш кейс|наш опыт|в моей практике|у меня в|мой клиент|моя клиент|за месяц вырос|за неделю вырос|конверси\w* выросл|заявок стало)/i;

/** Все числа в тексте: «9%», «23», «1,5 млн», «40 заявок», «2 раза». Нормализуем к строке без пробелов. */
export function extractNumbers(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\d[\d\s]*(?:[.,]\d+)?/g)) {
    const n = m[0].replace(/\s+/g, '').replace(',', '.');
    if (n) out.push(n);
  }
  return out;
}

/** Годы (2024–2027) и мелкие числительные-связки (1, 2, 3 при «2 раза», «3 вопроса») не считаем «фактами». */
function isTrivialNumber(n: string, context: string): boolean {
  if (/^(19|20)\d\d$/.test(n)) return true;
  if (/^[1-5]$/.test(n) && /\b[1-5]\s*(раз|вопрос|шаг|пункт|мин|минут|ч\b|час|дн|дня|дней|недел|мес|месяц|лет|года|секунд|сек|этап|совет|вариант|тип|причин|способ)/i.test(context)) return true;
  return false;
}

export interface FactGuardVerdict {
  ok: boolean;
  /** Числа без источника рядом с маркером личного опыта. */
  fabricated: string[];
  /** Числа без источника вне маркеров — предупреждение, не отказ. */
  unsourced: string[];
}

/**
 * Проверка черновика. sources — тексты, где числа считаются подтверждёнными (пост, факты о LAK, ветка).
 * Отказ только при связке «число без источника + маркер личного опыта в пределах ±80 символов».
 */
export function checkFacts(draft: string, sources: string[]): FactGuardVerdict {
  const allowed = new Set(sources.flatMap(extractNumbers));
  const fabricated: string[] = [];
  const unsourced: string[] = [];
  for (const m of draft.matchAll(/\d[\d\s]*(?:[.,]\d+)?/g)) {
    const n = m[0].replace(/\s+/g, '').replace(',', '.');
    if (!n || allowed.has(n)) continue;
    const start = m.index ?? 0;
    const context = draft.slice(Math.max(0, start - 80), start + m[0].length + 80);
    if (isTrivialNumber(n, context)) continue;
    if (EXPERIENCE_MARKERS.test(context)) fabricated.push(n);
    else unsourced.push(n);
  }
  return { ok: fabricated.length === 0, fabricated, unsourced };
}

export const FACT_GUARD_HINT =
  'Убери все числа, проценты, сроки и истории «у нас / у клиента / на проекте», которых нет в тексте поста. Говори про механику, без цифр из опыта.';

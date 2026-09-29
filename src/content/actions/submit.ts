import { LABELS } from '../selectors';
import { sleep, waitFor } from '../dom-utils';

// Поиск и нажатие кнопки отправки composer'а и проверка, что текст ушёл.
// Реальная вёрстка Threads (снимок 28.09.2026): у поля ответа под постом кнопка — круглая иконка
// <div role="button"><span><svg aria-label="Ответ"/></span></div> рядом с «Развернуть конструктор»;
// в диалоге нового поста — кнопка с текстом «Опубликовать». Ищем ОТНОСИТЕЛЬНО редактора с нашим текстом.

function normalized(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

const SUBMIT_LABELS = [...LABELS.post, 'Ответ', 'Ответить', 'Reply', 'Отправить', 'Send'].map((l) => l.toLowerCase());

function labelOf(el: Element): string {
  const svg = el.querySelector('svg');
  return normalized(el.getAttribute('aria-label')) || normalized(svg?.getAttribute('aria-label')) || normalized(svg?.getAttribute('title')) || normalized(svg?.querySelector('title')?.textContent);
}

function isSubmitLike(btn: HTMLElement, editor?: HTMLElement | null): boolean {
  // кнопки «Ответ»/«Нравится» на карточках постов — со счётчиком (<span dir="auto">) и в чужой карточке; кнопка отправки — без счётчика,
  // рядом с редактором (поле ответа иногда вложено в карточку корневого поста — тогда карточка та же)
  const btnCard = btn.closest('[data-pressable-container]');
  const editorCard = editor?.closest('[data-pressable-container]') ?? null;
  if (btnCard && btnCard !== editorCard) return false;
  if (btn.querySelector('span[dir="auto"]')) return false;
  const byLabel = labelOf(btn);
  if (SUBMIT_LABELS.includes(byLabel)) return true;
  const text = normalized(btn.textContent);
  return text.length > 0 && text.length < 20 && SUBMIT_LABELS.includes(text);
}

/** Кнопка отправки для конкретного редактора: ближайший общий предок редактора и подходящей кнопки. */
export function findSubmitFor(editor: HTMLElement): HTMLElement | null {
  let scope: HTMLElement | null = editor.parentElement;
  for (let depth = 0; scope && depth < 14; depth++) {
    const buttons = Array.from(scope.querySelectorAll<HTMLElement>('div[role="button"], button')).filter((b) => !b.contains(editor) && isSubmitLike(b, editor));
    if (buttons.length) {
      // предпочитаем кнопку ПОСЛЕ редактора в DOM-порядке и без вложенных совпадений
      const after = buttons.filter((b) => editor.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      const pool = after.length ? after : buttons;
      return pool.find((b) => !pool.some((o) => o !== b && b.contains(o))) ?? pool[0] ?? null;
    }
    if (scope.getAttribute('role') === 'dialog') break;
    scope = scope.parentElement;
  }
  return null;
}

/** Без редактора: диалог или вся страница. */
export function findSubmitButton(root: ParentNode = document): HTMLElement | null {
  const dialog = root.querySelector('div[role="dialog"]');
  const scope = dialog ?? root;
  const candidates = Array.from(scope.querySelectorAll<HTMLElement>('div[role="button"], button')).filter((b) => isSubmitLike(b));
  return candidates.find((b) => !candidates.some((o) => o !== b && b.contains(o))) ?? null;
}

export function isDisabled(btn: HTMLElement): boolean {
  if (btn.getAttribute('aria-disabled') === 'true') return true;
  if ((btn as HTMLButtonElement).disabled) return true;
  const op = Number(getComputedStyle(btn).opacity || '1');
  return op < 0.6;
}

/** Для диагностики: кнопки рядом с редактором. */
export function describeButtons(editor?: HTMLElement | null): string {
  const scope = editor?.parentElement?.parentElement?.parentElement?.parentElement ?? document.querySelector('div[role="dialog"]') ?? document;
  return Array.from(scope.querySelectorAll<HTMLElement>('div[role="button"], button'))
    .map((b) => `[${labelOf(b) || normalized(b.textContent).slice(0, 25)}${isDisabled(b) ? ' (откл)' : ''}]`)
    .slice(0, 20)
    .join(' ');
}

export async function clickSubmit(editor?: HTMLElement | null): Promise<void> {
  const locate = () => (editor ? findSubmitFor(editor) : null) ?? findSubmitButton();
  let btn: HTMLElement;
  try {
    btn = await waitFor(() => {
      const b = locate();
      return b && !isDisabled(b) ? b : null;
    }, { timeoutMs: 8000 });
  } catch {
    const found = locate();
    throw new Error(
      found
        ? `кнопка отправки найдена, но неактивна (текст не принят редактором); кнопки: ${describeButtons(editor)}`
        : `кнопка отправки не найдена; кнопки рядом: ${describeButtons(editor)}`,
    );
  }
  await sleep(400 + Math.random() * 600);
  btn.click();
  // ждём, пока редактор очистится или диалог закроется
  await waitFor(
    () => {
      if (editor && document.contains(editor)) return normalized(editor.textContent).length === 0 ? true : null;
      const dialog = document.querySelector('div[role="dialog"]');
      if (!dialog) return true;
      const ed = dialog.querySelector<HTMLElement>('div[contenteditable="true"]');
      return !ed || normalized(ed.textContent).length === 0 ? true : null;
    },
    { timeoutMs: 10_000 },
  ).catch(() => undefined);
  await sleep(1000 + Math.random() * 2000);
}

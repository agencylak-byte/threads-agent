import { sleep, waitFor } from '../dom-utils';

// Человекоподобный ввод в contenteditable (Lexical-подобный редактор Threads).
// Способы по очереди: insertText целиком → paste → beforeinput; следующий — только если поле пустое.
// Перед отправкой проверяем, что в поле ровно наш текст (без дублей).

export async function typeInto(editor: HTMLElement, text: string): Promise<void> {
  editor.focus();
  await sleep(150);
  if (editorText(editor)) await clearOrThrow(editor);
  selectAllIn(editor);
  // Целиком одним вызовом: посимвольный ввод с паузами в скрытом окне Chrome троттлит таймеры
  // до раза в минуту — отправка не успевала (1–4.10 ни одной отправки). Threads видит только итоговый текст.
  // Каждый следующий способ — только если поле осталось ПУСТЫМ: Lexical рисует текст с задержкой,
  // и раньше fallback'и вставляли текст поверх уже вставленного (06.10 — тройной текст, −119 символов).
  const attempts: Array<() => void> = [
    () => document.execCommand('insertText', false, text),
    () => pasteInto(editor, text),
    () => editor.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: text, bubbles: true, cancelable: true })),
  ];
  for (const attempt of attempts) {
    editor.focus();
    try {
      attempt();
    } catch {
      /* следующий способ */
    }
    await waitFor(() => (editorText(editor) ? true : null), { timeoutMs: 1500, intervalMs: 100 }).catch(() => undefined);
    if (editorText(editor)) break;
  }
  if (!editorContains(editor, text)) {
    await clearOrThrow(editor).catch(() => undefined);
    throw new Error('ввод не отобразился в редакторе');
  }
  if (!editorMatches(editor, text)) {
    // в поле больше/другое, чем наш текст (дубль) — не отправляем
    const len = editorText(editor).length;
    await clearOrThrow(editor).catch(() => undefined);
    throw new Error(`в поле ${len} симв. вместо ${norm(text).length} — похоже на дубль, не отправляю`);
  }
  // подстраховка для React/Lexical: явное input-событие, чтобы состояние формы обновилось
  editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text.slice(-1) }));
  await sleep(300);
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

function editorText(editor: HTMLElement): string {
  return norm(editor.innerText || editor.textContent || '');
}

/** В поле ровно наш текст (с точностью до пробелов), без повторов. */
export function editorMatches(editor: HTMLElement, text: string): boolean {
  const have = editorText(editor);
  const want = norm(text);
  return have === want || (Math.abs(have.length - want.length) <= 3 && have.startsWith(want.slice(0, 40)));
}

async function clearOrThrow(editor: HTMLElement): Promise<void> {
  clearEditor(editor);
  await sleep(200);
  if (editorText(editor)) {
    editor.dispatchEvent(new InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true, cancelable: true }));
    await sleep(200);
  }
  if (editorText(editor)) throw new Error('не удалось очистить поле ввода');
}

function pasteInto(editor: HTMLElement, text: string): void {
  editor.focus();
  const dt = new DataTransfer();
  dt.setData('text/plain', text);
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  editor.dispatchEvent(ev);
}

function selectAllIn(el: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  range.collapse(false);
}

function clearEditor(el: HTMLElement): void {
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  document.execCommand('delete', false);
}

export function editorContains(editor: HTMLElement, text: string): boolean {
  const have = norm(editor.innerText || editor.textContent || '');
  const want = norm(text);
  return have.includes(want.slice(0, Math.min(want.length, 60)));
}

/** Ждём появления редактора после клика на «Ответить»/«Создать»: в диалоге, иначе — тот, что в фокусе, иначе первый видимый. */
export function waitForEditor(root: ParentNode = document, timeoutMs = 8000): Promise<HTMLElement> {
  const sel = 'div[contenteditable="true"][role="textbox"], div[contenteditable="true"], textarea';
  return waitFor(() => {
    const dialog = root.querySelector('div[role="dialog"]');
    if (dialog) {
      const ed = dialog.querySelector<HTMLElement>(sel);
      if (ed && ed.offsetParent !== null) return ed;
    }
    const active = document.activeElement as HTMLElement | null;
    if (active && active.matches(sel) && active.offsetParent !== null) return active;
    const all = Array.from(root.querySelectorAll<HTMLElement>(sel)).filter((e) => e.offsetParent !== null);
    return all[0] ?? null;
  }, { timeoutMs });
}

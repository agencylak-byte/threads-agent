import { sleep, waitFor } from '../dom-utils';

// Человекоподобный ввод в contenteditable (Lexical-подобный редактор Threads).
// Стратегия 1: execCommand('insertText') посимвольно — React видит input-события.
// Стратегия 2 (fallback): одно paste-событие с DataTransfer.
// После ввода проверяем, что текст реально появился в редакторе.

export async function typeInto(editor: HTMLElement, text: string): Promise<void> {
  editor.focus();
  await sleep(150);
  selectAllIn(editor);
  // Целиком одним вызовом: посимвольный ввод с паузами в скрытом окне Chrome троттлит таймеры
  // до раза в минуту — отправка не успевала (1–4.10 ни одной отправки). Threads видит только итоговый текст.
  let ok = false;
  try {
    ok = document.execCommand('insertText', false, text);
  } catch {
    ok = false;
  }
  if (!ok || !editorContains(editor, text)) {
    clearEditor(editor);
    pasteInto(editor, text);
    await sleep(300);
  }
  if (!editorContains(editor, text)) {
    clearEditor(editor);
    editor.focus();
    editor.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: text, bubbles: true, cancelable: true }));
    await sleep(400);
  }
  if (!editorContains(editor, text)) throw new Error('ввод не отобразился в редакторе');
  // подстраховка для React/Lexical: явное input-событие, чтобы состояние формы обновилось
  editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text.slice(-1) }));
  await sleep(300);
}

function pasteInto(editor: HTMLElement, text: string): void {
  editor.focus();
  const dt = new DataTransfer();
  dt.setData('text/plain', text);
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  editor.dispatchEvent(ev);
  if (!editorContains(editor, text)) {
    // редактор не обработал paste — последний шанс: insertText целиком
    document.execCommand('insertText', false, text);
  }
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
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
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

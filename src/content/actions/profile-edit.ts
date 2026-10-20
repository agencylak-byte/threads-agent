import { sleep, waitFor } from '../dom-utils';
import { typeInto } from './typing';
import { dumpPage } from '../page-dump';

// Смена «Био» в своём профиле (20.10, Лера: «вставь сам»). Вёрстку окна редактирования заранее не видели,
// поэтому ищем по видимому тексту кнопок и полей; при сбое прикладываем снимок страницы.

export interface BioResult {
  ok: boolean;
  error?: string;
  debugHtml?: string;
}

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

function visible(el: Element): boolean {
  return (el as HTMLElement).offsetParent !== null || (el as HTMLElement).getClientRects().length > 0;
}

function clickable(re: RegExp, root: ParentNode = document): HTMLElement | null {
  const els = Array.from(root.querySelectorAll<HTMLElement>('div[role="button"], button, a[role="link"], [role="menuitem"]'));
  return els.find((e) => visible(e) && re.test(clean(e.textContent))) ?? null;
}

/** Самое верхнее открытое окно (вложенное окно «Био» поверх окна профиля). */
function topDialog(): HTMLElement | null {
  const ds = Array.from(document.querySelectorAll<HTMLElement>('div[role="dialog"]')).filter(visible);
  return ds[ds.length - 1] ?? null;
}

function bioField(root: ParentNode): HTMLElement | null {
  const ta = Array.from(root.querySelectorAll<HTMLTextAreaElement>('textarea')).find(visible);
  if (ta) return ta;
  return Array.from(root.querySelectorAll<HTMLElement>('div[contenteditable="true"]')).find(visible) ?? null;
}

function setTextarea(ta: HTMLTextAreaElement, text: string): void {
  ta.focus();
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(ta, text);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  ta.dispatchEvent(new Event('change', { bubbles: true }));
}

export async function updateBio(text: string): Promise<BioResult> {
  const fail = (error: string): BioResult => ({ ok: false, error, debugHtml: `<!-- result: ${error} -->\n${dumpPage()}` });
  try {
    const edit = await waitFor(() => clickable(/^(редактировать профиль|edit profile)$/i), { timeoutMs: 10_000 }).catch(() => null);
    if (!edit) return fail('кнопка «Редактировать профиль» не найдена');
    edit.click();
    const dlg = await waitFor(() => topDialog(), { timeoutMs: 8000 }).catch(() => null);
    if (!dlg) return fail('окно редактирования профиля не открылось');
    await sleep(800);

    // поле «Био»: либо сразу поле ввода, либо строка, по клику на которую открывается отдельное окно
    let field = Array.from(dlg.querySelectorAll<HTMLElement>('textarea, div[contenteditable="true"]')).find(
      (f) => visible(f) && /био|bio/i.test(`${f.getAttribute('aria-label') ?? ''} ${f.getAttribute('placeholder') ?? ''} ${f.closest('label')?.textContent ?? ''}`),
    );
    if (!field) {
      const row = Array.from(dlg.querySelectorAll<HTMLElement>('div[role="button"], label, div'))
        .filter(visible)
        .find((e) => /^(биография|био|bio)\b/i.test(clean(e.textContent)) && clean(e.textContent).length < 200);
      if (!row) return fail('строка «Биография» в окне профиля не найдена');
      row.click();
      await sleep(1000);
      field = (await waitFor(() => bioField(topDialog() ?? document), { timeoutMs: 6000 }).catch(() => null)) ?? undefined;
    }
    if (!field) return fail('поле для текста «Биографии» не появилось');

    if (field instanceof HTMLTextAreaElement) setTextarea(field, text);
    else await typeInto(field, text);
    await sleep(800);

    // «Готово» во вложенном окне, затем «Готово»/«Сохранить» в окне профиля
    for (let i = 0; i < 2; i++) {
      const top = topDialog();
      if (!top) break;
      const done = clickable(/^(готово|сохранить|done|save)$/i, top);
      if (!done) break;
      done.click();
      await sleep(1500);
    }
    await sleep(1500);
    const head = clean(text).slice(0, 25).toLowerCase();
    const saved = await waitFor(() => (clean(document.body.innerText).toLowerCase().includes(head) && !topDialog() ? true : null), {
      timeoutMs: 8000,
    }).catch(() => false);
    if (!saved) return fail('после «Готово» новая биография на странице профиля не видна');
    return { ok: true };
  } catch (e) {
    return fail(String(e));
  }
}

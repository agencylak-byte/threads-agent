import { sleep, waitFor } from '../dom-utils';
import { q } from '../selectors';
import { typeInto, waitForEditor } from './typing';
import { clickSubmit } from './submit';
import { findPostContainers } from '../parsers/post-card';
import type { ExecResult } from './execute';

// Публикация нового поста: открыть composer («Новая публикация» в меню или плейсхолдер в ленте) → ввести → отправить.

function findCreateButton(): HTMLElement | null {
  const el = q<HTMLElement>('createPost');
  if (el) return el.closest<HTMLElement>('[role="button"], a, button') ?? el;
  return (
    Array.from(document.querySelectorAll<HTMLElement>('div[role="button"]')).find((d) =>
      /^(новая публикация|создать|create|new thread)$/i.test((d.textContent ?? '').trim()),
    ) ?? null
  );
}

export async function publishPost(text: string, selfHandle: string): Promise<ExecResult> {
  const btn = findCreateButton();
  if (!btn) return { ok: false, verified: false, error: 'кнопка создания поста не найдена' };
  btn.click();
  let editor: HTMLElement;
  try {
    editor = await waitForEditor();
  } catch {
    return { ok: false, verified: false, error: 'composer не открылся' };
  }
  await sleep(1500 + Math.random() * 1500);
  try {
    await typeInto(editor, text);
    await clickSubmit(editor);
  } catch (e) {
    return { ok: false, verified: false, error: (e as Error).message };
  }
  // проверка: на своём профиле или в ленте появился наш пост с этим началом
  const head = text.replace(/\s+/g, ' ').trim().slice(0, 30).toLowerCase();
  const verified = await waitFor(
    () => {
      for (const c of findPostContainers(document)) {
        if (!c.querySelector(`a[href^="/@${selfHandle}"]`)) continue;
        if ((c.textContent ?? '').replace(/\s+/g, ' ').toLowerCase().includes(head)) return true;
      }
      return null;
    },
    { timeoutMs: 12_000, intervalMs: 600 },
  ).catch(() => false);
  return { ok: true, verified: verified === true, resultUrl: location.href };
}

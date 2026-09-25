import { LABELS } from '../selectors';
import { sleep, waitFor } from '../dom-utils';

// Поиск и нажатие кнопки «Опубликовать»/«Post» в открытом composer'е и проверка, что он закрылся.

function normalized(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Кнопка отправки: role=button/button с текстом или aria-label из LABELS.post, внутри диалога если он есть. */
export function findSubmitButton(root: ParentNode = document): HTMLElement | null {
  const dialog = root.querySelector('div[role="dialog"]');
  const scope = dialog ?? root;
  const labels = LABELS.post.map((l) => l.toLowerCase());
  const candidates = Array.from(scope.querySelectorAll<HTMLElement>('div[role="button"], button'));
  const byLabel = candidates.find((b) => labels.includes(normalized(b.getAttribute('aria-label'))));
  if (byLabel) return byLabel;
  return candidates.find((b) => labels.includes(normalized(b.textContent)) && b.children.length <= 2) ?? null;
}

export function isDisabled(btn: HTMLElement): boolean {
  if (btn.getAttribute('aria-disabled') === 'true') return true;
  if ((btn as HTMLButtonElement).disabled) return true;
  const op = Number(getComputedStyle(btn).opacity || '1');
  return op < 0.6;
}

export async function clickSubmit(root: ParentNode = document): Promise<void> {
  const btn = await waitFor(() => {
    const b = findSubmitButton(root);
    return b && !isDisabled(b) ? b : null;
  }, { timeoutMs: 6000 });
  await sleep(400 + Math.random() * 600);
  btn.click();
  // ждём, пока диалог/редактор исчезнет или очистится
  await waitFor(
    () => {
      const dialog = root.querySelector('div[role="dialog"]');
      if (!dialog) return true;
      const ed = dialog.querySelector<HTMLElement>('div[contenteditable="true"]');
      return !ed || normalized(ed.textContent).length === 0;
    },
    { timeoutMs: 10_000 },
  ).catch(() => undefined);
  await sleep(1000 + Math.random() * 2000);
}

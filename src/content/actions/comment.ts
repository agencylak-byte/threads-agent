import { postCodeFromHref, q } from '../selectors';
import { sleep, waitFor, scrollIntoViewSmooth } from '../dom-utils';
import { findPostContainers } from '../parsers/post-card';
import { typeInto, waitForEditor } from './typing';
import { clickSubmit } from './submit';
import { readingPauseMs } from '@/engine/pacing';
import type { ExecResult } from './execute';

// Комментарий/ответ на конкретный пост: найти карточку с нужным post-code → «Ответить» → ввести → отправить → проверить.
// Используется и для comment-on-stranger (корневой пост), и для reply-* (карточка нужной реплики на странице треда).

export interface CommentTarget {
  /** id вида handle/post/code — карточка, под которой жмём «Ответить». */
  postId: string;
  text: string;
  selfHandle: string;
  likeBefore: boolean;
}

export function findCardByPostId(postId: string, root: ParentNode = document): Element | null {
  const code = postId.split('/post/')[1];
  if (!code) return null;
  for (const c of findPostContainers(root)) {
    const links = Array.from(c.querySelectorAll<HTMLAnchorElement>('a[href*="/post/"]'));
    if (links.some((a) => postCodeFromHref(a.getAttribute('href'))?.code === code)) return c;
  }
  return null;
}

function replyButton(card: Element): HTMLElement | null {
  const icon = q<SVGElement>('replyIcon', card);
  return icon?.closest<HTMLElement>('[role="button"], button, a') ?? null;
}

/** Лайк только если ещё не поставлен («Поставить "Нравится"» / «Like»), иначе кликом снимем. */
function likeButton(card: Element): HTMLElement | null {
  const icon = q<SVGElement>('likeIcon', card);
  const label = `${icon?.getAttribute('title') ?? ''} ${icon?.getAttribute('aria-label') ?? ''}`;
  if (!icon || /убрать|unlike/i.test(label)) return null;
  return icon.closest<HTMLElement>('[role="button"], button') ?? null;
}

/** На странице поста внизу есть inline-поле «Ответьте <handle>…» — оно отвечает корневому посту без клика по кнопке. */
export function findInlineReplyEditor(handle: string, root: ParentNode = document): HTMLElement | null {
  const eds = Array.from(root.querySelectorAll<HTMLElement>('div[contenteditable="true"][role="textbox"]'));
  return (
    eds.find((e) => {
      const ph = (e.getAttribute('aria-placeholder') ?? '').toLowerCase();
      return ph.includes(handle.toLowerCase()) && /ответьте|reply to/.test(ph);
    }) ?? null
  );
}

export async function commentOnPost(t: CommentTarget): Promise<ExecResult> {
  const card = await waitFor(() => findCardByPostId(t.postId), { timeoutMs: 10_000 }).catch(() => null);
  if (!card) return { ok: false, verified: false, error: 'карточка поста не найдена на странице' };
  scrollIntoViewSmooth(card);
  await sleep(readingPauseMs(card.textContent?.length ?? 200));

  if (t.likeBefore) {
    const like = likeButton(card);
    if (like) {
      like.click();
      await sleep(800 + Math.random() * 1200);
    }
  }

  const handle = t.postId.split('/post/')[0] ?? '';
  let editor: HTMLElement | null = null;
  const inline = findInlineReplyEditor(handle);
  if (inline && inline.offsetParent !== null) {
    scrollIntoViewSmooth(inline);
    await sleep(500);
    inline.click();
    inline.focus();
    await sleep(700);
    // в мобильной вёрстке клик по полю открывает модальный composer — тогда печатаем туда
    const dialogEditor = document.querySelector<HTMLElement>('div[role="dialog"] div[contenteditable="true"]');
    editor = dialogEditor && dialogEditor.offsetParent !== null ? dialogEditor : inline;
  } else {
    // кнопки под постом могут дорисоваться позже карточки — ждём именно кнопку, перечитывая карточку
    const reply = await waitFor(() => {
      const c = findCardByPostId(t.postId);
      return c ? replyButton(c) : null;
    }, { timeoutMs: 8000 }).catch(() => null);
    if (!reply) return { ok: false, verified: false, error: 'кнопка «Ответить» не найдена и нет поля ответа внизу' };
    reply.click();
    try {
      editor = await waitForEditor();
    } catch {
      return { ok: false, verified: false, error: 'редактор ответа не открылся' };
    }
  }
  try {
    await typeInto(editor, t.text);
  } catch (e) {
    return { ok: false, verified: false, error: `ввод: ${(e as Error).message}` };
  }
  try {
    await clickSubmit(editor);
  } catch (e) {
    return { ok: false, verified: false, error: `отправка: ${(e as Error).message}` };
  }
  const verified = await verifyOwnReply(t.selfHandle, t.text);
  return { ok: true, verified, resultUrl: location.href };
}

/** После отправки ищем на странице карточку с нашим handle и началом текста. */
export async function verifyOwnReply(selfHandle: string, text: string, timeoutMs = 12_000): Promise<boolean> {
  const head = text.replace(/\s+/g, ' ').trim().slice(0, 30).toLowerCase();
  const found = await waitFor(
    () => {
      for (const c of findPostContainers(document)) {
        const author = c.querySelector<HTMLAnchorElement>(`a[href^="/@${selfHandle}"]`);
        if (!author) continue;
        const body = (c.textContent ?? '').replace(/\s+/g, ' ').toLowerCase();
        if (body.includes(head)) return true;
      }
      return null;
    },
    { timeoutMs, intervalMs: 500 },
  ).catch(() => false);
  return found === true;
}

export function hasDialog(): boolean {
  return q('dialog') !== null;
}

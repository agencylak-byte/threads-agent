import type { Action } from '@/shared/types';
import { detectAnomaly } from '../anomaly-watch';
import { dumpPage } from '../page-dump';
import { commentOnPost } from './comment';
import { publishPost } from './publish';

// Точка входа исполнения действия в DOM. SW уже перевёл вкладку на нужный URL (threadUrl).
// При сбое прикладываем снимок DOM (debugHtml) — SW сохранит его в Загрузки для разбора.

export interface ExecResult {
  ok: boolean;
  verified: boolean;
  error?: string;
  resultUrl?: string;
  debugHtml?: string;
}

export async function executeAction(action: Action, selfHandle: string, likeBefore: boolean): Promise<ExecResult> {
  const text = (action.finalText ?? action.draftText ?? '').trim();
  if (!text) return { ok: false, verified: false, error: 'пустой текст' };
  const pre = detectAnomaly();
  if (pre) return { ok: false, verified: false, error: `аномалия до действия: ${pre.kind}` };

  let r: ExecResult;
  switch (action.type) {
    case 'comment-on-stranger':
    case 'reply-own-post':
    case 'reply-thread': {
      const postId = action.type === 'comment-on-stranger' ? action.targetPostId : action.parentCommentId ?? action.targetPostId;
      if (!postId) return { ok: false, verified: false, error: 'нет целевого поста' };
      r = await commentOnPost({ postId, text, selfHandle, likeBefore: likeBefore && action.type === 'comment-on-stranger' });
      break;
    }
    case 'publish-post':
      r = await publishPost(text, selfHandle);
      break;
    default:
      return { ok: false, verified: false, error: `${action.type} — в следующем инкременте` };
  }
  const post = detectAnomaly();
  if (post && r.ok) r = { ...r, ok: false, verified: false, error: `аномалия после действия: ${post.kind}` };
  if (!r.ok || !r.verified) r.debugHtml = `<!-- result: ${r.ok ? 'отправлено, не подтверждено' : r.error ?? ''} -->\n` + (safeDump() ?? '');
  return r;
}

function safeDump(): string | undefined {
  try {
    return dumpPage();
  } catch {
    return undefined;
  }
}

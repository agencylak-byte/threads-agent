import { useState } from 'preact/hooks';
import { request } from '@/shared/messages';
import { ACTION_TYPE_LABELS } from '@/shared/constants';
import type { Action } from '@/shared/types';
import { call, refreshActions } from '../store';

// Карточка одного предложения. Approve = поставить в очередь отправки (или скопировать и открыть пост,
// если движок остановлен — «ручной второй пилот»).

export function ActionCard({ action, compact = false }: { action: Action; compact?: boolean }) {
  const [text, setText] = useState(action.finalText ?? action.draftText ?? '');
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const url = action.threadUrl ?? (action.targetPostId ? `https://www.threads.com/@${action.targetPostId.replace('/post/', '/post/')}` : undefined);

  const approve = async () => {
    setBusy(true);
    await call(() => request('APPROVE', { actionId: action.id, text: text !== action.draftText ? text : undefined }));
    await refreshActions();
    setBusy(false);
  };
  const copyAndOpen = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* без разрешения на буфер — просто откроем */
    }
    if (url) await call(() => request('OPEN_URL', { url }));
  };
  const reject = async (notMyVoice: boolean) => {
    setBusy(true);
    await call(() => request('REJECT', { actionId: action.id, reason: reason || undefined, notMyVoice }));
    await refreshActions();
    setBusy(false);
  };
  const regenerate = async () => {
    setBusy(true);
    const r = await call(() => request('REGENERATE', { actionId: action.id, hint: reason || undefined }));
    if (r?.draftText) setText(r.draftText);
    setBusy(false);
  };

  return (
    <div class="card">
      <div class="small muted">
        {ACTION_TYPE_LABELS[action.type]} · @{action.targetHandle} · {statusLabel(action.status)}
        {url && <> · <a href={url} target="_blank" rel="noreferrer">открыть</a></>}
      </div>
      {action.needsReview && <div class="banner warn small">Защита от выдуманных цифр: {action.error?.replace('защита от выдуманных цифр: ', '')}. Проверьте текст и одобрите вручную или пропустите.</div>}
      {!compact && action.context && (
        <details style="margin:6px 0">
          <summary class="small">Контекст (пост)</summary>
          <div class="small" style="white-space:pre-wrap">{action.context.slice(0, 1200)}</div>
        </details>
      )}
      {compact ? (
        <div>
          <div class="small" style="white-space:pre-wrap">{text}</div>
          {action.error && <div class="small muted" style="margin-top:4px">последняя попытка: {action.error.slice(0, 160)}{action.scheduledFor ? ` · повтор в ${new Date(action.scheduledFor).toLocaleTimeString('ru-RU')}` : ''}</div>}
        </div>
      ) : !action.draftText && !text ? (
        <div>
          <div class="muted small">Черновик пишется… {action.error ? `(последняя попытка: ${action.error.slice(0, 120)})` : ''}</div>
          <div class="row" style="margin-top:6px">
            <button disabled={busy} onClick={regenerate}>Написать сейчас</button>
            <button disabled={busy} onClick={() => reject(false)}>Пропустить</button>
          </div>
        </div>
      ) : (
        <>
          <textarea value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
          <div class="small muted">{text.length} зн.</div>
          <div class="row" style="margin-top:6px">
            <button class="primary" disabled={busy || !text.trim()} onClick={approve}>Одобрить</button>
            <button disabled={busy} onClick={copyAndOpen}>Скопировать и открыть</button>
            <button disabled={busy} onClick={regenerate}>Переписать</button>
            <button disabled={busy} onClick={() => reject(false)}>Пропустить</button>
            <button disabled={busy} onClick={() => reject(true)}>Не мой голос</button>
          </div>
          <input style="margin-top:6px" value={reason} placeholder="почему / как переписать (необязательно)" onInput={(e) => setReason((e.target as HTMLInputElement).value)} />
        </>
      )}
    </div>
  );
}

function statusLabel(s: Action['status']): string {
  switch (s) {
    case 'proposed':
      return 'предложено';
    case 'approved':
      return 'одобрено';
    case 'queued':
      return 'в очереди отправки';
    case 'executing':
      return 'отправляется';
    case 'done':
      return 'отправлено';
    case 'failed':
      return 'ошибка';
    case 'rejected':
      return 'отклонено';
    case 'expired':
      return 'просрочено';
  }
}

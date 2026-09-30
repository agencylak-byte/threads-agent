import { URLS } from '@/content/selectors';
import { getSettings, selfHandleItem, engineStateItem } from '@/shared/settings';
import { log } from '@/shared/log';
import type { Action } from '@/shared/types';
import type { ContentToSw } from '@/shared/messages';
import type { ExecResult } from '@/engine/dispatcher';
import { getWorkTab, navigateWorkTab } from './tabs';
import { sendToTab, waitForMessage } from './ports';
import { setAnomalyHandler } from './inbound';
import { applyAnomaly, label } from '@/engine/anomaly-policy';
import { broadcast } from './state';
import { addEvent } from '@/db/repo-events';

// Исполнитель для диспетчера: перевести рабочую вкладку на нужную страницу и отдать действие content-скрипту.

const isResult = (id: string) => (m: ContentToSw): m is Extract<ContentToSw, { type: 'ACTION_RESULT' }> =>
  m.type === 'ACTION_RESULT' && m.actionId === id;

export async function executeInTab(action: Action): Promise<ExecResult> {
  const [self, settings] = await Promise.all([selfHandleItem.getValue(), getSettings()]);
  if (!self) return { ok: false, verified: false, error: 'не определён свой handle' };
  const url = targetUrl(action, self);
  try {
    const tabId = await getWorkTab();
    await navigateWorkTab(url);
    const res = waitForMessage(tabId, isResult(action.id), 120_000);
    if (!sendToTab(tabId, { type: 'EXECUTE_ACTION', action, selfHandle: self, likeBefore: settings.likeBeforeComment })) {
      return { ok: false, verified: false, error: 'content script не подключён', transient: true };
    }
    const r = await res;
    if (!r.ok && /экран ошибки загрузки/.test(r.error ?? '')) return { ok: false, verified: false, error: r.error, transient: true };
    if (r.debugHtml) {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      browser.downloads
        .download({
          url: 'data:text/html;charset=utf-8,' + encodeURIComponent(r.debugHtml),
          filename: `threads-agent/fail-${action.type}-${stamp}.html`,
          saveAs: false,
        })
        .catch(() => undefined);
    }
    return { ok: r.ok, verified: r.verified, error: r.error, resultUrl: r.resultUrl };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const transient = /вкладк|content script|timeout waiting for content|did not connect/i.test(msg);
    return { ok: false, verified: false, error: msg, transient };
  }
}

function targetUrl(action: Action, self: string): string {
  if (action.type === 'publish-post') return URLS.profile(self);
  return action.threadUrl ?? URLS.feed;
}

/** Аномалия из content-скрипта → политика пауз + уведомление. */
export function initAnomalyHandling(): void {
  setAnomalyHandler((m) => {
    void (async () => {
      const st = await engineStateItem.getValue();
      if (st.status === 'stopped') return;
      const next = applyAnomaly(st, m.anomaly);
      await engineStateItem.setValue(next);
      await addEvent({ at: Date.now(), kind: 'anomaly', message: label(m.anomaly), payload: m.anomaly, url: m.anomaly.url });
      log('anomaly', label(m.anomaly), m.anomaly);
      broadcast('state');
      try {
        await browser.notifications.create({
          type: 'basic',
          iconUrl: browser.runtime.getURL('/icon-128.png'),
          title: 'Threads-агент: пауза',
          message: next.pauseReason ?? label(m.anomaly),
        });
      } catch {
        /* без иконки уведомление может не создаться — не критично */
      }
    })();
  });
}

const isVerifyResult = (id: string) => (m: ContentToSw): m is Extract<ContentToSw, { type: 'VERIFY_RESULT' }> =>
  m.type === 'VERIFY_RESULT' && m.actionId === id;

/** Открыть тред и проверить, есть ли там наш комментарий. null — не удалось проверить (вкладка/порт). */
export async function verifyInTab(action: Action): Promise<boolean | null> {
  const self = await selfHandleItem.getValue();
  if (!self || !action.threadUrl) return null;
  try {
    const tabId = await getWorkTab();
    await navigateWorkTab(action.threadUrl);
    const res = waitForMessage(tabId, isVerifyResult(action.id), 30_000);
    if (!sendToTab(tabId, { type: 'VERIFY_REPLY', actionId: action.id, selfHandle: self, text: action.finalText ?? action.draftText ?? '' })) return null;
    return (await res).found;
  } catch {
    return null;
  }
}

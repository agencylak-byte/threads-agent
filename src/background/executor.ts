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
      return { ok: false, verified: false, error: 'content script не подключён' };
    }
    const r = await res;
    return { ok: r.ok, verified: r.verified, error: r.error, resultUrl: r.resultUrl };
  } catch (e) {
    return { ok: false, verified: false, error: e instanceof Error ? e.message : String(e) };
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

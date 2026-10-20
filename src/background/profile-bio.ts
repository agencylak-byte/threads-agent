import { URLS } from '@/content/selectors';
import { bioAttemptsItem, pendingBioItem, selfHandleItem } from '@/shared/settings';
import { log } from '@/shared/log';
import type { ContentToSw } from '@/shared/messages';
import { getWorkTab, navigateWorkTab } from './tabs';
import { sendToTab, waitForMessage, withKeepAlive } from './ports';

// Поставить «Био» в профиль, если оно задано (20.10, Лера попросила сделать это за неё). Не больше 3 попыток.

const isBio = (m: ContentToSw): m is Extract<ContentToSw, { type: 'BIO_RESULT' }> => m.type === 'BIO_RESULT';

export async function applyPendingBio(): Promise<void> {
  const [text, attempts, self] = await Promise.all([pendingBioItem.getValue(), bioAttemptsItem.getValue(), selfHandleItem.getValue()]);
  if (!text || !self || attempts >= 3) return;
  await bioAttemptsItem.setValue(attempts + 1);
  await withKeepAlive(async () => {
    try {
      const tabId = await getWorkTab();
      await navigateWorkTab(URLS.profile(self));
      const res = waitForMessage(tabId, isBio, 90_000);
      if (!sendToTab(tabId, { type: 'UPDATE_BIO', text })) return;
      const r = await res;
      if (r.ok) {
        await pendingBioItem.setValue('');
        log('info', 'профиль: новое «Био» поставлено');
        return;
      }
      log('error', `профиль: «Био» не поставилось (попытка ${attempts + 1}): ${r.error ?? ''}`);
      if (r.debugHtml) {
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        await browser.downloads
          .download({ url: 'data:text/html;charset=utf-8,' + encodeURIComponent(r.debugHtml), filename: `threads-agent/fail-bio-${stamp}.html`, saveAs: false })
          .catch(() => undefined);
      }
    } catch (e) {
      log('error', 'профиль: «Био» не поставилось', String(e));
    }
  });
}

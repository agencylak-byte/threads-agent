import { URLS } from '@/content/selectors';
import { getSettings, selfHandleItem } from '@/shared/settings';
import { dateKey, setMetric } from '@/db/repo-metrics';
import { getAuthor } from '@/db/repo-authors';
import { pruneEvents } from '@/db/repo-events';
import { log } from '@/shared/log';
import { navigateWorkTab } from './tabs';
import { sendToTab, waitForMessage } from './ports';
import { getWorkTab } from './tabs';
import type { ContentToSw } from '@/shared/messages';

// Раз в сутки: снять число подписчиков со своего профиля → metrics_daily.followers; подчистить события.

const isProfile = (m: ContentToSw): m is Extract<ContentToSw, { type: 'PROFILE_OBSERVED' }> => m.type === 'PROFILE_OBSERVED';

export async function dailyMetrics(): Promise<void> {
  const self = await selfHandleItem.getValue();
  if (!self) return;
  try {
    const tabId = await getWorkTab(false);
    await navigateWorkTab(URLS.profile(self));
    const p = waitForMessage(tabId, isProfile, 20_000);
    sendToTab(tabId, {
      type: 'COLLECT',
      params: { mode: 'self', source: 'own', sourceDetail: self, maxPosts: 10, scrollPauseMs: [800, 1500] },
    });
    const r = await p.catch(() => null);
    const followers = r?.profile.followers ?? (await getAuthor(self))?.followers;
    const s = await getSettings();
    if (followers !== undefined) await setMetric(dateKey(Date.now(), s.timezone), { followers });
    log('info', `daily metrics: followers=${followers ?? '—'}`);
  } catch (e) {
    log('error', 'daily metrics failed', String(e));
  }
  await pruneEvents(5000);
}

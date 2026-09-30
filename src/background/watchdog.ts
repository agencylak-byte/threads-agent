import { checkSilence } from '@/engine/watchdog';
import { engineStateItem, getSettings, apiKeyItem } from '@/shared/settings';
import { listActionsByStatus, listExecutedBetween } from '@/db/repo-actions';
import { getAllPosts } from '@/db/repo-posts';
import { addEvent } from '@/db/repo-events';
import { dailyLimit } from '@/engine/pacing';
import { log } from '@/shared/log';
import { broadcast } from './state';

// Сторож тишины: раз в час собирает факты и, если агент молчит там, где должен работать, — уведомление.

export async function runWatchdog(): Promise<void> {
  const now = Date.now();
  const [engine, settings, apiKey] = await Promise.all([engineStateItem.getValue(), getSettings(), apiKeyItem.getValue()]);
  if (!apiKey) return;
  const queued = (await listActionsByStatus(['queued'], 300)).filter((a) => (a.draftText || a.finalText) && (!a.scheduledFor || a.scheduledFor <= now));
  const last2h = await listExecutedBetween(now - 2 * 3600_000, now + 1);
  const today = await listExecutedBetween(now - 24 * 3600_000, now + 1);
  let dailyLimitLeft = 0;
  for (const t of new Set(queued.map((a) => a.type))) {
    dailyLimitLeft += Math.max(0, dailyLimit(t, now, settings) - today.filter((a) => a.type === t).length);
  }
  const posts = await getAllPosts();
  const collectedLast24h = posts.filter((p) => p.firstSeenAt > now - 24 * 3600_000).length;
  const candidatesReady = posts.filter((p) => p.actionStatus === 'none' && (p.ai?.commentScore ?? 0) >= settings.commentMin).length;
  const alerts = checkSilence({
    engine,
    settings,
    now,
    queuedReady: queued.length,
    executedLast2h: last2h.length,
    verifiedLast2h: last2h.filter((a) => a.outcome.verified).length,
    dailyLimitLeft,
    collectedLast24h,
    candidatesReady,
  });
  if (!alerts.length) return;
  for (const a of alerts) {
    await addEvent({ at: now, kind: 'anomaly', message: `сторож: ${a.message}` });
    log('anomaly', `watchdog ${a.kind}: ${a.message}`);
  }
  broadcast('state');
  try {
    await browser.notifications.create({
      type: 'basic',
      iconUrl: browser.runtime.getURL('/icon-128.png'),
      title: 'Threads-агент: тишина',
      message: alerts.map((a) => a.message).join('\n').slice(0, 400),
    });
  } catch {
    /* уведомления могут быть выключены */
  }
}

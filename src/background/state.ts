import { countPosts } from '@/db/repo-posts';
import { countAuthors } from '@/db/repo-authors';
import { countActionsByStatus } from '@/db/repo-actions';
import { countEvents } from '@/db/repo-events';
import { dateKey, getMetrics } from '@/db/repo-metrics';
import { apiKeyItem, engineStateItem, getSettings, selfHandleItem, voiceProfileItem } from '@/shared/settings';
import type { JobRequest, StateSnapshot, SwToUi } from '@/shared/messages';

// Снимок состояния для UI + широковещание «что-то изменилось».

let lastSelftest: StateSnapshot['lastSelftest'];
let currentJob: JobRequest | null = null;

export function setLastSelftest(v: StateSnapshot['lastSelftest']): void {
  lastSelftest = v;
}
export function setCurrentJob(j: JobRequest | null): void {
  currentJob = j;
  broadcast('state');
}
export function getCurrentJob(): JobRequest | null {
  return currentJob;
}

export async function buildSnapshot(): Promise<StateSnapshot> {
  const [engine, selfHandle, posts, authors, proposed, queued, done, events, settings, apiKey, profile] = await Promise.all([
    engineStateItem.getValue(),
    selfHandleItem.getValue(),
    countPosts(),
    countAuthors(),
    countActionsByStatus('proposed'),
    countActionsByStatus('queued'),
    countActionsByStatus('done'),
    countEvents(),
    getSettings(),
    apiKeyItem.getValue(),
    voiceProfileItem.getValue(),
  ]);
  const today = await getMetrics(dateKey(Date.now(), settings.timezone));
  return {
    engine,
    selfHandle,
    counts: { posts, authors, proposed, queued, done, events },
    currentJob,
    lastSelftest,
    todayCost: today.llmCostUsd,
    hasApiKey: apiKey.length > 0,
    profileVersion: profile?.version ?? null,
  };
}

let pending: ReturnType<typeof setTimeout> | null = null;
const pendingWhat = new Set<SwToUi['what']>();

/** Дебаунс 150 мс: коллектор шлёт батчи часто, UI хватит одного обновления. */
export function broadcast(what: SwToUi['what']): void {
  pendingWhat.add(what);
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    for (const w of pendingWhat) {
      const msg: SwToUi = { type: 'STATE_CHANGED', what: w };
      browser.runtime.sendMessage(msg).catch(() => {
        /* панель закрыта — некому слушать */
      });
    }
    pendingWhat.clear();
  }, 150);
}

import { countPosts, getAllPosts } from '@/db/repo-posts';
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
  const all = await getAllPosts();
  const funnel = { unclassified: 0, classified: 0, lprPass: 0, candidates: 0, skipped: 0, commented: 0 };
  const maxAge = settings.maxPostAgeDays * 86_400_000;
  const now = Date.now();
  for (const p of all) {
    if (p.source === 'own') continue;
    if (!p.ai) {
      funnel.unclassified++;
      continue;
    }
    funnel.classified++;
    if (p.actionStatus === 'skipped') funnel.skipped++;
    if (p.actionStatus === 'commented') funnel.commented++;
    if (p.ai.isFreelancer || (p.ai.commentScore ?? 0) < settings.commentMin) continue;
    funnel.lprPass++;
    const fresh = now - (p.postedAt ?? p.firstSeenAt) <= maxAge;
    if (p.ai.lprScore >= settings.lprMinScore && (p.ai.relevance ?? 0) >= settings.relevanceMin && fresh && p.actionStatus === 'none') funnel.candidates++;
  }
  return {
    engine,
    selfHandle,
    counts: { posts, authors, proposed, queued, done, events },
    funnel,
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

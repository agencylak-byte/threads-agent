import { URLS } from '@/content/selectors';
import { getSettings, selfHandleItem } from '@/shared/settings';
import { log } from '@/shared/log';
import type { CollectParams, ContentToSw, JobRequest } from '@/shared/messages';
import { getWorkTab, navigateWorkTab } from './tabs';
import { sendToTab, waitForMessage } from './ports';
import { setCurrentJob } from './state';
import { getAuthor } from '@/db/repo-authors';

// Джобы сбора (только чтение). Один джоб за раз; каждый — последовательность «перейти → собрать → дождаться».

let running = false;
let stopRequested = false;

const isCollectDone = (m: ContentToSw): m is Extract<ContentToSw, { type: 'COLLECT_DONE' }> => m.type === 'COLLECT_DONE';

async function collect(url: string, params: CollectParams, timeoutMs = 120_000): Promise<number> {
  const tabId = await getWorkTab();
  await navigateWorkTab(url);
  if (stopRequested) return 0;
  const done = waitForMessage(tabId, isCollectDone, timeoutMs);
  if (!sendToTab(tabId, { type: 'COLLECT', params })) throw new Error('content script не подключён');
  const r = await done;
  return r.count;
}

export function isJobRunning(): boolean {
  return running;
}

export function requestStop(): void {
  stopRequested = true;
}

export async function runJob(job: JobRequest): Promise<{ ok: boolean; error?: string }> {
  if (running) return { ok: false, error: 'Уже идёт другой сбор' };
  running = true;
  stopRequested = false;
  setCurrentJob(job);
  const s = await getSettings();
  const base: Pick<CollectParams, 'maxPosts' | 'scrollPauseMs'> = { maxPosts: s.collectMaxPosts, scrollPauseMs: s.collectScrollPauseMs };
  try {
    switch (job.kind) {
      case 'collect-keyword': {
        const kw = job.param?.trim();
        if (!kw) throw new Error('Не задано ключевое слово');
        const n = await collect(URLS.search(kw, true), { ...base, mode: 'search', source: 'keyword', sourceDetail: kw });
        log('info', `collect-keyword «${kw}»: ${n} постов`);
        break;
      }
      case 'collect-feed': {
        const n = await collect(URLS.feed, { ...base, mode: 'feed', source: 'feed', sourceDetail: 'for-you' });
        log('info', `collect-feed: ${n} постов`);
        break;
      }
      case 'collect-self': {
        const self = await selfHandleItem.getValue();
        if (!self) throw new Error('Не определён свой handle — откройте threads.com и войдите');
        const n = await collect(URLS.profile(self), { ...base, mode: 'self', source: 'own', sourceDetail: self, maxPosts: 80 });
        log('info', `collect-self: ${n} своих постов`);
        break;
      }
      case 'collect-activity': {
        const n = await collect(URLS.activity, { ...base, mode: 'activity', source: 'activity', sourceDetail: 'activity', maxPosts: 40 });
        log('info', `collect-activity: ${n} записей`);
        break;
      }
      case 'collect-competitor': {
        const comp = job.param?.replace(/^@/, '').trim();
        if (!comp) throw new Error('Не задан handle конкурента');
        // 1) подписчики конкурента → handles
        const handles = await collect(URLS.followers(comp), {
          ...base,
          mode: 'followers',
          source: 'competitor',
          sourceDetail: comp,
          maxHandles: s.competitorFollowersPerRun,
        });
        log('info', `collect-competitor «${comp}»: ${handles} подписчиков`);
        // 2) у каждого нового подписчика — профиль + свежие посты (не больше N за прогон, чтобы не жечь лимиты)
        const perRun = Math.min(handles, 12);
        const fresh = await freshFollowers(comp, perRun);
        for (const h of fresh) {
          if (stopRequested) break;
          await collect(URLS.profile(h), { ...base, mode: 'profile', source: 'competitor', sourceDetail: comp, maxPosts: 8 });
        }
        break;
      }
    }
    return { ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log('error', `job ${job.kind} failed: ${error}`);
    return { ok: false, error };
  } finally {
    running = false;
    stopRequested = false;
    setCurrentJob(null);
    // не ждём минуту до alarm — сразу классифицируем и планируем по свежим данным
    void import('./engine').then((m) => m.runTick());
  }
}

/** Подписчики конкурента, у которых мы ещё не смотрели профиль (нет bio). */
async function freshFollowers(comp: string, limit: number): Promise<string[]> {
  const { getAllAuthors } = await import('@/db/repo-authors');
  const all = await getAllAuthors();
  const out: string[] = [];
  for (const a of all) {
    if (!a.tags.includes(`from:${comp}`) || a.bio) continue;
    const cur = await getAuthor(a.handle);
    if (cur && !cur.bio) out.push(a.handle);
    if (out.length >= limit) break;
  }
  return out;
}

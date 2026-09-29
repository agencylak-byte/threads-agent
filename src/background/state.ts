import { countPosts, getAllPosts } from '@/db/repo-posts';
import { listActionsByStatus, listExecutedBetween } from '@/db/repo-actions';
import { checkPacing, dailyLimit, isWorkingHours } from '@/engine/pacing';
import { isJobRunning } from './jobs';
import { countAuthors } from '@/db/repo-authors';
import { countActionsByStatus } from '@/db/repo-actions';
import { countEvents } from '@/db/repo-events';
import { dateKey, getMetrics } from '@/db/repo-metrics';
import { apiKeyItem, engineStateItem, getSettings, selfHandleItem, voiceProfileItem } from '@/shared/settings';
import type { JobRequest, StateSnapshot, SwToUi } from '@/shared/messages';
import type { EngineState } from '@/shared/types';
import type { Settings } from '@/shared/settings';

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
  const dispatchStatus = await describeDispatch(engine, settings, apiKey.length > 0);
  return {
    engine,
    selfHandle,
    counts: { posts, authors, proposed, queued, done, events },
    funnel,
    dispatchStatus,
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

function fmtTime(ts: number, tz: string): string {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(ts));
}

/** Человеческое объяснение, что происходит с отправкой одобренных. */
async function describeDispatch(engine: EngineState, settings: Settings, hasKey: boolean): Promise<string> {
  const now = Date.now();
  const queued = (await listActionsByStatus(['queued'], 100)).filter((a) => a.draftText || a.finalText);
  if (!hasKey) return 'Не задан ключ OpenRouter.';
  if (engine.status === 'stopped') return 'Движок остановлен — «Здоровье» → «Запустить».';
  if (engine.status === 'paused') return `Пауза после аномалии до ${engine.pausedUntil ? fmtTime(engine.pausedUntil, settings.timezone) : '—'}: ${engine.pauseReason ?? ''}`;
  if (!queued.length) return 'Одобренных к отправке нет.';
  if (isJobRunning()) return `Идёт сбор (${currentJob?.kind ?? ''}) — отправка продолжится после него.`;
  if (!isWorkingHours(now, settings)) return `Вне рабочего окна ${settings.workingHours.start}–${settings.workingHours.end} (${settings.timezone}). Продолжу утром.`;
  const first = queued.sort((a, b) => (a.decidedAt ?? a.createdAt) - (b.decidedAt ?? b.createdAt))[0]!;
  const dayStart = now - 24 * 3600_000;
  const today = await listExecutedBetween(dayStart, now + 1);
  const lastAll = today.reduce<number | undefined>((m, a) => Math.max(m ?? 0, a.executedAt ?? 0) || m, undefined);
  const lastSame = today.filter((a) => a.type === first.type).reduce<number | undefined>((m, a) => Math.max(m ?? 0, a.executedAt ?? 0) || m, undefined);
  const v = checkPacing({ settings, type: first.type, now, todayExecuted: today, lastExecutedAt: lastAll, lastExecutedSameTypeAt: lastSame, rng: () => 0.5 });
  if (v.ok) return `Отправляю: в очереди ${queued.length}, следующий — @${first.targetHandle} в ближайшую минуту.`;
  const limit = dailyLimit(first.type, now, settings);
  switch (v.reason) {
    case 'daily_limit':
      return `Дневной лимит ${limit} исчерпан — продолжу завтра. В очереди ${queued.length}.`;
    case 'min_gap':
    case 'same_type_gap':
      return `Пауза между отправками — следующий примерно в ${fmtTime(v.retryAt, settings.timezone)}. В очереди ${queued.length}, лимит сегодня ${limit}.`;
    case 'session_pause':
      return `Перерыв после пачки — следующий примерно в ${fmtTime(v.retryAt, settings.timezone)}. В очереди ${queued.length}.`;
    default:
      return `Жду окна — следующий в ${fmtTime(v.retryAt, settings.timezone)}.`;
  }
}

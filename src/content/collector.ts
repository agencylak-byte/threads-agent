import { atPageBottom, jitter, scrollBy, sleep } from './dom-utils';
import { findPostContainers, parsePostCard } from './parsers/post-card';
import { parseFollowers } from './parsers/followers-dialog';
import { parseProfile, detectSelfHandle } from './parsers/profile';
import { parseThreadPage } from './parsers/thread-page';
import type { CollectParams } from '@/shared/messages';
import type { ObservedPost } from '@/shared/types';

// Коллектор: наблюдает за DOM и отдаёт батчи постов. Не пишет в БД (это делает SW).
// Два режима: пассивный (всё, что видит пользователь, пока листает сам) и активный job (сам скроллит).

export interface CollectorSink {
  posts(posts: ObservedPost[]): void;
  handles(handles: string[], sourceDetail: string): void;
  thread(root: ObservedPost, replies: { post: ObservedPost; parentId: string }[]): void;
  profile(p: ReturnType<typeof parseProfile>): void;
}

const BATCH_SIZE = 20;
const BATCH_MS = 1500;

export class Collector {
  private seen = new Set<string>();
  private buffer: ObservedPost[] = [];
  private timer: number | null = null;
  private observer: MutationObserver | null = null;
  private passive: { source: ObservedPost['source']; detail?: string } | null = null;
  private stopped = false;

  constructor(private sink: CollectorSink) {}

  /** Пассивный режим: любые новые карточки на странице → батч. */
  startPassive(source: ObservedPost['source'], detail?: string): void {
    this.passive = { source, detail };
    this.observer?.disconnect();
    this.observer = new MutationObserver(() => this.scan());
    this.observer.observe(document.body, { childList: true, subtree: true });
    this.scan();
  }

  stop(): void {
    this.stopped = true;
    this.observer?.disconnect();
    this.observer = null;
    this.flush();
  }

  resetSeen(): void {
    this.seen.clear();
  }

  private scan(): void {
    if (!this.passive) return;
    for (const c of findPostContainers(document)) {
      const p = parsePostCard(c, this.passive.source, this.passive.detail);
      if (!p || this.seen.has(p.id)) continue;
      this.seen.add(p.id);
      this.push(p);
    }
  }

  private push(p: ObservedPost): void {
    this.buffer.push(p);
    if (this.buffer.length >= BATCH_SIZE) this.flush();
    else if (this.timer === null) this.timer = window.setTimeout(() => this.flush(), BATCH_MS);
  }

  private flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.buffer.length) {
      const batch = this.buffer;
      this.buffer = [];
      this.sink.posts(batch);
    }
  }

  /** Активный job: скроллим и собираем до maxPosts или конца страницы. Возвращает число новых постов. */
  async runJob(params: CollectParams, currentUrl: string): Promise<number> {
    this.stopped = false;
    this.resetSeen();
    if (params.mode === 'profile' || params.mode === 'self') {
      this.sink.profile(parseProfile(currentUrl, document, params.mode === 'self' ? detectSelfHandle() ?? undefined : undefined));
    }
    if (params.mode === 'followers') {
      return this.collectFollowers(params);
    }
    if (params.mode === 'thread') {
      const t = parseThreadPage(currentUrl);
      if (t) this.sink.thread(t.root, t.replies);
      return t ? t.replies.length + 1 : 0;
    }
    this.startPassive(params.source, params.sourceDetail);
    let idle = 0;
    let lastCount = 0;
    while (!this.stopped && this.seen.size < params.maxPosts && idle < 4) {
      await scrollBy(Math.round(window.innerHeight * (0.6 + Math.random() * 0.5)));
      await jitter(params.scrollPauseMs);
      this.scan();
      if (this.seen.size === lastCount) idle += atPageBottom() ? 2 : 1;
      else idle = 0;
      lastCount = this.seen.size;
    }
    this.stop();
    return this.seen.size;
  }

  private async collectFollowers(params: CollectParams): Promise<number> {
    const max = params.maxHandles ?? 40;
    const found = new Set<string>();
    let idle = 0;
    while (!this.stopped && found.size < max && idle < 4) {
      const before = found.size;
      for (const h of parseFollowers(document)) found.add(h);
      const dialog = document.querySelector('div[role="dialog"]');
      const scroller = dialog ? findScrollable(dialog) : null;
      if (scroller) scroller.scrollTop += Math.round(scroller.clientHeight * 0.8);
      else await scrollBy(Math.round(window.innerHeight * 0.8));
      await jitter(params.scrollPauseMs);
      idle = found.size === before ? idle + 1 : 0;
    }
    const handles = Array.from(found).slice(0, max);
    this.sink.handles(handles, params.sourceDetail ?? '');
    await sleep(200);
    return handles.length;
  }
}

function findScrollable(root: Element): HTMLElement | null {
  const all = Array.from(root.querySelectorAll<HTMLElement>('*'));
  return all.find((el) => el.scrollHeight > el.clientHeight + 40 && getComputedStyle(el).overflowY !== 'visible') ?? null;
}

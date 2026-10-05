import { upsertPosts } from '@/db/repo-posts';
import { upsertAuthor, upsertAuthorFromProfile } from '@/db/repo-authors';
import { addEvent } from '@/db/repo-events';
import { selfHandleItem } from '@/shared/settings';
import { log } from '@/shared/log';
import { onContentMessage } from './ports';
import { broadcast, setLastSelftest } from './state';
import type { ContentToSw } from '@/shared/messages';
import type { ObservedPost } from '@/shared/types';

// Приём данных из content-скрипта → запись в БД. Здесь нет решений «что делать» — только сохранение.

let anomalyHandler: ((m: Extract<ContentToSw, { type: 'ANOMALY' }>) => void) | null = null;
export function setAnomalyHandler(h: typeof anomalyHandler): void {
  anomalyHandler = h;
}

async function savePosts(posts: ObservedPost[]): Promise<void> {
  if (!posts.length) return;
  const r = await upsertPosts(posts);
  const byAuthor = new Map<string, ObservedPost>();
  for (const p of posts) if (!byAuthor.has(p.authorHandle)) byAuthor.set(p.authorHandle, p);
  for (const [handle, p] of byAuthor) {
    await upsertAuthor({
      handle,
      displayName: p.authorName,
      bio: p.authorBioSnapshot,
      followers: p.authorFollowersSnapshot,
    });
  }
  if (r.inserted) log('info', `posts: +${r.inserted} new, ${r.updated} updated`);
  broadcast('state');
}

export function initInbound(): void {
  onContentMessage((m) => {
    void handle(m).catch((e) => log('error', `inbound ${m.type} failed`, String(e)));
  });
}

async function handle(m: ContentToSw): Promise<void> {
  switch (m.type) {
    case 'PAGE_READY':
      if (m.selfHandle) {
        const current = await selfHandleItem.getValue();
        if (current !== m.selfHandle) {
          await selfHandleItem.setValue(m.selfHandle);
          if (current) {
            // смена аккаунта: разгон лимитов заново, серия неподтверждённых — с нуля
            const { patchSettings, engineStateItem } = await import('@/shared/settings');
            await patchSettings({ rampStartAt: Date.now() });
            const st = await engineStateItem.getValue();
            await engineStateItem.setValue({ ...st, unverifiedStreak: 0 });
            const { addEvent } = await import('@/db/repo-events');
            await addEvent({ at: Date.now(), kind: 'info', message: `аккаунт сменён: @${current} → @${m.selfHandle}, разгон лимитов заново` });
          }
          broadcast('state');
        }
      }
      return;
    case 'POSTS_OBSERVED':
      return savePosts(m.posts);
    case 'THREAD_OBSERVED':
      return savePosts([m.root, ...m.replies.map((r) => r.post)]);
    case 'PROFILE_OBSERVED':
      await upsertAuthorFromProfile(m.profile);
      broadcast('state');
      return;
    case 'HANDLES_OBSERVED':
      for (const h of m.handles) await upsertAuthor({ handle: h, tags: [`from:${m.sourceDetail}`] });
      broadcast('state');
      return;
    case 'SELFTEST_RESULT':
      setLastSelftest({ page: m.page, broken: m.broken, at: Date.now() });
      await addEvent({ at: Date.now(), kind: 'selftest', message: m.broken.length ? `сломаны: ${m.broken.join(', ')}` : 'ok', payload: m });
      broadcast('state');
      return;
    case 'ANOMALY':
      anomalyHandler?.(m);
      return;
    case 'COLLECT_DONE':
    case 'ACTION_RESULT':
    case 'PAGE_DUMP':
    case 'HEARTBEAT':
    case 'VERIFY_RESULT':
      return; // обрабатываются адресно через waitForMessage / пульс только держит SW живым
  }
}

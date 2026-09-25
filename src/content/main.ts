import { Bridge } from './bridge';
import { Collector, type CollectorSink } from './collector';
import { runSelfTest } from './selectors-selftest';
import { pageKind, handleFromHref } from './selectors';
import { detectSelfHandle } from './parsers/profile';
import { keywordFromUrl } from './parsers/search-page';
import { waitForPage } from './actions/navigate';
import { executeAction } from './actions/execute';
import { startAnomalyWatch } from './anomaly-watch';
import type { SwToContent } from '@/shared/messages';
import type { PostSource } from '@/shared/types';

// Оркестрация content-скрипта: подключить порт, объявить готовность, пассивно собирать всё видимое,
// выполнять команды SW (сбор, self-test, действия). Селекторов здесь нет.

export function startContent(): void {
  const bridge = new Bridge();
  const sink: CollectorSink = {
    posts: (posts) => bridge.send({ type: 'POSTS_OBSERVED', posts, pageUrl: location.href }),
    handles: (handles, sourceDetail) => bridge.send({ type: 'HANDLES_OBSERVED', handles, sourceDetail }),
    thread: (root, replies) => bridge.send({ type: 'THREAD_OBSERVED', root, replies }),
    profile: (p) => p && bridge.send({ type: 'PROFILE_OBSERVED', profile: p }),
  };
  const collector = new Collector(sink);
  let selfHandle: string | undefined;

  const announce = () => {
    selfHandle = detectSelfHandle() ?? selfHandle;
    bridge.send({ type: 'PAGE_READY', url: location.href, selfHandle });
    const st = runSelfTest(location.href);
    if (st.broken.length) bridge.send({ type: 'SELFTEST_RESULT', page: st.page, broken: st.broken });
    startPassive();
  };

  const startPassive = () => {
    const kind = pageKind(location.href);
    const [source, detail] = passiveSource(kind, location.href);
    if (source) collector.startPassive(source, detail);
  };

  bridge.onMessage((m: SwToContent) => void handleCommand(m).catch((e) => console.warn('[threads-agent] command failed', e)));

  async function handleCommand(m: SwToContent): Promise<void> {
    switch (m.type) {
      case 'NAVIGATE': {
        // SW уже перевёл вкладку через tabs.update; если URL совпадает — просто подтверждаем готовность
        await waitForPage(m.url).catch(() => undefined);
        announce();
        return;
      }
      case 'COLLECT': {
        collector.stop();
        const count = await collector.runJob(m.params, location.href);
        bridge.send({ type: 'COLLECT_DONE', mode: m.params.mode, count });
        startPassive();
        return;
      }
      case 'RUN_SELFTEST': {
        const st = runSelfTest(location.href);
        bridge.send({ type: 'SELFTEST_RESULT', page: st.page, broken: st.broken });
        return;
      }
      case 'EXECUTE_ACTION': {
        collector.stop();
        const r = await executeAction(m.action, m.selfHandle, m.likeBefore);
        bridge.send({ type: 'ACTION_RESULT', actionId: m.action.id, ...r });
        startPassive();
        return;
      }
    }
  }

  bridge.connect();
  startAnomalyWatch((anomaly) => bridge.send({ type: 'ANOMALY', anomaly }));

  // SPA-навигация: Threads меняет URL без перезагрузки — ловим и переобъявляемся
  let lastUrl = location.href;
  const checkUrl = () => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      collector.resetSeen();
      setTimeout(announce, 1200);
    }
  };
  setInterval(checkUrl, 700);
  window.addEventListener('popstate', checkUrl);

  // первая готовность — когда появится хоть одна ссылка на профиль (React отрисовал оболочку)
  const boot = () => {
    if (document.querySelector('a[href^="/@"]')) announce();
    else setTimeout(boot, 500);
  };
  boot();
}

function passiveSource(kind: ReturnType<typeof pageKind>, url: string): [PostSource | null, string | undefined] {
  switch (kind) {
    case 'feed':
      return ['feed', 'for-you'];
    case 'search':
      return ['keyword', keywordFromUrl(url)];
    case 'post':
      return ['thread', url];
    case 'profile':
      return ['feed', `profile:${handleFromHref(new URL(url).pathname) ?? ''}`];
    case 'activity':
      return ['activity', 'activity'];
    default:
      return [null, undefined];
  }
}

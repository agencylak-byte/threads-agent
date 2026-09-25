import { useEffect, useState } from 'preact/hooks';
import { CollectPanel } from './collect/CollectPanel';
import { Queue } from './approval/Queue';
import { Health } from './settings/Health';
import { Sources } from './settings/Sources';
import { Voice } from './settings/Voice';
import { Limits } from './settings/Limits';
import { error, initStore, proposed, state } from './store';

type Tab = 'queue' | 'collect' | 'voice' | 'sources' | 'limits' | 'health';

const TABS: Array<[Tab, string]> = [
  ['queue', 'Очередь'],
  ['collect', 'Сбор'],
  ['voice', 'Голос'],
  ['sources', 'Источники'],
  ['limits', 'Лимиты'],
  ['health', 'Здоровье'],
];

export function App() {
  const [tab, setTab] = useState<Tab>(() => {
    try {
      return (localStorage.getItem('tab') as Tab) || 'queue';
    } catch {
      return 'queue';
    }
  });
  useEffect(() => {
    initStore();
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem('tab', tab);
    } catch {
      /* приватное окно */
    }
  }, [tab]);

  const engine = state.value?.engine;
  const queueCount = proposed.value.filter((a) => a.status === 'proposed').length;

  return (
    <div>
      <h1>Threads-агент LAK</h1>
      {error.value && <div class="banner err">{error.value}</div>}
      {engine?.status === 'paused' && (
        <div class="banner err">Движок на паузе: {engine.pauseReason ?? 'аномалия'}. Проверьте вкладку threads.com, затем снимите паузу в «Здоровье».</div>
      )}
      <div class="tabs">
        {TABS.map(([id, name]) => (
          <button key={id} class={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {name}{id === 'queue' && queueCount ? ` (${queueCount})` : ''}
          </button>
        ))}
      </div>
      {tab === 'queue' && <Queue />}
      {tab === 'collect' && <CollectPanel />}
      {tab === 'voice' && <Voice />}
      {tab === 'sources' && <Sources />}
      {tab === 'limits' && <Limits />}
      {tab === 'health' && <Health />}
    </div>
  );
}

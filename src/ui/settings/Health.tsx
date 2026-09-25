import { useState } from 'preact/hooks';
import { request } from '@/shared/messages';
import { call, state } from '../store';

// Здоровье: движок, аномалии, self-test селекторов, расход на LLM.

export function Health() {
  const s = state.value;
  const [selftest, setSelftest] = useState<{ ok: boolean; broken?: string[]; error?: string } | null>(null);
  const engine = s?.engine;

  return (
    <div>
      <div class="card">
        <div><b>Движок:</b> {label(engine?.status)}{engine?.pauseReason ? ` — ${engine.pauseReason}` : ''}</div>
        {engine?.pausedUntil && <div class="small muted">Пауза до {new Date(engine.pausedUntil).toLocaleString('ru-RU')}</div>}
        <div class="row" style="margin-top:8px">
          {engine?.status === 'running' ? (
            <button onClick={() => call(() => request('ENGINE', { command: 'stop' }))}>Остановить</button>
          ) : (
            <button class="primary" onClick={() => call(() => request('ENGINE', { command: engine?.status === 'paused' ? 'resume' : 'start' }))}>
              {engine?.status === 'paused' ? 'Снять паузу' : 'Запустить'}
            </button>
          )}
        </div>
        <p class="small muted">В режиме «предложить» движок только классифицирует посты и готовит черновики. Отправка — по вашему клику в очереди.</p>
      </div>

      <div class="card">
        <div><b>Селекторы Threads</b></div>
        <div class="small muted">
          Последняя проверка:{' '}
          {s?.lastSelftest
            ? `${s.lastSelftest.page} — ${s.lastSelftest.broken.length ? 'сломаны: ' + s.lastSelftest.broken.join(', ') : 'ок'} (${new Date(s.lastSelftest.at).toLocaleTimeString('ru-RU')})`
            : 'ещё не было'}
        </div>
        <div class="row" style="margin-top:8px">
          <button onClick={async () => setSelftest((await call(() => request('RUN_SELFTEST', {}))) ?? null)}>Проверить сейчас</button>
        </div>
        {selftest && (
          <div class={`banner ${selftest.ok ? 'ok' : 'err'}`} style="margin-top:8px">
            {selftest.error ?? (selftest.ok ? 'Все обязательные селекторы найдены' : `Не найдены: ${selftest.broken?.join(', ')}`)}
          </div>
        )}
      </div>

      <div class="card">
        <div><b>OpenRouter</b></div>
        <div class="small muted">Ключ: {s?.hasApiKey ? 'задан' : 'не задан — откройте настройки расширения'} · Расход сегодня: ${(s?.todayCost ?? 0).toFixed(4)}</div>
        <div class="small muted">Профиль голоса: {s?.profileVersion ? `v${s.profileVersion}` : 'seed (посты ещё не изучены)'}</div>
        <div class="row" style="margin-top:8px">
          <button onClick={() => browser.runtime.openOptionsPage()}>Открыть настройки ключа</button>
        </div>
      </div>
    </div>
  );
}

function label(st?: string): string {
  switch (st) {
    case 'running':
      return 'работает';
    case 'paused':
      return 'на паузе';
    case 'sleeping':
      return 'вне рабочих часов';
    default:
      return 'остановлен';
  }
}

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
        <div class="row" style="margin-top:8px">
          <button onClick={() => call(() => request('OPEN_WORK_WINDOW', {}))}>Открыть рабочее окно</button>
          <button onClick={() => call(() => request('CLOSE_WORK_WINDOWS', {}))}>Закрыть рабочие окна</button>
        </div>
        <p class="small muted">Расширение работает в отдельном окне Chrome с вкладкой threads.com. Ваши вкладки оно не трогает. Окно не сворачивайте.</p>
      </div>

      {s && (
        <div class="card">
          <div><b>Воронка отбора</b> <span class="small muted">(без своих постов)</span></div>
          <table class="small" style="margin-top:6px;border-spacing:0 2px">
            <tr><td>Собрано постов</td><td style="padding-left:12px"><b>{s.funnel.unclassified + s.funnel.classified}</b></td></tr>
            <tr><td>Ждут оценки</td><td style="padding-left:12px">{s.funnel.unclassified}</td></tr>
            <tr><td>Оценено</td><td style="padding-left:12px">{s.funnel.classified}</td></tr>
            <tr><td>Балл «стоит комментировать» выше порога</td><td style="padding-left:12px">{s.funnel.lprPass}</td></tr>
            <tr><td>…и не старше недели (кандидаты)</td><td style="padding-left:12px"><b>{s.funnel.candidates}</b></td></tr>
            <tr><td>Уже прокомментировано</td><td style="padding-left:12px">{s.funnel.commented}</td></tr>
          </table>
          <p class="small muted" style="margin:6px 0 0">
            {s.funnel.unclassified > 0
              ? 'Оценка идёт по 30 постов в минуту, пока движок работает.'
              : s.funnel.candidates === 0
                ? 'Кандидатов нет: соберите новые посты по ключевым словам или понизьте пороги в «Источниках».'
                : 'Кандидаты есть — черновики появятся в очереди в ближайшие минуты.'}
          </p>
        </div>
      )}

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
          <button
            onClick={async () => {
              const r = await call(() => request('DUMP_PAGE', {}));
              setSelftest(r ? { ok: r.ok, error: r.ok ? `Снимок сохранён: Загрузки/${r.filename}` : r.error } : null);
            }}
          >
            Снимок страницы для разработчика
          </button>
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

import { useState } from 'preact/hooks';
import { request } from '@/shared/messages';
import { call, settings, state } from '../store';
import type { ExportStore } from '@/db/columns';

// Сбор базы: запуск джобов (ключ / конкурент / лента / свои посты), счётчики, экспорт CSV.

export function CollectPanel() {
  const [kw, setKw] = useState('');
  const [comp, setComp] = useState('');
  const s = state.value;
  const job = s?.currentJob ?? null;
  const busy = job !== null;

  const start = (kind: Parameters<typeof request<'START_JOB'>>[1]['kind'], param?: string) =>
    call(() => request('START_JOB', { kind, param }));

  return (
    <div>
      <div class="card">
        <div class="row">
          <span class="stat"><b>{s?.counts.posts ?? '–'}</b><span class="muted small">постов</span></span>
          <span class="stat"><b>{s?.counts.authors ?? '–'}</b><span class="muted small">авторов</span></span>
          <span class="stat"><b>{s?.counts.proposed ?? '–'}</b><span class="muted small">в очереди</span></span>
          <span class="stat"><b>{s?.counts.done ?? '–'}</b><span class="muted small">сделано</span></span>
        </div>
        <div class="small muted" style="margin-top:6px">
          Аккаунт: {s?.selfHandle ? `@${s.selfHandle}` : 'не определён — откройте threads.com'}
        </div>
      </div>

      {busy && (
        <div class="banner warn">
          Идёт сбор: {job?.kind}{job?.param ? ` «${job.param}»` : ''}…{' '}
          <button onClick={() => call(() => request('STOP_JOB', {}))}>Остановить</button>
        </div>
      )}

      <h2>По ключевому слову</h2>
      <div class="row">
        <input list="kw-list" value={kw} onInput={(e) => setKw((e.target as HTMLInputElement).value)} placeholder="например: нет заявок" />
        <datalist id="kw-list">{(settings.value?.keywords ?? []).map((k) => <option value={k} key={k} />)}</datalist>
        <button class="primary" disabled={busy || !kw.trim()} onClick={() => start('collect-keyword', kw.trim())}>Собрать</button>
      </div>
      <div class="row small" style="margin-top:6px">
        {(settings.value?.keywords ?? []).slice(0, 8).map((k) => (
          <button key={k} disabled={busy} onClick={() => start('collect-keyword', k)}>{k}</button>
        ))}
      </div>

      <h2>Аудитория конкурента</h2>
      <div class="row">
        <input list="comp-list" value={comp} onInput={(e) => setComp((e.target as HTMLInputElement).value)} placeholder="handle без @" />
        <datalist id="comp-list">{(settings.value?.competitors ?? []).map((c) => <option value={c} key={c} />)}</datalist>
        <button class="primary" disabled={busy || !comp.trim()} onClick={() => start('collect-competitor', comp.trim())}>Обойти</button>
      </div>
      <p class="small muted">Соберёт до {settings.value?.competitorFollowersPerRun ?? 40} подписчиков и посмотрит профили и посты у первых 12 новых.</p>

      <h2>Другое</h2>
      <div class="row">
        <button disabled={busy} onClick={() => start('collect-feed')}>Лента «Для вас»</button>
        <button disabled={busy} onClick={() => start('collect-self')}>Мои посты</button>
        <button disabled={busy} onClick={() => start('collect-activity')}>Активность</button>
      </div>

      <h2>Экспорт CSV</h2>
      <div class="row">
        {(['posts', 'authors', 'actions', 'events', 'metrics_daily'] as ExportStore[]).map((st) => (
          <button key={st} onClick={() => call(() => request('EXPORT_CSV', { store: st }))}>{st}</button>
        ))}
      </div>
      <p class="small muted">Файлы попадают в Загрузки/threads-agent/. Колонки те же, что будут в Google Sheets.</p>
    </div>
  );
}

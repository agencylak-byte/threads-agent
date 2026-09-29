import { useState } from 'preact/hooks';
import { request } from '@/shared/messages';
import { call, finished, proposed, refreshActions, state } from '../store';
import { ActionCard } from './ActionCard';
import { ACTION_TYPE_LABELS } from '@/shared/constants';

// Очередь одобрения: предложенные черновики → approve / edit / skip / regenerate. Плюс генерация постов.

export function Queue() {
  const items = proposed.value;
  const waiting = items.filter((a) => a.status === 'proposed');
  const inFlight = items.filter((a) => a.status !== 'proposed');
  return (
    <div>
      <PostGenerator />
{!items.length && <EmptyState />}
      {waiting.map((a) => <ActionCard key={a.id} action={a} />)}
      {inFlight.length > 0 && (
        <details open>
          <summary class="small muted">Одобрено и ждёт отправки: {inFlight.length}</summary>
          {inFlight.map((a) => <ActionCard key={a.id} action={a} compact />)}
        </details>
      )}
      {finished.value.length > 0 && (
        <details open>
          <summary class="small muted">Отправлено и ошибки: {finished.value.length}</summary>
          {finished.value.map((a) => (
            <div key={a.id} class="card small">
              <div>
                <b>{a.status === 'done' ? (a.verifiedAt ? '✓ отправлено' : '✓ отправлено (не подтверждено)') : '✗ ошибка'}</b>
                {' · '}{ACTION_TYPE_LABELS[a.type]} · @{a.targetHandle}
                {a.executedAt && <span class="muted"> · {new Date(a.executedAt).toLocaleString('ru-RU')}</span>}
                {a.threadUrl && <> · <a href={a.threadUrl} target="_blank" rel="noreferrer">открыть пост</a></>}
              </div>
              <div style="white-space:pre-wrap;margin-top:4px">{a.finalText ?? a.draftText}</div>
              {a.error && <div class="muted" style="margin-top:4px">{a.error}</div>}
              {a.status === 'failed' && (
                <div class="row" style="margin-top:6px">
                  <button onClick={async () => { await call(() => request('RETRY_ACTION', { actionId: a.id })); await refreshActions(); }}>Повторить</button>
                </div>
              )}
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

function EmptyState() {
  const s = state.value;
  if (!s) return <div class="muted">Загрузка…</div>;
  const f = s.funnel;
  const engineOff = s.engine.status === 'stopped';
  const busy = s.currentJob !== null;
  let hint: string;
  if (!s.hasApiKey) hint = 'Не задан ключ OpenRouter — «Здоровье» → «Открыть настройки ключа».';
  else if (engineOff) hint = 'Движок остановлен — «Здоровье» → «Запустить».';
  else if (f.unclassified > 0) hint = `Оцениваю посты: осталось ${f.unclassified}. Черновики появятся через несколько минут.`;
  else if (f.candidates === 0) hint = 'Свежих постов выше порога нет. Нажмите «Собрать свежее по всем ключам» — соберу недавние посты и оценю.';
  else hint = 'Кандидаты есть — пишу черновики, обновите через минуту.';
  return (
    <div class="card">
      <div class="muted">Очередь пуста.</div>
      <div class="small" style="margin-top:6px">
        Собрано {f.unclassified + f.classified} · оценено {f.classified} · выше порога {f.lprPass} · свежих кандидатов <b>{f.candidates}</b>
      </div>
      <div class="small" style="margin-top:6px">{hint}</div>
      {!engineOff && s.hasApiKey && f.unclassified === 0 && f.candidates === 0 && (
        <div class="row" style="margin-top:8px">
          <button class="primary" disabled={busy} onClick={() => call(() => request('START_JOB', { kind: 'collect-all-keywords' }))}>
            Собрать свежее по всем ключам
          </button>
        </div>
      )}
    </div>
  );
}

function PostGenerator() {
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setMsg('Пишу 3 варианта…');
    const r = await call(() => request('GENERATE_POST', { topic: topic.trim() || undefined }));
    setMsg(r?.ok ? 'Готово — варианты ниже в очереди' : r?.error ?? 'Ошибка');
    await refreshActions();
    setBusy(false);
  };
  return (
    <details class="card">
      <summary>Написать пост</summary>
      <div class="row" style="margin-top:8px">
        <input value={topic} placeholder="тема или повод (пусто — на выбор модели)" onInput={(e) => setTopic((e.target as HTMLInputElement).value)} />
        <button class="primary" disabled={busy || !state.value?.hasApiKey} onClick={run}>3 варианта</button>
      </div>
      {msg && <div class="small muted" style="margin-top:6px">{msg}</div>}
    </details>
  );
}

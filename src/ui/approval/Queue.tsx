import { useState } from 'preact/hooks';
import { request } from '@/shared/messages';
import { call, proposed, refreshActions, state } from '../store';
import { ActionCard } from './ActionCard';

// Очередь одобрения: предложенные черновики → approve / edit / skip / regenerate. Плюс генерация постов.

export function Queue() {
  const items = proposed.value;
  const waiting = items.filter((a) => a.status === 'proposed');
  const inFlight = items.filter((a) => a.status !== 'proposed');
  return (
    <div>
      <PostGenerator />
      {!items.length && (
        <div class="muted">
          Очередь пуста. Соберите посты во вкладке «Сбор», задайте ключ OpenRouter и запустите движок в «Здоровье» — он классифицирует авторов и предложит комментарии.
        </div>
      )}
      {waiting.map((a) => <ActionCard key={a.id} action={a} />)}
      {inFlight.length > 0 && (
        <details>
          <summary class="small muted">Одобрено и ждёт отправки: {inFlight.length}</summary>
          {inFlight.map((a) => <ActionCard key={a.id} action={a} compact />)}
        </details>
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

import { useEffect, useState } from 'preact/hooks';
import { request } from '@/shared/messages';
import { call } from '../store';

// Выбор постов, по которым снимать голос: галочки на собранных постах + свои тексты вручную.

export function VoiceSamples({ onDone }: { onDone: (msg: string) => void }) {
  const [handle, setHandle] = useState('');
  const [posts, setPosts] = useState<Array<{ id: string; text: string; postedAt?: number }>>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    const r = await call(() => request('LIST_VOICE_SAMPLES', {}));
    if (!r) return;
    setHandle(r.handle);
    setPosts(r.posts);
    setChecked(new Set(r.posts.map((p) => p.id)));
    setLoaded(true);
  };
  useEffect(() => {
    void load();
  }, []);

  const toggle = (id: string) => {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChecked(next);
  };

  const learn = async () => {
    setBusy(true);
    onDone('Снимаю голос по выбранным…');
    const extraTexts = extra.split(/\n\s*\n|\n---+\n/).map((t) => t.trim()).filter(Boolean);
    const r = await call(() => request('LEARN_VOICE', { postIds: Array.from(checked), extraTexts, skipCollect: true }));
    onDone(r?.ok ? `Готово: голос снят с ${r.samplesCount} текстов` : `Не получилось: ${r?.error ?? 'неизвестная ошибка'}`);
    setBusy(false);
  };

  const total = checked.size + extra.split(/\n\s*\n|\n---+\n/).filter((t) => t.trim().length > 30).length;

  return (
    <div class="card">
      <div class="row">
        <b>Посты для снятия голоса</b>
        <span class="small muted">{handle ? `@${handle}` : ''} · собрано {posts.length}</span>
        <button onClick={load}>Обновить список</button>
      </div>
      {loaded && !posts.length && <div class="small muted" style="margin-top:6px">Постов пока нет — сначала нажмите «Изучить мой голос», чтобы расширение их собрало.</div>}
      {posts.length > 0 && (
        <>
          <div class="row small" style="margin:8px 0">
            <button onClick={() => setChecked(new Set(posts.map((p) => p.id)))}>Выбрать все</button>
            <button onClick={() => setChecked(new Set())}>Снять все</button>
            <span class="muted">выбрано {checked.size}</span>
          </div>
          <div style="max-height:320px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:6px">
            {posts.map((p) => (
              <label key={p.id} class="row small" style="font-weight:normal;align-items:flex-start;margin:4px 0;cursor:pointer">
                <input type="checkbox" style="width:auto;margin-top:3px" checked={checked.has(p.id)} onChange={() => toggle(p.id)} />
                <span style="flex:1">
                  {p.postedAt && <span class="muted">{new Date(p.postedAt).toLocaleDateString('ru-RU')} · </span>}
                  {p.text.slice(0, 160)}{p.text.length > 160 ? '…' : ''}
                </span>
              </label>
            ))}
          </div>
        </>
      )}
      <label>Свои тексты вручную (каждый текст отделяйте пустой строкой)</label>
      <textarea rows={5} value={extra} placeholder="Вставьте сюда посты, которые точно ваши…" onInput={(e) => setExtra((e.target as HTMLTextAreaElement).value)} />
      <div class="row" style="margin-top:8px">
        <button class="primary" disabled={busy || total < 5} onClick={learn}>Снять голос по выбранным ({total})</button>
        {total < 5 && <span class="small muted">нужно хотя бы 5 текстов</span>}
      </div>
    </div>
  );
}

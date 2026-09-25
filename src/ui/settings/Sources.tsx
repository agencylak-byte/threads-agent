import { useEffect, useState } from 'preact/hooks';
import { request } from '@/shared/messages';
import { call, settings } from '../store';

// Источники ЦА: ключевые слова и конкуренты. Списки — по строке на значение.

export function Sources() {
  const s = settings.value;
  const [kw, setKw] = useState('');
  const [comp, setComp] = useState('');
  const [max, setMax] = useState(60);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!s) return;
    setKw(s.keywords.join('\n'));
    setComp(s.competitors.join('\n'));
    setMax(s.collectMaxPosts);
  }, [s]);

  const save = async () => {
    const lines = (v: string) => v.split('\n').map((x) => x.trim().replace(/^@/, '')).filter(Boolean);
    await call(() => request('SET_SETTINGS', { patch: { keywords: lines(kw), competitors: lines(comp), collectMaxPosts: max } }));
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  if (!s) return <div class="muted">Загрузка…</div>;
  return (
    <div>
      <label>Ключевые слова для поиска</label>
      <textarea rows={8} value={kw} onInput={(e) => setKw((e.target as HTMLTextAreaElement).value)} />
      <label>Конкуренты (handle без @)</label>
      <textarea rows={6} value={comp} onInput={(e) => setComp((e.target as HTMLTextAreaElement).value)} />
      <label>Максимум постов за один сбор</label>
      <input type="number" min={5} max={500} value={max} onInput={(e) => setMax(Number((e.target as HTMLInputElement).value))} />
      <div class="row" style="margin-top:10px">
        <button class="primary" onClick={save}>Сохранить</button>
        {saved && <span class="small muted">сохранено</span>}
      </div>
    </div>
  );
}

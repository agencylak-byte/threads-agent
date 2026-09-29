import { useEffect, useState } from 'preact/hooks';
import { request } from '@/shared/messages';
import { call, settings } from '../store';

// Источники ЦА: ключевые слова и конкуренты. Списки — по строке на значение.

export function Sources() {
  const s = settings.value;
  const [kw, setKw] = useState('');
  const [comp, setComp] = useState('');
  const [max, setMax] = useState(60);
  const [lpr, setLpr] = useState(50);
  const [rel, setRel] = useState(40);
  const [cm, setCm] = useState(70);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!s) return;
    setKw(s.keywords.join('\n'));
    setComp(s.competitors.join('\n'));
    setMax(s.collectMaxPosts);
    setLpr(s.lprMinScore);
    setRel(s.relevanceMin);
    setCm(s.commentMin);
  }, [s]);

  const save = async () => {
    const lines = (v: string) => v.split('\n').map((x) => x.trim().replace(/^@/, '')).filter(Boolean);
    await call(() =>
      request('SET_SETTINGS', {
        patch: { keywords: lines(kw), competitors: lines(comp), collectMaxPosts: max, lprMinScore: lpr, relevanceMin: rel, commentMin: cm },
      }),
    );
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
      <h2>Отбор постов для комментариев</h2>
      <label>Балл «стоит комментировать» (0 — точно нет, 100 — точно да), минимум: {cm}</label>
      <input type="range" min={0} max={100} step={5} value={cm} onInput={(e) => setCm(Number((e.target as HTMLInputElement).value))} />
      <p class="small muted">Главный порог. Модель ставит балл каждому посту после сбора; ниже порога — не предлагаем. Много мусора — поднимите до 80.</p>
      <details>
        <summary class="small muted">Вспомогательные пороги</summary>
        <label>Автор похож на клиента, минимум: {lpr}</label>
        <input type="range" min={0} max={100} step={5} value={lpr} onInput={(e) => setLpr(Number((e.target as HTMLInputElement).value))} />
        <label>Пост по нашей теме, минимум: {rel}</label>
        <input type="range" min={0} max={100} step={5} value={rel} onInput={(e) => setRel(Number((e.target as HTMLInputElement).value))} />
      </details>
      <div class="row" style="margin-top:10px">
        <button class="primary" onClick={save}>Сохранить</button>
        {saved && <span class="small muted">сохранено</span>}
      </div>
    </div>
  );
}

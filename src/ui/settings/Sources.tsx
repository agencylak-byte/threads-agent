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
  const [screens, setScreens] = useState(5);
  const [autoMin, setAutoMin] = useState(80);
  const [topics, setTopics] = useState('');
  const [postsPerDay, setPostsPerDay] = useState(1);
  const [autoCollect, setAutoCollect] = useState(180);
  const [perRun, setPerRun] = useState(3);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!s) return;
    setKw(s.keywords.join('\n'));
    setComp(s.competitors.join('\n'));
    setMax(s.collectMaxPosts);
    setLpr(s.lprMinScore);
    setRel(s.relevanceMin);
    setCm(s.commentMin);
    setScreens(s.collectScreens);
    setPerRun(s.collectKeywordsPerRun);
    setAutoMin(s.autoCommentMin);
    setAutoCollect(s.autoCollectIntervalMin);
    setTopics(s.postTopics.join('\n'));
    setPostsPerDay(s.autoPostsPerDay);
  }, [s]);

  const save = async () => {
    const lines = (v: string) => v.split('\n').map((x) => x.trim().replace(/^@/, '')).filter(Boolean);
    await call(() =>
      request('SET_SETTINGS', {
        patch: {
          keywords: lines(kw),
          competitors: lines(comp),
          collectMaxPosts: max,
          lprMinScore: lpr,
          relevanceMin: rel,
          commentMin: cm,
          collectScreens: screens,
          collectKeywordsPerRun: perRun,
          autoCommentMin: autoMin,
          autoCollectIntervalMin: autoCollect,
          postTopics: lines(topics),
          autoPostsPerDay: postsPerDay,
        },
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
      <div class="row">
        <div style="flex:1">
          <label>Экранов на ключ</label>
          <input type="number" min={1} max={30} value={screens} onInput={(e) => setScreens(Number((e.target as HTMLInputElement).value))} />
        </div>
        <div style="flex:1">
          <label>Ключей за прогон</label>
          <input type="number" min={1} max={12} value={perRun} onInput={(e) => setPerRun(Number((e.target as HTMLInputElement).value))} />
        </div>
      </div>
      <p class="small muted">«Собрать свежее по всем ключам» берёт следующие {perRun} ключа по кругу и листает по {screens} экранов на каждый.</p>
      <label>Автосбор по ключам каждые N минут (0 — только вручную)</label>
      <input type="number" min={0} max={1440} value={autoCollect} onInput={(e) => setAutoCollect(Number((e.target as HTMLInputElement).value))} />
      <label>Максимум постов за один сбор</label>
      <input type="number" min={5} max={500} value={max} onInput={(e) => setMax(Number((e.target as HTMLInputElement).value))} />
      <h2>Автопостинг</h2>
      <label>Постов в день (0 — выключить)</label>
      <input type="number" min={0} max={5} value={postsPerDay} onInput={(e) => setPostsPerDay(Number((e.target as HTMLInputElement).value))} />
      <label>Темы по кругу (каждая с новой строки)</label>
      <textarea rows={8} value={topics} onInput={(e) => setTopics((e.target as HTMLTextAreaElement).value)} />
      <p class="small muted">Расширение берёт следующую тему, пишет пост в вашем голосе и публикует само, если «Публикация поста» в «Лимитах» стоит в автопилоте.</p>

      <h2>Отбор постов для комментариев</h2>
      <label>Балл «стоит комментировать» (0 — точно нет, 100 — точно да), минимум: {cm}</label>
      <input type="range" min={0} max={100} step={5} value={cm} onInput={(e) => setCm(Number((e.target as HTMLInputElement).value))} />
      <p class="small muted">Главный порог. Модель ставит балл каждому посту после сбора; ниже порога — не предлагаем. Много мусора — поднимите до 80.</p>
      <label>В автопилоте отправлять только с баллом от: {autoMin}</label>
      <input type="range" min={0} max={100} step={5} value={autoMin} onInput={(e) => setAutoMin(Number((e.target as HTMLInputElement).value))} />
      <p class="small muted">Строже основного порога: когда никто не проверяет, лучше пропустить спорное.</p>
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

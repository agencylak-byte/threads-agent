import { useEffect, useState } from 'preact/hooks';
import { request } from '@/shared/messages';
import { QUESTIONS, optionLabel, parseAnswers } from '@/profile/questionnaire';
import { toPromptBlock } from '@/profile/voice-profile';
import { call, profile, questionnaire, settings, state } from '../store';
import { VoiceSamples } from './VoiceSamples';

// Голос: анкета + «Изучить мой голос» (собрать свои посты → извлечь голос моделью) + просмотр профиля.

export function Voice() {
  const p = profile.value;
  const [raw, setRaw] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showBlock, setShowBlock] = useState(false);
  const [source, setSource] = useState('');
  useEffect(() => {
    setSource(settings.value?.voiceSourceHandle ?? '');
  }, [settings.value]);

  useEffect(() => {
    const q = questionnaire.value ?? {};
    const init: Record<string, string> = {};
    for (const question of QUESTIONS) {
      const v = (q as Record<string, unknown>)[question.id];
      init[question.id] = Array.isArray(v) ? v.join('\n') : typeof v === 'string' ? v : '';
    }
    setRaw(init);
  }, [questionnaire.value]);

  const save = async () => {
    const answers = parseAnswers(raw);
    await call(() => request('SAVE_QUESTIONNAIRE', { answers }));
    setMsg('Анкета сохранена, профиль пересобран');
    setTimeout(() => setMsg(null), 2000);
  };

  const learn = async () => {
    setBusy(true);
    const handle = source.replace(/^@/, '').trim();
    await call(() => request('SET_SETTINGS', { patch: { voiceSourceHandle: handle } }));
    setMsg(`Собираю посты ${handle ? '@' + handle : 'вашего аккаунта'} и снимаю голос — это 1–2 минуты…`);
    const r = await call(() => request('LEARN_VOICE', {}));
    setBusy(false);
    setMsg(r?.ok ? `Готово: голос снят с ${r.samplesCount} постов. Ниже можно выбрать, какие посты учитывать, и снять заново.` : `Не получилось: ${r?.error ?? 'неизвестная ошибка'}`);
    setSamplesKey((k) => k + 1);
  };
  const [samplesKey, setSamplesKey] = useState(0);

  return (
    <div>
      <div class="card">
        <div><b>Профиль голоса</b> {p ? `v${p.version}` : ''} <span class="small muted">· источники: seed {p?.sources.seedVersion}{p?.sources.extractedAt ? `, посты (${p.sources.samplesCount})` : ''}{p?.sources.questionnaireAt ? ', анкета' : ''}</span></div>
        <label>Откуда брать посты (handle без @; пусто — текущий аккаунт)</label>
        <input value={source} placeholder="например: lera.gashenko" onInput={(e) => setSource((e.target as HTMLInputElement).value)} />
        <div class="row" style="margin-top:8px">
          <button class="primary" disabled={busy || !state.value?.hasApiKey} onClick={learn}>Изучить мой голос по постам</button>
          <button onClick={() => setShowBlock(!showBlock)}>{showBlock ? 'Скрыть' : 'Показать'} как видит модель</button>
        </div>
        {!state.value?.hasApiKey && <div class="small muted">Сначала задайте ключ OpenRouter в настройках расширения.</div>}
        {msg && <div class="banner ok" style="margin-top:8px">{msg}</div>}
        {showBlock && p && <pre class="small" style="white-space:pre-wrap;margin-top:8px">{toPromptBlock(p)}</pre>}
      </div>

      <VoiceSamples key={samplesKey} onDone={setMsg} />

      <h2>Анкета</h2>
      {QUESTIONS.map((q) => (
        <div key={q.id}>
          <label>{q.text}</label>
          {q.type === 'choice' ? (
            <select value={raw[q.id] ?? ''} onChange={(e) => setRaw({ ...raw, [q.id]: (e.target as HTMLSelectElement).value })}>
              <option value="">— по умолчанию —</option>
              {q.options?.map((o) => <option key={o} value={o}>{optionLabel(q, o)}</option>)}
            </select>
          ) : q.type === 'text' ? (
            <input value={raw[q.id] ?? ''} placeholder={q.hint} onInput={(e) => setRaw({ ...raw, [q.id]: (e.target as HTMLInputElement).value })} />
          ) : (
            <textarea rows={3} value={raw[q.id] ?? ''} placeholder={q.hint} onInput={(e) => setRaw({ ...raw, [q.id]: (e.target as HTMLTextAreaElement).value })} />
          )}
        </div>
      ))}
      <div class="row" style="margin-top:10px">
        <button class="primary" onClick={save}>Сохранить анкету</button>
      </div>
    </div>
  );
}

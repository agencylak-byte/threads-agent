import { useEffect, useState } from 'preact/hooks';
import { request } from '@/shared/messages';
import { DEFAULT_MODEL } from '@/shared/constants';

// Страница настроек расширения: ключ OpenRouter и модель. Ключ хранится только в chrome.storage.local.

export function OptionsApp() {
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [fallback, setFallback] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void request('GET_SETTINGS', {}).then((r) => {
      setHasKey(r.hasApiKey);
      setModel(r.settings.model);
      setFallback(r.settings.fallbackModel);
    });
  }, []);

  const save = async () => {
    await request('SET_SETTINGS', { patch: { model: model.trim(), fallbackModel: fallback.trim() }, apiKey: apiKey || undefined });
    if (apiKey) {
      setHasKey(true);
      setApiKey('');
    }
    setMsg({ ok: true, text: 'Сохранено' });
  };

  const verify = async () => {
    setMsg({ ok: true, text: 'Проверяю…' });
    const r = await request('VERIFY_MODEL', {});
    setMsg(r.ok ? { ok: true, text: `Модель доступна: ${r.model}` } : { ok: false, text: r.error ?? 'Ошибка' });
  };

  return (
    <div style="max-width:560px">
      <h1>Threads-агент LAK — настройки</h1>
      <label>Ключ OpenRouter {hasKey && <span class="small muted">(задан — введите новый, чтобы заменить)</span>}</label>
      <input type="password" value={apiKey} placeholder="sk-or-v1-…" onInput={(e) => setApiKey((e.target as HTMLInputElement).value)} />
      <p class="small muted">Ключ хранится только в этом браузере (chrome.storage.local) и никуда, кроме openrouter.ai, не отправляется.</p>
      <label>Модель</label>
      <input value={model} onInput={(e) => setModel((e.target as HTMLInputElement).value)} />
      <label>Запасная модель (если основная недоступна)</label>
      <input value={fallback} placeholder="например: google/gemini-2.5-flash" onInput={(e) => setFallback((e.target as HTMLInputElement).value)} />
      <div class="row" style="margin-top:12px">
        <button class="primary" onClick={save}>Сохранить</button>
        <button onClick={verify} disabled={!hasKey && !apiKey}>Проверить модель</button>
      </div>
      {msg && <div class={`banner ${msg.ok ? 'ok' : 'err'}`} style="margin-top:10px">{msg.text}</div>}
      <h2>Как пользоваться</h2>
      <ol class="small">
        <li>Откройте threads.com и войдите в аккаунт.</li>
        <li>Нажмите иконку расширения — откроется боковая панель.</li>
        <li>Вкладка «Сбор»: соберите посты по ключевым словам или по аудитории конкурента.</li>
        <li>Вкладка «Голос»: нажмите «Изучить мой голос», заполните анкету.</li>
        <li>Вкладка «Здоровье»: запустите движок. Черновики появятся в «Очереди».</li>
      </ol>
    </div>
  );
}

import type { UiRequest, UiRequests, UiRequestType } from '@/shared/messages';
import { apiKeyItem, autonomyItem, engineStateItem, getSettings, patchSettings, questionnaireItem, voiceProfileItem } from '@/shared/settings';
import { listActionsByStatus, updateAction } from '@/db/repo-actions';
import { downloadCsv } from '@/db/export-csv';
import { SEED_PROFILE } from '@/profile/seed-profile';
import { mergeProfile } from '@/profile/voice-profile';
import { buildSnapshot, broadcast } from './state';
import { isJobRunning, requestStop, runJob } from './jobs';
import { getWorkTab } from './tabs';
import { sendToTab, waitForMessage } from './ports';
import type { ContentToSw } from '@/shared/messages';

// Обработчики запросов UI → SW. Каждый — маленькая функция; логика живёт в engine/db/llm.
// Часть обработчиков (LLM, очередь, движок) регистрируется из фаз 2–3 через registerHandler().

type Handler<K extends UiRequestType> = (req: UiRequests[K]['req']) => Promise<UiRequests[K]['res']>;
const handlers: Partial<{ [K in UiRequestType]: Handler<K> }> = {};

export function registerHandler<K extends UiRequestType>(type: K, h: Handler<K>): void {
  handlers[type] = h as never;
}

export async function dispatchUiRequest(msg: UiRequest): Promise<unknown> {
  const h = handlers[msg.type] as Handler<UiRequestType> | undefined;
  if (!h) return { __error: `Нет обработчика для ${msg.type}` };
  try {
    const { type: _t, ...req } = msg;
    return await h(req as never);
  } catch (e) {
    return { __error: e instanceof Error ? e.message : String(e) };
  }
}

const isSelftest = (m: ContentToSw): m is Extract<ContentToSw, { type: 'SELFTEST_RESULT' }> => m.type === 'SELFTEST_RESULT';

export function registerBaseHandlers(): void {
  registerHandler('GET_STATE', () => buildSnapshot());

  registerHandler('LIST_ACTIONS', ({ status, limit }) => listActionsByStatus(status, limit));

  registerHandler('GET_SETTINGS', async () => ({ settings: await getSettings(), hasApiKey: (await apiKeyItem.getValue()).length > 0 }));

  registerHandler('SET_SETTINGS', async ({ patch, apiKey }) => {
    if (apiKey !== undefined) await apiKeyItem.setValue(apiKey.trim());
    const settings = await patchSettings(patch);
    broadcast('settings');
    return { settings };
  });

  registerHandler('SET_AUTONOMY', async ({ type, mode }) => {
    const cfg = await autonomyItem.getValue();
    await autonomyItem.setValue({ ...cfg, [type]: mode });
    broadcast('settings');
    return { ok: true };
  });

  registerHandler('START_JOB', async (job) => {
    // не ждём завершения — панель следит за currentJob через STATE_CHANGED
    void runJob(job);
    return { ok: true };
  });

  registerHandler('STOP_JOB', async () => {
    if (isJobRunning()) requestStop();
    return { ok: true };
  });

  registerHandler('EXPORT_CSV', async ({ store }) => {
    await downloadCsv(store);
    return { ok: true };
  });

  registerHandler('RUN_SELFTEST', async () => {
    const tabId = await getWorkTab(false);
    const res = waitForMessage(tabId, isSelftest, 8000);
    if (!sendToTab(tabId, { type: 'RUN_SELFTEST' })) return { ok: false, error: 'content script не подключён — обновите вкладку threads.com' };
    const r = await res;
    return { ok: r.broken.length === 0, broken: r.broken };
  });

  registerHandler('GET_PROFILE', async () => ({
    profile: (await voiceProfileItem.getValue()) ?? SEED_PROFILE,
    questionnaire: await questionnaireItem.getValue(),
  }));

  registerHandler('SAVE_QUESTIONNAIRE', async ({ answers }) => {
    await questionnaireItem.setValue(answers);
    const current = (await voiceProfileItem.getValue()) ?? SEED_PROFILE;
    // извлечённые из постов поля уже «внутри» current; анкета накладывается поверх
    const profile = mergeProfile(current, answers, null);
    await voiceProfileItem.setValue(profile);
    broadcast('profile');
    return { profile };
  });

  registerHandler('OPEN_URL', async ({ url }) => {
    await browser.tabs.create({ url, active: true });
    return { ok: true };
  });

  registerHandler('ENGINE', async ({ command }) => {
    // полноценный движок — фаза 3; здесь только состояние
    const st = await engineStateItem.getValue();
    const next = command === 'stop' ? { ...st, status: 'stopped' as const } : { ...st, status: 'running' as const, startedAt: st.startedAt ?? Date.now(), pausedUntil: undefined, pauseReason: undefined };
    await engineStateItem.setValue(next);
    broadcast('state');
    return next;
  });

  registerHandler('APPROVE', async ({ actionId, text }) => {
    const a = await updateAction(actionId, {
      status: 'queued',
      finalText: text,
      editedByHuman: text !== undefined,
      decidedAt: Date.now(),
    });
    broadcast('actions');
    return { ok: !!a };
  });

  registerHandler('REJECT', async ({ actionId, reason, notMyVoice }) => {
    const a = await updateAction(actionId, { status: 'rejected', rejectReason: reason, decidedAt: Date.now() });
    if (a && notMyVoice) {
      const { addEvent } = await import('@/db/repo-events');
      await addEvent({ at: Date.now(), kind: 'voice_feedback', message: reason ?? 'не мой голос', payload: { actionId, draft: a.draftText } });
    }
    broadcast('actions');
    return { ok: !!a };
  });
}

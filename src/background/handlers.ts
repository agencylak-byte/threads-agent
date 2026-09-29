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

  registerHandler('SET_AUTONOMY', async ({ actionType: type, mode }) => {
    const cfg = await autonomyItem.getValue();
    await autonomyItem.setValue({ ...cfg, [type]: mode });
    if (mode === 'auto') {
      // уже предложенные этого типа: с достаточным баллом — в очередь отправки, остальные — снять
      const { getPost } = await import('@/db/repo-posts');
      const s = await getSettings();
      let queued = 0;
      let dropped = 0;
      for (const a of await listActionsByStatus(['proposed'], 500)) {
        if (a.type !== type) continue;
        const post = a.targetPostId ? await getPost(a.targetPostId) : undefined;
        const score = post?.ai?.commentScore ?? 100;
        if (type !== 'comment-on-stranger' || score >= Math.max(s.commentMin, s.autoCommentMin)) {
          await updateAction(a.id, { status: 'queued', decidedAt: Date.now(), autonomyMode: 'auto' });
          queued++;
        } else {
          await updateAction(a.id, { status: 'expired', rejectReason: `автопилот: балл ${score} ниже порога ${s.autoCommentMin}`, decidedAt: Date.now() });
          dropped++;
        }
      }
      const { log } = await import('@/shared/log');
      log('info', `автопилот ${type}: ${queued} в очередь отправки, ${dropped} снято`);
      void import('./engine').then((m) => m.runTick());
    }
    broadcast('settings');
    broadcast('actions');
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

  registerHandler('DUMP_PAGE', async () => {
    const tabId = await getWorkTab(false);
    const res = waitForMessage(tabId, (m): m is Extract<ContentToSw, { type: 'PAGE_DUMP' }> => m.type === 'PAGE_DUMP', 15_000);
    if (!sendToTab(tabId, { type: 'DUMP_PAGE' })) return { ok: false, error: 'content script не подключён — обновите вкладку threads.com' };
    const r = await res;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const filename = `threads-agent/dump-${r.page}-${stamp}.html`;
    await browser.downloads.download({
      url: 'data:text/html;charset=utf-8,' + encodeURIComponent(r.html),
      filename,
      saveAs: false,
    });
    return { ok: true, filename };
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

  registerHandler('OPEN_WORK_WINDOW', async () => {
    try {
      const { openWorkWindow } = await import('./tabs');
      await openWorkWindow();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerHandler('CLOSE_WORK_WINDOWS', async () => {
    const { closeAllWorkWindows } = await import('./tabs');
    return { ok: true, closed: await closeAllWorkWindows() };
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
    if (next.status === 'running') void import('./engine').then((m) => m.runTick());
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
    if (a) void import('./engine').then((m) => m.runTick());
    return { ok: !!a };
  });

  registerHandler('RETRY_ACTION', async ({ actionId }) => {
    const a = await updateAction(actionId, { status: 'queued', attempts: 0, error: undefined, scheduledFor: undefined });
    broadcast('actions');
    if (a) void import('./engine').then((m) => m.runTick());
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

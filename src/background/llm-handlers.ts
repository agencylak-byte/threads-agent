import { registerHandler } from './handlers';
import { runJob } from './jobs';
import { runTick } from './engine';
import { broadcast } from './state';
import { apiKeyItem, getSettings, questionnaireItem, selfHandleItem, voiceProfileItem } from '@/shared/settings';
import { verifyModel } from '@/llm/openrouter';
import { extractVoice } from '@/llm/tasks/voice-extract';
import { draftPost } from '@/llm/tasks/post-draft';
import { draftFor } from '@/engine/scheduler';
import { getAction, createAction, makeDedupeKey } from '@/db/repo-actions';
import { listPostsByAuthor } from '@/db/repo-posts';
import { bumpMetric, dateKey } from '@/db/repo-metrics';
import { SEED_PROFILE } from '@/profile/seed-profile';
import { mergeProfile } from '@/profile/voice-profile';
import { modeFor } from '@/engine/autonomy';
import { autonomyItem } from '@/shared/settings';
import { log } from '@/shared/log';

// Обработчики UI-запросов, которым нужен LLM.

export function registerLlmHandlers(): void {
  registerHandler('VERIFY_MODEL', async () => {
    const [apiKey, s] = await Promise.all([apiKeyItem.getValue(), getSettings()]);
    if (!apiKey) return { ok: false, error: 'Ключ не задан' };
    try {
      const m = await verifyModel(apiKey, s.model);
      return { ok: true, model: `${m.id}${m.name ? ` (${m.name})` : ''}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerHandler('REGENERATE', async ({ actionId, hint }) => {
    const a = await getAction(actionId);
    if (!a) return { ok: false, error: 'Действие не найдено' };
    try {
      const draftText = await draftFor(a, hint);
      broadcast('actions');
      return { ok: true, draftText };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  const voiceHandle = async () => {
    const self = await selfHandleItem.getValue();
    const source = (await getSettings()).voiceSourceHandle.replace(/^@/, '').trim();
    return { self, source, handle: source || self };
  };

  registerHandler('LIST_VOICE_SAMPLES', async () => {
    const { handle } = await voiceHandle();
    if (!handle) return { handle: '', posts: [] };
    const posts = (await listPostsByAuthor(handle))
      .filter((p) => p.text.trim().length > 30)
      .sort((a, b) => (b.postedAt ?? b.firstSeenAt) - (a.postedAt ?? a.firstSeenAt))
      .slice(0, 150)
      .map((p) => ({ id: p.id, text: p.text, postedAt: p.postedAt }));
    return { handle, posts };
  });

  registerHandler('LEARN_VOICE', async ({ postIds, extraTexts, skipCollect }) => {
    const { source, handle } = await voiceHandle();
    if (!handle) return { ok: false, error: 'Не определён свой handle — откройте threads.com' };
    if (!skipCollect) {
      const job = await runJob(source ? { kind: 'collect-voice-source', param: source } : { kind: 'collect-self' });
      if (!job.ok) return { ok: false, error: job.error };
    }
    const chosen = postIds ? new Set(postIds) : null;
    const mine = (await listPostsByAuthor(handle)).filter((p) => p.text.trim().length > 30 && (!chosen || chosen.has(p.id)));
    const samples = [
      ...mine.sort((a, b) => (b.postedAt ?? b.firstSeenAt) - (a.postedAt ?? a.firstSeenAt)).slice(0, 80).map((p) => p.text),
      ...(extraTexts ?? []).map((t) => t.trim()).filter((t) => t.length > 30),
    ];
    try {
      const { extracted, usage } = await extractVoice(samples);
      const s = await getSettings();
      await bumpMetric(dateKey(Date.now(), s.timezone), 'llmCostUsd', usage.costUsd);
      const q = await questionnaireItem.getValue();
      const profile = mergeProfile({ ...SEED_PROFILE, sources: { ...SEED_PROFILE.sources, samplesCount: samples.length } }, q, extracted);
      await voiceProfileItem.setValue({ ...profile, sources: { ...profile.sources, samplesCount: samples.length } });
      log('info', `voice extracted from ${samples.length} posts`);
      broadcast('profile');
      broadcast('state');
      return { ok: true, samplesCount: samples.length };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerHandler('GENERATE_POST', async ({ topic }) => {
    const self = await selfHandleItem.getValue();
    try {
      const recent = self ? (await listPostsByAuthor(self)).slice(0, 10).map((p) => p.text) : [];
      const { variants, usage } = await draftPost(topic, recent);
      const s = await getSettings();
      await bumpMetric(dateKey(Date.now(), s.timezone), 'llmCostUsd', usage.costUsd);
      const mode = modeFor(await autonomyItem.getValue(), 'publish-post');
      for (const v of variants) {
        await createAction({
          type: 'publish-post',
          targetHandle: self || 'me',
          context: `Тема: ${topic || 'свободная'}\nКрючок: ${v.hook}\nПочему: ${v.why}`,
          dedupeKey: makeDedupeKey('publish-post', { handle: self || 'me' }),
          // посты никогда не уходят в auto без явного подтверждения: даже при 'auto' создаём как proposed
          autonomyMode: mode === 'auto' ? 'auto' : 'suggest',
          draftText: v.text,
          llm: usage,
        });
      }
      broadcast('actions');
      void runTick();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

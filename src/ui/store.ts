import { signal } from '@preact/signals';
import { request, type StateSnapshot, type SwToUi } from '@/shared/messages';
import type { Settings } from '@/shared/settings';
import type { Action, AutonomyConfig } from '@/shared/types';
import type { QuestionnaireAnswers, VoiceProfile } from '@/profile/voice-profile';
import { DEFAULT_AUTONOMY } from '@/shared/constants';

// Состояние side panel: сигналы + функции обновления. UI не ходит в БД напрямую — только через request().

export const state = signal<StateSnapshot | null>(null);
export const proposed = signal<Action[]>([]);
export const settings = signal<Settings | null>(null);
export const hasApiKey = signal(false);
export const autonomy = signal<AutonomyConfig>(DEFAULT_AUTONOMY);
export const profile = signal<VoiceProfile | null>(null);
export const questionnaire = signal<QuestionnaireAnswers | null>(null);
export const error = signal<string | null>(null);

export async function refreshState(): Promise<void> {
  try {
    state.value = await request('GET_STATE', {});
  } catch (e) {
    error.value = String(e);
  }
}

export async function refreshActions(): Promise<void> {
  try {
    proposed.value = await request('LIST_ACTIONS', { status: ['proposed', 'approved', 'queued', 'executing'], limit: 100 });
  } catch (e) {
    error.value = String(e);
  }
}

export async function refreshSettings(): Promise<void> {
  try {
    const r = await request('GET_SETTINGS', {});
    settings.value = r.settings;
    hasApiKey.value = r.hasApiKey;
    const stored = (await browser.storage.local.get('autonomy')) as { autonomy?: AutonomyConfig };
    autonomy.value = stored.autonomy ?? DEFAULT_AUTONOMY;
  } catch (e) {
    error.value = String(e);
  }
}

export async function refreshProfile(): Promise<void> {
  try {
    const r = await request('GET_PROFILE', {});
    profile.value = r.profile;
    questionnaire.value = r.questionnaire;
  } catch (e) {
    error.value = String(e);
  }
}

export function initStore(): void {
  void Promise.all([refreshState(), refreshActions(), refreshSettings(), refreshProfile()]);
  browser.runtime.onMessage.addListener((msg: SwToUi) => {
    if (msg?.type !== 'STATE_CHANGED') return;
    if (msg.what === 'state') void refreshState();
    if (msg.what === 'actions') void Promise.all([refreshActions(), refreshState()]);
    if (msg.what === 'settings') void refreshSettings();
    if (msg.what === 'profile') void refreshProfile();
  });
  setInterval(() => void refreshState(), 15_000);
}

export async function call<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    error.value = null;
    return await fn();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    return undefined;
  }
}

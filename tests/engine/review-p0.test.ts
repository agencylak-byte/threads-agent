import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkFacts, extractNumbers } from '@/engine/fact-guard';
import { checkSilence } from '@/engine/watchdog';
import { detectAnomaly, detectLoadError } from '@/content/anomaly-watch';
import { DEFAULT_SETTINGS, engineStateItem, settingsItem } from '@/shared/settings';
import { resetDbForTests } from '@/db/db';
import { createAction, getAction } from '@/db/repo-actions';
import { dispatchOnce, reverifyOnce } from '@/engine/dispatcher';

const FRI_NOON_MSK = Date.UTC(2026, 8, 25, 9, 0);
const msk = { ...DEFAULT_SETTINGS, timezone: 'Europe/Moscow', rampUp: false, minGapSec: [0, 0] as [number, number], sameTypeGapSec: [0, 0] as [number, number] };

describe('P0.1 защита от выдуманных цифр', () => {
  const post = 'Постим каждый день, а заявок нет. За 3 месяца ни одной продажи.';
  it('отклоняет кейс с цифрами, которых нет в посте', () => {
    const v = checkFacts('У нас у клиента конверсия выросла с 9% до 23% за месяц.', [post]);
    expect(v.ok).toBe(false);
    expect(v.fabricated).toEqual(['9', '23']);
  });
  it('пропускает число из поста и служебные числительные', () => {
    expect(checkFacts('За 3 месяца без продаж — это уже не про контент. Что стоит после поста?', [post]).ok).toBe(true);
    expect(checkFacts('Тут 2 вопроса: кому и зачем. У нас в практике это первое, что ломается.', [post]).ok).toBe(true);
    expect(checkFacts('В 2026 году это уже норма.', [post]).ok).toBe(true);
  });
  it('число без маркера опыта — предупреждение, не отказ', () => {
    const v = checkFacts('Обычно 7 секунд решают, останется ли человек в профиле.', [post]);
    expect(v.ok).toBe(true);
    expect(v.unsourced).toEqual(['7']);
  });
  it('extractNumbers нормализует «1 200» и «1,5»', () => {
    expect(extractNumbers('1 200 заявок и 1,5 млн')).toEqual(['1200', '1.5']);
  });
});

describe('P0.2 экран ошибки загрузки ≠ блок', () => {
  const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');
  it('«Произошла ошибка. Повторите попытку позже.» без карточек — не аномалия, а экран загрузки', () => {
    const doc = parse('<main><div><span>Произошла ошибка. Повторите попытку позже.</span><div role="button">Повторить попытку</div></div></main>');
    expect(detectLoadError(doc)).not.toBeNull();
    expect(detectAnomaly(doc, 'https://www.threads.com/')).toBeNull();
  });
  it('тост «Действие заблокировано» при живой странице — action_blocked', () => {
    const doc = parse('<main><div data-pressable-container="true">пост</div><div role="alert">Действие заблокировано</div></main>');
    expect(detectLoadError(doc)).toBeNull();
    expect(detectAnomaly(doc, 'https://www.threads.com/')?.kind).toBe('action_blocked');
  });
});

describe('P0.3 неподтверждённая отправка', () => {
  beforeEach(async () => {
    await resetDbForTests();
    await settingsItem.setValue(msk);
    await engineStateItem.setValue({ status: 'running', anomalies24h: [] });
  });
  it('серия из трёх неподтверждённых живёт в storage и взводит аномалию даже после «перезагрузки» модуля', async () => {
    for (let i = 0; i < 3; i++) {
      await createAction({ type: 'comment-on-stranger', targetHandle: 'u' + i, targetPostId: `u${i}/post/1`, threadUrl: 'https://www.threads.com/@u/post/1', context: '', dedupeKey: 'k' + i, autonomyMode: 'auto', draftText: 'x' });
      // «перезагрузка» service worker между отправками
      vi.resetModules();
      const { dispatchOnce: d } = await import('@/engine/dispatcher');
      expect(await d(async () => ({ ok: true, verified: false }), FRI_NOON_MSK + i * 1000)).toBe('executed');
      if (i < 2) expect((await engineStateItem.getValue()).status).toBe('running');
    }
    const st = await engineStateItem.getValue();
    expect(st.status).toBe('paused');
    expect(st.pauseReason).toMatch(/не подтвердились/);
  });
  it('повторная проверка: нашёлся → verified, не нашёлся → failed и минус из метрики', async () => {
    const a = await createAction({ type: 'comment-on-stranger', targetHandle: 'u', targetPostId: 'u/post/1', threadUrl: 'https://www.threads.com/@u/post/1', context: '', dedupeKey: 'k', autonomyMode: 'auto', draftText: 'x' });
    await dispatchOnce(async () => ({ ok: true, verified: false }), FRI_NOON_MSK);
    let cur = await getAction(a.id);
    expect(cur?.status).toBe('done');
    expect(cur?.verifyAfter).toBeGreaterThan(FRI_NOON_MSK);
    expect(await reverifyOnce(async () => true, FRI_NOON_MSK + 1000)).toBe('idle'); // ещё рано
    expect(await reverifyOnce(async () => false, cur!.verifyAfter! + 1)).toBe('checked');
    cur = await getAction(a.id);
    expect(cur?.status).toBe('failed');
    expect(cur?.outcome.reverified).toBe(true);
  });
});

describe('P0.4 сторож тишины', () => {
  const base = { engine: { status: 'running' as const, anomalies24h: [] }, settings: msk, now: FRI_NOON_MSK, queuedReady: 5, executedLast2h: 0, verifiedLast2h: 0, dailyLimitLeft: 10, collectedLast24h: 30, candidatesReady: 3 };
  it('тревога: работает, окно открыто, очередь есть, лимит не выбран, 2 часа тишины', () => {
    expect(checkSilence(base).map((a) => a.kind)).toEqual(['no_sends']);
  });
  it('нет тревоги при выбранном лимите или вне окна', () => {
    expect(checkSilence({ ...base, dailyLimitLeft: 0 })).toEqual([]);
    expect(checkSilence({ ...base, now: Date.UTC(2026, 8, 25, 20, 30) })).toEqual([]);
  });
  it('отдельно: ничего не собрано за сутки; движок остановлен', () => {
    expect(checkSilence({ ...base, executedLast2h: 2, collectedLast24h: 0 }).map((a) => a.kind)).toEqual(['no_collect']);
    expect(checkSilence({ ...base, engine: { status: 'stopped', anomalies24h: [] } }).map((a) => a.kind)).toEqual(['engine_stopped']);
  });
});

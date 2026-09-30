import type { EngineState } from '@/shared/types';
import type { Settings } from '@/shared/settings';
import { isWorkingHours } from './pacing';

// Сторож тишины (задача 4 из разбора коллеги): агент должен заметить, что молча встал.
// Чистая функция: на вход — состояние, на выход — список тревог с причинами.

export interface SilenceInput {
  engine: EngineState;
  settings: Settings;
  now: number;
  queuedReady: number; // действий в очереди, которые можно отправлять (есть текст, не отложены)
  executedLast2h: number;
  verifiedLast2h: number;
  dailyLimitLeft: number; // сколько ещё можно отправить сегодня по всем типам в очереди
  collectedLast24h: number;
  candidatesReady: number; // свежих кандидатов выше порога, ещё не рассмотренных
}

export interface SilenceAlert {
  kind: 'no_sends' | 'no_collect' | 'unverified' | 'engine_stopped';
  message: string;
}

export function checkSilence(i: SilenceInput): SilenceAlert[] {
  const alerts: SilenceAlert[] = [];
  const inWindow = isWorkingHours(i.now, i.settings);
  if (i.engine.status === 'stopped') {
    alerts.push({ kind: 'engine_stopped', message: 'Движок остановлен — ничего не отправляется и не собирается.' });
    return alerts;
  }
  if (i.engine.status === 'paused') return alerts; // пауза по аномалии — об этом уже уведомили
  if (inWindow && i.queuedReady > 0 && i.dailyLimitLeft > 0 && i.executedLast2h === 0) {
    alerts.push({
      kind: 'no_sends',
      message: `Движок «работает», окно открыто, в очереди ${i.queuedReady} готовых, лимит не выбран — но за 2 часа ни одной отправки. Проверьте рабочее окно Threads (не свёрнуто ли) и вкладку «Здоровье».`,
    });
  }
  if (inWindow && i.executedLast2h >= 3 && i.verifiedLast2h === 0) {
    alerts.push({ kind: 'unverified', message: `За 2 часа ${i.executedLast2h} отправок, и ни одна не подтвердилась на странице. Threads мог тихо не принять комментарии.` });
  }
  if (i.settings.autoCollectIntervalMin > 0 && i.collectedLast24h === 0) {
    alerts.push({ kind: 'no_collect', message: 'За сутки не собрано ни одного нового поста — автосбор не работает или ключи исчерпаны.' });
  }
  return alerts;
}

import { useEffect, useState } from 'preact/hooks';
import { request } from '@/shared/messages';
import { ACTION_TYPES, ACTION_TYPE_LABELS, AUTO_NEEDS_CONFIRM } from '@/shared/constants';
import type { ActionType, AutonomyMode } from '@/shared/types';
import { autonomy, call, refreshSettings, settings } from '../store';

// Лимиты и автономность по типам действий. Значения по умолчанию — safety envelope из плана.

export function Limits() {
  const s = settings.value;
  const [limits, setLimits] = useState<Record<ActionType, number> | null>(null);
  const [hours, setHours] = useState({ start: '09:30', end: '21:00' });
  const [gap, setGap] = useState<[number, number]>([90, 240]);
  const [rampUp, setRampUp] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!s) return;
    setLimits({ ...s.limits });
    setHours({ ...s.workingHours });
    setGap([...s.minGapSec]);
    setRampUp(s.rampUp);
  }, [s]);

  const save = async () => {
    if (!limits) return;
    await call(() => request('SET_SETTINGS', { patch: { limits, workingHours: hours, minGapSec: gap, rampUp } }));
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const setMode = async (type: ActionType, mode: AutonomyMode) => {
    if (mode === 'auto' && AUTO_NEEDS_CONFIRM.includes(type)) {
      if (!confirm(`Включить автопилот для «${ACTION_TYPE_LABELS[type]}»? Это будет отправляться без вашего подтверждения.`)) return;
    }
    await call(() => request('SET_AUTONOMY', { type, mode }));
    await refreshSettings();
  };

  if (!s || !limits) return <div class="muted">Загрузка…</div>;
  return (
    <div>
      <h2>Автономность и дневные лимиты</h2>
      {ACTION_TYPES.map((t) => (
        <div class="row" key={t} style="margin-bottom:6px">
          <span style="flex:1">{ACTION_TYPE_LABELS[t]}</span>
          <select value={autonomy.value[t]} onChange={(e) => setMode(t, (e.target as HTMLSelectElement).value as AutonomyMode)} style="width:130px">
            <option value="off">выкл</option>
            <option value="suggest">предлагать</option>
            <option value="auto">автопилот</option>
          </select>
          <input type="number" min={0} max={200} style="width:70px" value={limits[t]} onInput={(e) => setLimits({ ...limits, [t]: Number((e.target as HTMLInputElement).value) })} />
          <span class="small muted">/день</span>
        </div>
      ))}
      <h2>Рабочее окно (МСК)</h2>
      <div class="row">
        <input type="time" value={hours.start} onInput={(e) => setHours({ ...hours, start: (e.target as HTMLInputElement).value })} style="width:110px" />
        <span>—</span>
        <input type="time" value={hours.end} onInput={(e) => setHours({ ...hours, end: (e.target as HTMLInputElement).value })} style="width:110px" />
      </div>
      <h2>Пауза между действиями, сек</h2>
      <div class="row">
        <input type="number" min={30} style="width:90px" value={gap[0]} onInput={(e) => setGap([Number((e.target as HTMLInputElement).value), gap[1]])} />
        <span>—</span>
        <input type="number" min={60} style="width:90px" value={gap[1]} onInput={(e) => setGap([gap[0], Number((e.target as HTMLInputElement).value)])} />
      </div>
      <label class="row" style="font-weight:normal;margin-top:10px">
        <input type="checkbox" style="width:auto" checked={rampUp} onChange={(e) => setRampUp((e.target as HTMLInputElement).checked)} />
        Плавный разгон: первые 7 дней лимиты ×0.4, дни 8–14 ×0.7
      </label>
      <div class="row" style="margin-top:10px">
        <button class="primary" onClick={save}>Сохранить</button>
        {saved && <span class="small muted">сохранено</span>}
      </div>
      <p class="small muted">Выходные — лимиты ×{s.weekendFactor}. Личка (dm-first, dm-continue) появится в следующем инкременте; лимиты для неё уже заложены.</p>
    </div>
  );
}

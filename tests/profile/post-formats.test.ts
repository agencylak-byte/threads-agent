import { describe, expect, it } from 'vitest';
import { POST_FORMATS, pickFormat, recentOpeners, startsWithBanned } from '@/profile/post-formats';

const H = 3600_000;

describe('форматы автопостов', () => {
  it('первым идёт формат, который ещё не выходил', () => {
    expect(pickFormat([], 0).id).toBe(POST_FORMATS[0]!.id);
    const now = 100 * H;
    const hist = POST_FORMATS.filter((f) => f.id !== 'rant').map((f, i) => ({ format: f.id, at: now - i * H }));
    expect(pickFormat(hist, now).id).toBe('rant');
  });
  it('перекличка не чаще раза в 48 часов', () => {
    const now = 1000 * H;
    const hist = POST_FORMATS.filter((f) => f.id !== 'community').map((f) => ({ format: f.id, at: now - H }));
    expect(pickFormat([...hist, { format: 'community', at: now - 10 * H }], now).id).not.toBe('community');
    expect(pickFormat([...hist, { format: 'community', at: now - 50 * H }], now).id).toBe('community');
  });
  it('ловит затёртые зачины', () => {
    expect(startsWithBanned('Я иногда удивляюсь, когда собственники…')).toBe('Я иногда удивляюсь');
    expect(startsWithBanned('Непопулярное мнение: охваты ничего не значат')).toBeNull();
  });
  it('зачины недавних постов', () => {
    expect(recentOpeners(['Сейчас поняла, что всё не так', 'Норм или стрем, когда клиент…'])).toEqual(['Сейчас поняла, что', 'Норм или стрем']);
  });
});

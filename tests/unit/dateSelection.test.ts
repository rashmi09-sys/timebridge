import { describe, expect, it } from 'vitest';
import { chooseDate } from '../../src/lib/dateSelection';

const october = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
const openOn = (...days: number[]) => {
  const keys = new Set(days.map((d) => `2026-10-${String(d).padStart(2, '0')}`));
  return (key: string) => keys.has(key);
};
const base = { monthDays: october, todayKey: '2026-10-13', current: null, chosenDateKey: null };

describe('automatic date choice', () => {
  it('first load: today when it still has open times', () => {
    expect(chooseDate({ ...base, isOpen: openOn(13, 14, 15) })).toEqual({ date: '2026-10-13', moved: false });
  });

  it('first load: the next open date when today has none left', () => {
    expect(chooseDate({ ...base, isOpen: openOn(15, 16) })).toEqual({ date: '2026-10-15', moved: false });
  });

  it('never picks a past date, even if it were marked open', () => {
    expect(chooseDate({ ...base, isOpen: openOn(5, 20) }).date).toBe('2026-10-20');
  });

  it('nothing open this month: null, so the caller looks at the next month', () => {
    expect(chooseDate({ ...base, isOpen: openOn() })).toEqual({ date: null, moved: false });
  });

  it('keeps a date the guest picked while it still has times', () => {
    expect(chooseDate({ ...base, current: '2026-10-20', isOpen: openOn(14, 20) })).toEqual({ date: '2026-10-20', moved: false });
  });

  it('a picked date that lost its times moves to the nearest open date after it, and says so', () => {
    expect(chooseDate({ ...base, current: '2026-10-13', isOpen: openOn(14, 15) })).toEqual({ date: '2026-10-14', moved: true });
    // Nothing after it: the earliest open date this month.
    expect(chooseDate({ ...base, current: '2026-10-30', isOpen: openOn(14) })).toEqual({ date: '2026-10-14', moved: true });
  });

  it('a chosen time keeps its instant: its date in the new zone wins, without a "no times" note', () => {
    // Wed 14 is still open, but the chosen time is Thu 15 on the new clock.
    expect(chooseDate({ ...base, current: '2026-10-14', chosenDateKey: '2026-10-15', isOpen: openOn(14, 15) })).toEqual({
      date: '2026-10-15',
      moved: false,
    });
  });

  it('a chosen time that is no longer open is ignored', () => {
    expect(chooseDate({ ...base, current: '2026-10-14', chosenDateKey: '2026-10-16', isOpen: openOn(14) })).toEqual({
      date: '2026-10-14',
      moved: false,
    });
  });
});

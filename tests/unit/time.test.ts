import { describe, expect, it } from 'vitest';
import {
  canonicalZoneName,
  dateKey,
  dayShift,
  findOffsetChanges,
  formatDuration,
  formatOffset,
  formatTime,
  getOffsetMinutes,
  offsetDifference,
  startOfDay,
  zoneGenericName,
  zonedTimeToInstant,
} from '../../src/lib/time';
import { generateSlots, type HostSchedule } from '../../src/lib/availability';

const utc = (s: string) => Date.parse(s);

describe('offsets come from the IANA database, not fixed numbers', () => {
  it('handles half-hour and quarter-hour zones', () => {
    expect(getOffsetMinutes('Asia/Kolkata', utc('2026-10-13T00:00:00Z'))).toBe(330);
    expect(getOffsetMinutes('Asia/Kathmandu', utc('2026-10-13T00:00:00Z'))).toBe(345);
    expect(getOffsetMinutes('Australia/Eucla', utc('2026-10-13T00:00:00Z'))).toBe(525);
  });

  it('tracks US daylight saving ending on Sunday 1 Nov 2026', () => {
    expect(getOffsetMinutes('America/Los_Angeles', utc('2026-10-31T12:00:00Z'))).toBe(-420);
    expect(getOffsetMinutes('America/Los_Angeles', utc('2026-11-02T12:00:00Z'))).toBe(-480);
  });

  it('tracks EU daylight saving ending on Sunday 25 Oct 2026', () => {
    expect(getOffsetMinutes('Europe/London', utc('2026-10-24T12:00:00Z'))).toBe(60);
    expect(getOffsetMinutes('Europe/London', utc('2026-10-26T12:00:00Z'))).toBe(0);
  });

  it('works for legacy identifiers browsers still report', () => {
    expect(getOffsetMinutes('Asia/Calcutta', utc('2026-10-13T00:00:00Z'))).toBe(330);
    expect(canonicalZoneName('Asia/Calcutta')).toBe('Asia/Kolkata');
    expect(canonicalZoneName('Europe/Kiev')).toBe('Europe/Kyiv');
  });
});

describe('wall time → instant', () => {
  it('converts an ordinary time', () => {
    const r = zonedTimeToInstant('Asia/Kolkata', { year: 2026, month: 10, day: 14, hour: 9, minute: 30 });
    expect(r).toEqual({ instant: utc('2026-10-14T04:00:00Z'), resolution: 'exact' });
  });

  it('picks the earlier instant for a time that happens twice (clocks go back)', () => {
    const r = zonedTimeToInstant('America/Los_Angeles', { year: 2026, month: 11, day: 1, hour: 1, minute: 30 });
    expect(r.resolution).toBe('ambiguous');
    expect(r.instant).toBe(utc('2026-11-01T08:30:00Z')); // 1:30 PDT
  });

  it('moves a time that never happens (clocks go forward) past the gap', () => {
    const r = zonedTimeToInstant('America/Los_Angeles', { year: 2027, month: 3, day: 14, hour: 2, minute: 30 });
    expect(r.resolution).toBe('skipped');
    expect(formatTime(r.instant, 'America/Los_Angeles', '24h')).toBe('03:30');
  });

  it('finds the start of a day that begins at 01:00 (no midnight)', () => {
    // America/Santiago springs forward at 00:00 → 01:00 on 6 Sep 2026.
    const start = startOfDay('America/Santiago', '2026-09-06');
    expect(dateKey('America/Santiago', start)).toBe('2026-09-06');
    expect(formatTime(start, 'America/Santiago', '24h')).toBe('01:00');
  });
});

describe('cross-zone comparison', () => {
  it('India is 12½ hours ahead of Los Angeles before 1 Nov, 13½ after', () => {
    expect(offsetDifference('America/Los_Angeles', 'Asia/Kolkata', utc('2026-10-20T00:00:00Z'))).toBe(750);
    expect(offsetDifference('America/Los_Angeles', 'Asia/Kolkata', utc('2026-11-03T00:00:00Z'))).toBe(810);
    expect(formatDuration(750)).toBe('12½ hours');
    expect(formatDuration(345)).toBe('5 hours 45 minutes');
    expect(formatDuration(60)).toBe('1 hour');
    expect(formatDuration(30)).toBe('30 minutes');
  });

  it('detects when the same instant falls on different calendar days', () => {
    const t = utc('2026-10-14T04:00:00Z'); // 9:00 PM Tue in LA, 9:30 AM Wed in India
    expect(formatTime(t, 'America/Los_Angeles', '12h')).toBe('9:00 PM');
    expect(formatTime(t, 'Asia/Kolkata', '12h')).toBe('9:30 AM');
    expect(dayShift('America/Los_Angeles', 'Asia/Kolkata', t)).toBe(1);
    expect(dayShift('Asia/Kolkata', 'America/Los_Angeles', t)).toBe(-1);
  });

  it('reads the same instants on the viewer’s clock (formerly the late-night check)', () => {
    expect(formatTime(utc('2026-10-14T04:00:00Z'), 'America/Los_Angeles', '12h')).toBe('9:00 PM');
    expect(formatTime(utc('2026-10-14T06:00:00Z'), 'America/Los_Angeles', '12h')).toBe('11:00 PM');
    expect(formatTime(utc('2026-10-14T13:00:00Z'), 'America/Los_Angeles', '12h')).toBe('6:00 AM');
    expect(formatTime(utc('2026-10-14T14:00:00Z'), 'America/Los_Angeles', '12h')).toBe('7:00 AM');
  });

  it('finds the exact DST transition instant', () => {
    const changes = findOffsetChanges('America/Los_Angeles', utc('2026-10-15T00:00:00Z'), utc('2026-11-15T00:00:00Z'));
    expect(changes).toHaveLength(1);
    expect(changes[0].at).toBe(utc('2026-11-01T09:00:00Z'));
    expect(changes[0].fromMinutes).toBe(-420);
    expect(changes[0].toMinutes).toBe(-480);
    expect(findOffsetChanges('Asia/Kolkata', utc('2026-01-01T00:00:00Z'), utc('2026-12-31T00:00:00Z'))).toHaveLength(0);
  });

  it('formats offsets and generic names', () => {
    expect(formatOffset(330)).toBe('GMT+5:30');
    expect(formatOffset(-420)).toBe('GMT−7');
    expect(formatOffset(0)).toBe('GMT');
    expect(zoneGenericName('America/Los_Angeles', utc('2026-10-14T00:00:00Z'))).toBe('Pacific Time');
    expect(zoneGenericName('Asia/Kolkata', utc('2026-10-14T00:00:00Z'))).toBe('India Standard Time');
  });
});

describe('slot generation', () => {
  const schedule: HostSchedule = { timeZone: 'Asia/Kolkata', weekly: { 3: [['09:00', '17:00']] } };
  const event = { title: 't', lengthMinutes: 15, minimumNoticeMinutes: 0, bookingWindowDays: 60 };

  it('generates 32 fifteen-minute slots for an 8-hour day', () => {
    const slots = generateSlots(schedule, event, utc('2026-10-13T18:30:00Z'), utc('2026-10-14T18:30:00Z'), utc('2026-10-01T00:00:00Z'));
    expect(slots).toHaveLength(32);
    expect(slots[0].start).toBe(utc('2026-10-14T03:30:00Z'));
  });

  it('a host in a DST zone keeps 9 AM local across the change', () => {
    const ny: HostSchedule = { timeZone: 'America/New_York', weekly: { 5: [['09:00', '10:00']], 1: [['09:00', '10:00']] } };
    const slots = generateSlots(ny, event, utc('2026-10-30T00:00:00Z'), utc('2026-11-03T00:00:00Z'), utc('2026-10-01T00:00:00Z'));
    const firsts = slots.filter((s) => formatTime(s.start, 'America/New_York', '24h') === '09:00').map((s) => s.start);
    expect(firsts).toEqual([utc('2026-10-30T13:00:00Z'), utc('2026-11-02T14:00:00Z')]);
  });

  it('respects minimum notice and the booking window', () => {
    const now = utc('2026-10-14T04:00:00Z'); // 9:30 IST Wed
    const slots = generateSlots(
      schedule,
      { ...event, minimumNoticeMinutes: 120, bookingWindowDays: 7 },
      utc('2026-10-01T00:00:00Z'),
      utc('2026-12-01T00:00:00Z'),
      now,
    );
    expect(slots[0].start).toBeGreaterThanOrEqual(now + 120 * 60_000);
    expect(dateKey('Asia/Kolkata', slots[slots.length - 1].start)).toBe('2026-10-21');
  });
});

describe('guest-local reading of slot instants (same cases the night markers used)', () => {
  // Local wall-clock → instant → back to local text, on the guest's clock for that exact date.
  const at = (zone: string, y: number, mo: number, d: number, h: number, mi: number) =>
    zonedTimeToInstant(zone, { year: y, month: mo, day: d, hour: h, minute: mi }).instant;

  it.each([
    [21, 15, '9:15 PM', '21:15'],
    [21, 59, '9:59 PM', '21:59'],
    [22, 0, '10:00 PM', '22:00'],
    [22, 15, '10:15 PM', '22:15'],
    [23, 30, '11:30 PM', '23:30'],
    [0, 0, '12:00 AM', '00:00'],
    [6, 45, '6:45 AM', '06:45'],
    [6, 59, '6:59 AM', '06:59'],
    [7, 0, '7:00 AM', '07:00'],
  ])('Los Angeles %i:%i reads as %s / %s', (h, m, twelve, twentyFour) => {
    const t = at('America/Los_Angeles', 2026, 10, 14, h, m);
    expect(formatTime(t, 'America/Los_Angeles', '12h')).toBe(twelve);
    expect(formatTime(t, 'America/Los_Angeles', '24h')).toBe(twentyFour);
  });

  it('one instant, three clocks: Los Angeles, London and India', () => {
    const t = Date.parse('2026-10-14T05:00:00Z');
    expect(formatTime(t, 'America/Los_Angeles', '12h')).toBe('10:00 PM');
    expect(dateKey('America/Los_Angeles', t)).toBe('2026-10-13');
    expect(formatTime(t, 'Europe/London', '12h')).toBe('6:00 AM');
    expect(formatTime(t, 'Asia/Kolkata', '12h')).toBe('10:30 AM');
    expect(dateKey('Asia/Kolkata', t)).toBe('2026-10-14');
  });

  it('handles quarter-hour zones and midnight crossing', () => {
    expect(formatTime(at('Asia/Kathmandu', 2026, 10, 14, 21, 45), 'Asia/Kolkata', '12h')).toBe('9:30 PM');
    const lateSlot = at('America/Los_Angeles', 2026, 10, 13, 23, 45);
    expect(dateKey('America/Los_Angeles', lateSlot)).toBe('2026-10-13');
    expect(dateKey('America/Los_Angeles', lateSlot + 15 * 60_000)).toBe('2026-10-14'); // ends after midnight
    expect(dateKey('Asia/Kolkata', lateSlot)).toBe('2026-10-14');
  });

  it('reads correctly on the DST change day (Los Angeles, Nov 1 2026)', () => {
    const before = at('America/Los_Angeles', 2026, 11, 1, 0, 30); // still PDT
    const after = at('America/Los_Angeles', 2026, 11, 1, 7, 0); // PST
    expect(formatTime(before, 'Asia/Kolkata', '12h')).toBe('1:00 PM');
    expect(formatTime(after, 'Asia/Kolkata', '12h')).toBe('8:30 PM');
  });
});

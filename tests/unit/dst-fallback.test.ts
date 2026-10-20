import { describe, expect, it } from 'vitest';
import { generateSlots, isPreBooked } from '../../src/lib/availability';
import { OCCURRENCE_TEXT, REPEATED_TIMES_NOTE } from '../../src/lib/bridge';
import { buildIcs } from '../../src/lib/calendarLinks';
import { EVENT, EVERY_DAY_SCHEDULE, SCHEDULE } from '../../src/lib/simulatedBookingService';
import { clockOccurrence, dateKey, formatTime, getOffsetMinutes, hasRepeatedTimes, repeatedTime } from '../../src/lib/time';

/*
 * The whole pipeline for Los Angeles on Sun 1 Nov 2026, when clocks go back at 2:00 AM PDT
 * (09:00 UTC) and 1:00–1:59 AM happens twice. Same steps as the app: generate in the host's
 * zone, drop pre-booked times, group by the guest's date, format.
 */
const LA = 'America/Los_Angeles';
const NOW = Date.parse('2026-10-30T15:30:00Z');
const FROM = Date.parse('2026-10-01T00:00:00Z');
const TO = Date.parse('2026-12-01T00:00:00Z');
const MIN = 60_000;

function guestDay(schedule = EVERY_DAY_SCHEDULE, day = '2026-11-01') {
  const all = generateSlots(schedule, EVENT, FROM, TO, NOW);
  const open = all.filter((s) => !isPreBooked(s.start));
  return {
    generated: all.filter((s) => dateKey(LA, s.start) === day),
    open: open.filter((s) => dateKey(LA, s.start) === day),
  };
}

describe('DST fall-back in Los Angeles: slots behind the labels', () => {
  const { generated, open } = guestDay();

  it('every slot is a distinct UTC instant, 15 minutes long, in chronological order', () => {
    const starts = open.map((s) => s.start);
    expect(new Set(starts).size).toBe(starts.length);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    for (const s of open) expect(s.end - s.start).toBe(15 * MIN);
  });

  it('generation is a gap-free 15-minute grid inside the host’s hours (09:00–17:00 IST)', () => {
    // Sun 1 Nov 09:00–17:00 IST is 03:30–11:30 UTC; the LA date starts at 07:00 UTC (midnight PDT).
    // Mon 2 Nov 09:00 IST (03:30 UTC Nov 2) is 7:30 PM PST, still Nov 1 in LA.
    const expected: number[] = [];
    for (let t = Date.parse('2026-11-01T07:00:00Z'); t < Date.parse('2026-11-01T11:30:00Z'); t += 15 * MIN) expected.push(t);
    for (let t = Date.parse('2026-11-02T03:30:00Z'); t < Date.parse('2026-11-02T08:00:00Z'); t += 15 * MIN) expected.push(t);
    expect(generated.map((s) => s.start)).toEqual(expected);
  });

  it('the only missing quarter-hours are the simulation’s pre-booked times', () => {
    const shown = new Set(open.map((s) => s.start));
    const missing = generated.filter((s) => !shown.has(s.start));
    expect(missing.length).toBeGreaterThan(0);
    for (const s of missing) expect(isPreBooked(s.start)).toBe(true);
    for (const s of open) expect(isPreBooked(s.start)).toBe(false);
  });

  it('both occurrences of the repeated hour stay as separate bookable slots where open', () => {
    const repeated = open.filter((s) => repeatedTime(s.start, LA));
    const pdt = repeated.filter((s) => getOffsetMinutes(LA, s.start) === -420);
    const pst = repeated.filter((s) => getOffsetMinutes(LA, s.start) === -480);
    expect(pdt.length).toBeGreaterThan(0);
    expect(pst.length).toBeGreaterThan(0);
    expect(pdt.length + pst.length).toBe(repeated.length);
    // Every PDT slot precedes every PST slot.
    expect(Math.max(...pdt.map((s) => s.start))).toBeLessThan(Math.min(...pst.map((s) => s.start)));
  });

  it('“Before clocks change” sits on UTC−7 instants and “After clocks change” on UTC−8', () => {
    for (const s of open) {
      const occurrence = clockOccurrence(s.start, LA);
      if (occurrence === 'before') expect(getOffsetMinutes(LA, s.start)).toBe(-420);
      if (occurrence === 'after') expect(getOffsetMinutes(LA, s.start)).toBe(-480);
    }
    expect(clockOccurrence(Date.parse('2026-11-01T08:15:00Z'), LA)).toBe('before');
    expect(clockOccurrence(Date.parse('2026-11-01T09:15:00Z'), LA)).toBe('after');
    // Both read as the same plain clock time, in either hour cycle.
    expect(formatTime(Date.parse('2026-11-01T08:15:00Z'), LA, '12h', 'en-US')).toBe('1:15 AM');
    expect(formatTime(Date.parse('2026-11-01T09:15:00Z'), LA, '12h', 'en-US')).toBe('1:15 AM');
    expect(formatTime(Date.parse('2026-11-01T08:15:00Z'), LA, '24h', 'en-US')).toBe('01:15');
    expect(formatTime(Date.parse('2026-11-01T09:15:00Z'), LA, '24h', 'en-US')).toBe('01:15');
  });

  it('time plus occurrence is unique within the day in both hour cycles; descriptions only inside 1:00–1:59', () => {
    for (const cycle of ['12h', '24h'] as const) {
      const labels = open.map((s) => {
        const occurrence = clockOccurrence(s.start, LA);
        return `${formatTime(s.start, LA, cycle, 'en-US')}${occurrence ? ` · ${OCCURRENCE_TEXT[occurrence]}` : ''}`;
      });
      expect(new Set(labels).size).toBe(labels.length);
      for (const [i, label] of labels.entries()) {
        const inRepeat = open[i].start >= Date.parse('2026-11-01T08:00:00Z') && open[i].start < Date.parse('2026-11-01T10:00:00Z');
        expect(label.includes('clocks change'), label).toBe(inRepeat);
        expect(label).not.toMatch(/P[DS]T|GMT/);
      }
    }
  });

  it('the explanation applies to this day, and not to the day before or after', () => {
    expect(hasRepeatedTimes(open.map((s) => s.start), LA)).toBe(true);
    for (const day of ['2026-10-31', '2026-11-02']) {
      expect(hasRepeatedTimes(guestDay(EVERY_DAY_SCHEDULE, day).open.map((s) => s.start), LA)).toBe(false);
    }
    expect(REPEATED_TIMES_NOTE).toBe('Clocks go back on this day. Some times appear twice.');
  });

  it('a DST day without repeated open times gets no explanation (Arjun’s real weekday hours)', () => {
    // With the normal Mon–Fri schedule, Nov 1 in LA only has Monday-IST evening times (PST).
    const normal = guestDay(SCHEDULE).open;
    expect(normal.length).toBeGreaterThan(0);
    expect(hasRepeatedTimes(normal.map((s) => s.start), LA)).toBe(false);
  });

  it('exports for the two 1:15 AMs are an hour apart in UTC', () => {
    const ics = (start: number) =>
      buildIcs({ uid: 'x', slot: { start, end: start + 15 * MIN }, title: 't', description: 'd' });
    const first = ics(Date.parse('2026-11-01T08:15:00Z'));
    const second = ics(Date.parse('2026-11-01T09:15:00Z'));
    expect(first).toContain('\r\nDTSTART:20261101T081500Z\r\nDTEND:20261101T083000Z\r\n');
    expect(second).toContain('\r\nDTSTART:20261101T091500Z\r\nDTEND:20261101T093000Z\r\n');
  });

  it('the same instants keep their meaning in other guest zones (no repeat, no abbreviation)', () => {
    for (const s of open) {
      expect(repeatedTime(s.start, 'Asia/Tokyo')).toBeNull();
      expect(clockOccurrence(s.start, 'Asia/Kolkata')).toBeNull();
    }
  });
});

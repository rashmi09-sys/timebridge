import { describe, expect, it } from 'vitest';
import { meetingOccurrence } from '../../src/lib/bridge';
import { buildIcs } from '../../src/lib/calendarLinks';
import {
  addDaysToKey,
  clockOccurrence,
  dateKey,
  daysInMonth,
  findOffsetChanges,
  formatTime,
  getOffsetMinutes,
  getZonedParts,
  hasRepeatedTimes,
  zonedTimeToInstant,
} from '../../src/lib/time';

/*
 * Clock changes are found from the platform's IANA data, never from date lists. These tests
 * check that across several years and rule sets (US, EU, Australian states including a
 * 30-minute change, and zones with no DST), and compare against UTC instants worked out by hand
 * from each jurisdiction's published rule.
 */
const MIN = 60_000;
const utc = (s: string) => Date.parse(s);
const YEARS = [2026, 2027, 2028, 2029];

const DST_ZONES = [
  'America/Los_Angeles',
  'America/New_York',
  'Europe/London',
  'Australia/Sydney',
  'Australia/Adelaide',
  'Australia/Lord_Howe',
];
const NO_DST_ZONES = ['Asia/Kolkata', 'Asia/Kathmandu', 'Asia/Tokyo'];

function changesIn(zone: string, year: number) {
  return findOffsetChanges(zone, utc(`${year}-01-01T00:00:00Z`), utc(`${year + 1}-01-01T00:00:00Z`));
}

describe('clock changes come from time-zone data, in every year', () => {
  for (const zone of DST_ZONES) {
    for (const year of YEARS) {
      it(`${zone} ${year}: one change forward and one back`, () => {
        const changes = changesIn(zone, year);
        expect(changes).toHaveLength(2);
        const directions = changes.map((c) => Math.sign(c.toMinutes - c.fromMinutes)).sort();
        expect(directions).toEqual([-1, 1]);
      });
    }
  }

  for (const zone of NO_DST_ZONES) {
    it(`${zone}: no changes 2026–2029, so no repeated times`, () => {
      for (const year of YEARS) expect(changesIn(zone, year)).toEqual([]);
      expect(hasRepeatedTimes([utc('2026-11-01T08:30:00Z'), utc('2027-04-04T16:30:00Z')], zone)).toBe(false);
    });
  }

  // Hand-derived from the published rules (first instant on the new offset, in UTC).
  const KNOWN: Array<[string, string, number, number]> = [
    ['America/Los_Angeles', '2027-11-07T09:00:00Z', -420, -480], // first Sun Nov, 2:00 PDT
    ['America/Los_Angeles', '2028-11-05T09:00:00Z', -420, -480],
    ['America/Los_Angeles', '2029-03-11T10:00:00Z', -480, -420], // second Sun Mar, 2:00 PST
    ['America/New_York', '2029-11-04T06:00:00Z', -240, -300],
    ['Europe/London', '2028-10-29T01:00:00Z', 60, 0], // last Sun Oct, 01:00 UTC
    ['Europe/London', '2029-03-25T01:00:00Z', 0, 60], // last Sun Mar
    ['Australia/Sydney', '2027-04-03T16:00:00Z', 660, 600], // first Sun Apr, 3:00 AEDT
    ['Australia/Sydney', '2028-09-30T16:00:00Z', 600, 660], // first Sun Oct, 2:00 AEST
    ['Australia/Adelaide', '2027-04-03T16:30:00Z', 630, 570], // 3:00 ACDT (UTC+10:30)
    ['Australia/Lord_Howe', '2027-04-03T15:00:00Z', 660, 630], // 2:00, back 30 minutes
  ];
  for (const [zone, at, from, to] of KNOWN) {
    it(`${zone} changes at ${at} from ${from} to ${to} minutes`, () => {
      const year = Number(at.slice(0, 4));
      const change = changesIn(zone, year).find((c) => c.fromMinutes === from && c.toMinutes === to);
      expect(change?.at).toBe(utc(at));
    });
  }
});

describe('repeated and skipped times follow each change, whatever its size or hemisphere', () => {
  for (const zone of DST_ZONES) {
    for (const year of YEARS) {
      it(`${zone} ${year}`, () => {
        for (const c of changesIn(zone, year)) {
          const shift = Math.abs(c.toMinutes - c.fromMinutes) * MIN;
          if (c.toMinutes < c.fromMinutes) {
            // Clocks go back: the last `shift` before the change and the first `shift` after it
            // show the same clock times; the first set is "before", the second "after".
            for (let t = c.at - shift; t < c.at; t += 15 * MIN) {
              expect(clockOccurrence(t, zone)).toBe('before');
              expect(clockOccurrence(t + shift, zone)).toBe('after');
              expect(formatTime(t, zone, '24h', 'en-US')).toBe(formatTime(t + shift, zone, '24h', 'en-US'));
              expect(getOffsetMinutes(zone, t)).toBe(c.fromMinutes);
              expect(getOffsetMinutes(zone, t + shift)).toBe(c.toMinutes);
            }
            // Just outside the repeated interval, times are ordinary.
            expect(clockOccurrence(c.at - shift - MIN, zone)).toBeNull();
            expect(clockOccurrence(c.at + shift, zone)).toBeNull();
            // A 15-minute meeting in the last quarter-hour before the change ends at the first
            // "after" instant: its range repeats a clock time, so it is described as spanning the change.
            expect(meetingOccurrence(c.at - 15 * MIN, c.at, zone)).toBe('during');
            // One that ends exactly as the repeated interval begins is ordinary at its start, "before" at its end.
            expect(meetingOccurrence(c.at - shift - 15 * MIN, c.at - shift, zone)).toBe('before');
          } else {
            // Clocks go forward: nothing repeats; a clock time in the gap does not exist and
            // resolves to the instant after the gap (Temporal "compatible").
            for (let t = c.at - 3 * 60 * MIN; t < c.at + 3 * 60 * MIN; t += 15 * MIN) {
              expect(clockOccurrence(t, zone)).toBeNull();
            }
            const firstAfter = getZonedParts(zone, c.at);
            const gapWall = { ...firstAfter, minute: firstAfter.minute };
            // The clock time one minute before the new offset's first reading never happens.
            const before = getZonedParts(zone, c.at - MIN);
            const missing = { ...gapWall, hour: before.hour, minute: before.minute + 1 };
            if (missing.minute === 60) {
              missing.minute = 0;
              missing.hour += 1;
            }
            const r = zonedTimeToInstant(zone, missing);
            expect(r.resolution).toBe('skipped');
            expect(r.instant).toBeGreaterThanOrEqual(c.at);
          }
        }
      });
    }
  }

  it('a meeting spanning the Los Angeles change is "during"; one inside either hour is not', () => {
    expect(meetingOccurrence(utc('2028-11-05T08:45:00Z'), utc('2028-11-05T09:00:00Z'), 'America/Los_Angeles')).toBe('during');
    expect(meetingOccurrence(utc('2028-11-05T08:15:00Z'), utc('2028-11-05T08:30:00Z'), 'America/Los_Angeles')).toBe('before');
    expect(meetingOccurrence(utc('2028-11-05T09:15:00Z'), utc('2028-11-05T09:30:00Z'), 'America/Los_Angeles')).toBe('after');
  });

  it('exports of both occurrences of a repeated Sydney time are an hour apart in UTC', () => {
    // 2:30 AM on Sun 4 Apr 2027 in Sydney: 15:30 UTC (AEDT) and 16:30 UTC (AEST).
    const first = utc('2027-04-03T15:30:00Z');
    const second = utc('2027-04-03T16:30:00Z');
    expect(formatTime(first, 'Australia/Sydney', '12h', 'en-US')).toBe('2:30 AM');
    expect(formatTime(second, 'Australia/Sydney', '12h', 'en-US')).toBe('2:30 AM');
    expect([clockOccurrence(first, 'Australia/Sydney'), clockOccurrence(second, 'Australia/Sydney')]).toEqual(['before', 'after']);
    const ics = (start: number) => buildIcs({ uid: 'x', slot: { start, end: start + 15 * MIN }, title: 't', description: 'd' });
    expect(ics(first)).toContain('\r\nDTSTART:20270403T153000Z\r\nDTEND:20270403T154500Z\r\n');
    expect(ics(second)).toContain('\r\nDTSTART:20270403T163000Z\r\nDTEND:20270403T164500Z\r\n');
  });
});

describe('dates across month, year and leap-day boundaries', () => {
  it('the same instant can be a different day, month and year in two zones', () => {
    // 2028-12-31 20:00 UTC: Sun 31 Dec, 12:00 PM in Los Angeles; Mon 1 Jan 2029, 5:00 AM in Tokyo.
    const t = utc('2028-12-31T20:00:00Z');
    expect(dateKey('America/Los_Angeles', t)).toBe('2028-12-31');
    expect(dateKey('Asia/Tokyo', t)).toBe('2029-01-01');
    expect(dateKey('Asia/Kathmandu', t)).toBe('2029-01-01'); // 01:45, a UTC+5:45 zone
    expect(getOffsetMinutes('Asia/Kathmandu', t)).toBe(345);
  });

  it('leap years: Feb 29 exists in 2028 only, and date arithmetic crosses it', () => {
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2027, 2)).toBe(28);
    expect(addDaysToKey('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysToKey('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDaysToKey('2028-12-31', 1)).toBe('2029-01-01');
    // Local midnight on 29 Feb 2028 in Adelaide (UTC+10:30, summer time) round-trips.
    const r = zonedTimeToInstant('Australia/Adelaide', { year: 2028, month: 2, day: 29, hour: 0, minute: 0 });
    expect(r.resolution).toBe('exact');
    expect(r.instant).toBe(utc('2028-02-28T13:30:00Z'));
  });
});

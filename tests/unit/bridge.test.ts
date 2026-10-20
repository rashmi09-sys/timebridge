import { describe, expect, it } from 'vitest';
import {
  buildBridgeContext,
  changeBeforeMeeting,
  describeDifference,
  nextGapChange,
  shortDifference,
  clockChangeDetail,
  clockChangeLine,
  compactDuration,
  hostTimeLine,
  hostTimeSpoken,
  labelHostDays,
  spokenDuration,
} from '../../src/lib/bridge';
import { generateSlots } from '../../src/lib/availability';
import { EVENT, SCHEDULE } from '../../src/lib/simulatedBookingService';

const utc = (s: string) => Date.parse(s);
const now = utc('2026-10-13T15:30:00Z'); // Tue 8:30 AM in Los Angeles, 9:00 PM in India
const windowEnd = now + 60 * 86_400_000;

function context(guestZone: string) {
  const slots = generateSlots(SCHEDULE, EVENT, now, utc('2026-11-01T07:00:00Z'), now);
  return buildBridgeContext({ hostFirstName: 'Arjun', hostZone: 'Asia/Kolkata', guestZone, reference: slots[0].start, windowEnd });
}

describe('TimeBridge context', () => {
  it('adds nothing when guest and host share a clock', () => {
    const c = context('Asia/Kolkata');
    expect(c.sameTime).toBe(true);
    expect(c.upcomingChange).toBeNull();
  });

  it('treats a legacy id for the same zone as the same clock', () => {
    expect(context('Asia/Calcutta').sameTime).toBe(true);
  });

  it('Los Angeles guest: 12½ h ahead, with the Nov 1 change disclosed', () => {
    const c = context('America/Los_Angeles');
    expect(c.short).toBe('12½ h ahead');
    expect(c.summary).toBe('Arjun is 12½ hours ahead of you');
    expect(c.upcomingChange).toMatchObject({ city: 'Los Angeles', day: 'Sun, Nov 1', direction: 'back', differenceAfter: 810 });
  });

  it('London guest: 4½ h ahead, gap becomes 5½ h on Oct 25', () => {
    const c = context('Europe/London');
    expect(c.short).toBe('4½ h ahead');
    expect(c.upcomingChange).toMatchObject({ city: 'London', day: 'Sun, Oct 25', differenceAfter: 330 });
  });

  it('quarter-hour zone: Kathmandu guest is ahead of the host', () => {
    expect(context('Asia/Kathmandu').short).toBe('15 min behind');
    expect(context('Asia/Kathmandu').summary).toBe('Arjun is 15 minutes behind you');
  });

  it('formats short differences', () => {
    expect(shortDifference(0)).toBe('same time');
    expect(shortDifference(-90)).toBe('1½ h behind');
    expect(shortDifference(345)).toBe('5 h 45 min ahead');
    expect(shortDifference(600)).toBe('10 h ahead');
    expect(describeDifference('Arjun', -90)).toBe('Arjun is 1½ hours behind you');
  });

  it('ignores clock changes already behind the time being viewed', () => {
    expect(
      nextGapChange({ hostZone: 'Asia/Kolkata', guestZone: 'America/Los_Angeles', from: utc('2026-11-03T00:00:00Z'), to: utc('2026-12-01T00:00:00Z') }),
    ).toBeNull();
  });

  it('flags a clock change between now and a chosen meeting, and only then', () => {
    const before = changeBeforeMeeting({ hostZone: 'Asia/Kolkata', guestZone: 'America/Los_Angeles', now, meeting: utc('2026-10-28T04:00:00Z') });
    expect(before).toBeNull();
    const after = changeBeforeMeeting({ hostZone: 'Asia/Kolkata', guestZone: 'America/Los_Angeles', now, meeting: utc('2026-11-03T04:00:00Z') });
    expect(after?.day).toBe('Sun, Nov 1');
  });
});

describe('host-time line', () => {
  it('compact visible form', () => {
    expect(hostTimeLine('Arjun', 750)).toBe('Arjun’s time is 12h 30m ahead');
    expect(hostTimeLine('Arjun', 810)).toBe('Arjun’s time is 13h 30m ahead');
    expect(hostTimeLine('Arjun', -15)).toBe('Arjun’s time is 15m behind');
    expect(hostTimeLine('Arjun', 0)).toBe('Arjun’s time is the same as yours');
    expect(compactDuration(345)).toBe('5h 45m');
    expect(compactDuration(60)).toBe('1h');
    expect(compactDuration(600)).toBe('10h');
  });

  it('written-out form for screen readers', () => {
    expect(hostTimeSpoken('Arjun', 750)).toBe('Arjun’s time is 12 hours 30 minutes ahead of yours');
    expect(hostTimeSpoken('Arjun', -15)).toBe('Arjun’s time is 15 minutes behind yours');
    expect(spokenDuration(60)).toBe('1 hour');
    expect(spokenDuration(61)).toBe('1 hour 1 minute');
  });
});

describe('clock-change line and detail', () => {
  const change = (guestZone: string) =>
    nextGapChange({
      hostZone: 'Asia/Kolkata',
      guestZone,
      from: Date.parse('2026-10-13T15:30:00Z'),
      to: Date.parse('2026-12-01T00:00:00Z'),
    })!;

  it('London: short line, plain detail', () => {
    expect(clockChangeLine(change('Europe/London'))).toBe('Time difference changes on Oct 25');
    expect(clockChangeDetail(change('Europe/London'), 'Arjun')).toBe(
      'Clocks in London go back an hour on Oct 25. From then, Arjun’s time is 5h 30m ahead.',
    );
  });

  it('Los Angeles', () => {
    expect(clockChangeLine(change('America/Los_Angeles'))).toBe('Time difference changes on Nov 1');
    expect(clockChangeDetail(change('America/Los_Angeles'), 'Arjun')).toBe(
      'Clocks in Los Angeles go back an hour on Nov 1. From then, Arjun’s time is 13h 30m ahead.',
    );
  });

  it('a host-side change in a non-hour amount reads correctly (Lord Howe, 30 minutes)', () => {
    const c = nextGapChange({
      hostZone: 'Australia/Lord_Howe',
      guestZone: 'Asia/Kolkata',
      from: Date.parse('2026-09-01T00:00:00Z'),
      to: Date.parse('2026-11-01T00:00:00Z'),
    })!;
    expect(c.city).toBe('Lord Howe');
    expect(clockChangeDetail(c, 'Arjun')).toBe(
      // 2:00 AM Oct 4 in Lord Howe is still Oct 3 on the India guest's calendar; dates follow the guest.
      'Clocks in Lord Howe go forward 30 minutes on Oct 3. From then, Arjun’s time is 5h 30m ahead.',
    );
  });
});

describe('host-date labels for a time list', () => {
  const day = (guestZone: string, key: string) =>
    // Same page clock as the app's demo (Tue 13 Oct, 8:30 AM in Los Angeles), so minimum notice applies.
    generateSlots(SCHEDULE, EVENT, now, Date.parse('2026-12-31T00:00:00Z'), now)
      .map((s) => s.start)
      .filter((t) => new Intl.DateTimeFormat('en-CA', { timeZone: guestZone }).format(t) === key);

  it('every host time on one other date: said once, in the header', () => {
    const l = labelHostDays(day('America/Los_Angeles', '2026-10-13'), 'Asia/Kolkata', '2026-10-13');
    expect(l.shared).toBe('Wed 14');
    expect(l.rows.every((r) => r.short === null)).toBe(true);
    expect(l.rows.every((r) => r.spoken === 'Wednesday, October 14')).toBe(true);
  });

  it('mixed dates: only rows on another date carry a label', () => {
    const starts = day('America/Los_Angeles', '2026-10-14');
    const l = labelHostDays(starts, 'Asia/Kolkata', '2026-10-14');
    expect(l.shared).toBeNull();
    const hours = starts.map((t) => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hourCycle: 'h23' }).format(t)));
    l.rows.forEach((r, i) => {
      // Before 11:30 AM in LA it is still Wednesday in India; evening times are Thursday.
      const thursday = hours[i] >= 11;
      expect(r.short).toBe(thursday ? 'Thu 15' : null);
      expect(r.spoken).toBe(thursday ? 'Thursday, October 15' : null);
    });
  });

  it('same date for both: nothing to label', () => {
    const l = labelHostDays(day('Asia/Kolkata', '2026-10-14'), 'Asia/Kolkata', '2026-10-14');
    expect(l.shared).toBeNull();
    expect(l.rows.every((r) => r.short === null && r.spoken === null)).toBe(true);
  });

  it('after the US clock change, the next-day boundary moves to 7:30 PM (13½ h gap)', () => {
    const starts = day('America/Los_Angeles', '2026-11-02');
    const l = labelHostDays(starts, 'Asia/Kolkata', '2026-11-02');
    expect(l.shared).toBeNull();
    const first = l.rows.findIndex((r) => r.short !== null);
    // Early-morning LA times are Mon Nov 2 afternoon in India: same date, no label.
    expect(l.rows.slice(0, first).every((r) => r.short === null && r.spoken === null)).toBe(true);
    expect(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', timeStyle: 'short' }).format(starts[first])).toBe('7:30 PM');
    expect(l.rows[first]).toEqual({ short: 'Tue 3', spoken: 'Tuesday, November 3' });
  });

  it('weekday names come from Intl, so they follow the locale', () => {
    const l = labelHostDays(day('America/Los_Angeles', '2026-10-13'), 'Asia/Kolkata', '2026-10-13', 'fr-FR');
    expect(l.shared).toBe('mer. 14');
    expect(l.rows[0].spoken).toBe('mercredi 14 octobre');
  });

  it('an empty list has no labels', () => {
    expect(labelHostDays([], 'Asia/Kolkata', '2026-10-14')).toEqual({ shared: null, rows: [] });
  });
});

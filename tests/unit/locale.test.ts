import { describe, expect, it } from 'vitest';
import {
  clockChangeLine,
  labelHostDays,
  meetingOccurrence,
  nextGapChange,
  OCCURRENCE_TEXT,
  spokenClockTime,
} from '../../src/lib/bridge';
import {
  clockOccurrence,
  formatKeyDate,
  formatTime,
  monthYearParts,
  repeatedTime,
  spokenUtcOffset,
  weekdayAndDay,
  weekdayNames,
  zoneGenericName,
} from '../../src/lib/time';

const LA = 'America/Los_Angeles';
// Sun 1 Nov 2026: clocks in Los Angeles go back at 2:00 AM PDT (09:00 UTC), so 1:00–1:59 AM happens twice.
const FIRST_130 = Date.parse('2026-11-01T08:30:00Z'); // 1:30 AM PDT (UTC−7)
const SECOND_130 = Date.parse('2026-11-01T09:30:00Z'); // 1:30 AM PST (UTC−8)

describe('repeated local times when clocks go back', () => {
  it('detects the repeated hour and says which occurrence an instant is', () => {
    expect(repeatedTime(FIRST_130, LA, 'en-US')).toEqual({ earlier: 'PDT', later: 'PST', isLater: false });
    expect(repeatedTime(SECOND_130, LA, 'en-US')).toEqual({ earlier: 'PDT', later: 'PST', isLater: true });
  });

  it('does not flag times that happen once (before, after, and on ordinary days)', () => {
    expect(repeatedTime(Date.parse('2026-11-01T07:30:00Z'), LA)).toBeNull(); // 12:30 AM PDT
    expect(repeatedTime(Date.parse('2026-11-01T10:30:00Z'), LA)).toBeNull(); // 2:30 AM PST
    expect(repeatedTime(Date.parse('2026-10-31T08:30:00Z'), LA)).toBeNull(); // Sat 1:30 AM
    expect(repeatedTime(Date.parse('2026-11-01T08:30:00Z'), 'Asia/Kolkata')).toBeNull(); // no DST
  });

  it('does not flag the skipped hour when clocks go forward (it never appears as a label)', () => {
    // Sun 8 Mar 2026, 3:30 AM PDT = 10:30 UTC; the label 2:30 AM does not exist that day.
    expect(repeatedTime(Date.parse('2026-03-08T10:30:00Z'), LA)).toBeNull();
  });

  // What a guest sees for a time: the plain clock time, plus the occurrence words only when it repeats.
  const shown = (t: number, zone: string, cycle: '12h' | '24h', locale = 'en-US') => {
    const occurrence = clockOccurrence(t, zone);
    return [formatTime(t, zone, cycle, locale), occurrence && OCCURRENCE_TEXT[occurrence]].filter(Boolean).join(' · ');
  };

  it('the visible time is the plain clock time; the occurrence words tell the two apart', () => {
    expect(formatTime(FIRST_130, LA, '12h', 'en-US')).toBe('1:30 AM');
    expect(formatTime(SECOND_130, LA, '12h', 'en-US')).toBe('1:30 AM');
    expect(shown(FIRST_130, LA, '12h')).toBe('1:30 AM · Before clocks change');
    expect(shown(SECOND_130, LA, '12h')).toBe('1:30 AM · After clocks change');
    expect(shown(FIRST_130, LA, '24h')).toBe('01:30 · Before clocks change');
    expect(shown(SECOND_130, LA, '24h')).toBe('01:30 · After clocks change');
    // No abbreviations in any visible label.
    for (const t of [FIRST_130, SECOND_130]) expect(shown(t, LA, '12h')).not.toMatch(/P[DS]T|GMT/);
    // Unaffected times are unchanged.
    expect(shown(Date.parse('2026-11-01T10:30:00Z'), LA, '12h')).toBe('2:30 AM');
  });

  it('every minute of the repeated hour is distinct once its occurrence is stated, and the boundaries are exact', () => {
    const labels = new Set<string>();
    for (let t = Date.parse('2026-11-01T08:00:00Z'); t < Date.parse('2026-11-01T10:00:00Z'); t += 15 * 60_000) {
      labels.add(shown(t, LA, '12h'));
    }
    expect(labels.size).toBe(8);
    expect(shown(Date.parse('2026-11-01T07:59:00Z'), LA, '12h')).toBe('12:59 AM');
    expect(shown(Date.parse('2026-11-01T08:00:00Z'), LA, '12h')).toBe('1:00 AM · Before clocks change');
    expect(shown(Date.parse('2026-11-01T08:59:00Z'), LA, '12h')).toBe('1:59 AM · Before clocks change');
    expect(shown(Date.parse('2026-11-01T09:00:00Z'), LA, '12h')).toBe('1:00 AM · After clocks change');
    expect(shown(Date.parse('2026-11-01T09:59:00Z'), LA, '12h')).toBe('1:59 AM · After clocks change');
    expect(shown(Date.parse('2026-11-01T10:00:00Z'), LA, '12h')).toBe('2:00 AM');
  });

  it('screen readers hear the occurrence and the UTC offset', () => {
    expect(spokenClockTime('1:30 AM', FIRST_130, LA)).toBe('1:30 AM, before clocks change, UTC minus 7');
    expect(spokenClockTime('1:30 AM', SECOND_130, LA)).toBe('1:30 AM, after clocks change, UTC minus 8');
    expect(spokenClockTime('2:30 AM', Date.parse('2026-11-01T10:30:00Z'), LA)).toBe('2:30 AM');
    expect(spokenUtcOffset('Asia/Kolkata', FIRST_130)).toBe('UTC plus 5:30');
    expect(spokenUtcOffset('Europe/London', Date.parse('2026-12-01T12:00:00Z'))).toBe('UTC');
  });

  it('a meeting range says which occurrence, including one that spans the change', () => {
    const at = (s: string) => Date.parse(s);
    // 1:15–1:30 before (PDT) and after (PST); 1:45 AM PDT – 1:00 AM PST spans the change.
    expect(meetingOccurrence(at('2026-11-01T08:15:00Z'), at('2026-11-01T08:30:00Z'), LA)).toBe('before');
    expect(meetingOccurrence(at('2026-11-01T09:15:00Z'), at('2026-11-01T09:30:00Z'), LA)).toBe('after');
    expect(meetingOccurrence(at('2026-11-01T08:45:00Z'), at('2026-11-01T09:00:00Z'), LA)).toBe('during');
    // 12:45–1:00 AM ends on the first 1:00; 1:45–2:00 AM starts on the second 1:45.
    expect(meetingOccurrence(at('2026-11-01T07:45:00Z'), at('2026-11-01T08:00:00Z'), LA)).toBe('before');
    expect(meetingOccurrence(at('2026-11-01T09:45:00Z'), at('2026-11-01T10:00:00Z'), LA)).toBe('after');
    expect(meetingOccurrence(at('2026-11-01T10:15:00Z'), at('2026-11-01T10:30:00Z'), LA)).toBeNull();
    expect(OCCURRENCE_TEXT.during).toBe('Clocks go back during this meeting');
  });

  it('the abbreviations behind the scenes still follow the locale (not shown, but used to detect repeats)', () => {
    // London, Sun 25 Oct 2026: 1:30 AM BST (00:30 UTC), then 1:30 AM GMT (01:30 UTC).
    const london = ['2026-10-25T00:30:00Z', '2026-10-25T01:30:00Z'].map((s) => Date.parse(s));
    expect(repeatedTime(london[0], 'Europe/London', 'en-GB')).toEqual({ earlier: 'BST', later: 'GMT', isLater: false });
    expect(repeatedTime(london[1], 'Europe/London', 'en-US')).toEqual({ earlier: 'GMT+1', later: 'GMT', isLater: true });
    expect(london.map((t) => shown(t, 'Europe/London', '24h', 'en-GB'))).toEqual([
      '1:30 · Before clocks change',
      '1:30 · After clocks change',
    ]);
    expect(shown(SECOND_130, LA, '12h', 'ja-JP')).toBe('午前1:30 · After clocks change');
  });

  it('a half-hour zone (Lord Howe) repeats 1:30–2:00 and is distinguished too', () => {
    // Lord Howe goes from UTC+11 to UTC+10:30 at 2:00 AM on Sun 5 Apr 2026 (15:00 UTC Apr 4).
    const a = Date.parse('2026-04-04T14:40:00Z'); // 1:40 AM +11
    const b = Date.parse('2026-04-04T15:10:00Z'); // 1:40 AM +10:30
    expect(shown(a, 'Australia/Lord_Howe', '24h')).toBe('01:40 · Before clocks change');
    expect(shown(b, 'Australia/Lord_Howe', '24h')).toBe('01:40 · After clocks change');
    expect(spokenUtcOffset('Australia/Lord_Howe', b)).toBe('UTC plus 10:30');
  });
});

describe('locale-aware dates and times (en-US, en-GB, ja-JP)', () => {
  const t = Date.parse('2026-10-15T13:45:00Z'); // 7:15 PM on Thu 15 Oct in Bengaluru
  const key = '2026-10-15';

  it('times follow the locale and the chosen hour cycle', () => {
    expect(formatTime(t, 'Asia/Kolkata', '12h', 'en-US')).toBe('7:15 PM');
    expect(formatTime(t, 'Asia/Kolkata', '24h', 'en-US')).toBe('19:15');
    expect(formatTime(t, 'Asia/Kolkata', '12h', 'en-GB')).toBe('7:15 pm');
    expect(formatTime(t, 'Asia/Kolkata', '24h', 'en-GB')).toBe('19:15');
    expect(formatTime(t, 'Asia/Kolkata', '12h', 'ja-JP')).toBe('午後7:15');
    expect(formatTime(t, 'Asia/Kolkata', '24h', 'ja-JP')).toBe('19:15');
  });

  it('never returns the narrow no-break space some engines put before AM/PM', () => {
    for (const locale of ['en-US', 'en-GB', 'ja-JP']) {
      expect(formatTime(t, 'Asia/Kolkata', '12h', locale)).not.toMatch(/[\u202f\u2009]/);
    }
  });

  it('long dates without a year, in each locale’s order', () => {
    expect(formatKeyDate(key, 'longNoYear', 'en-US')).toBe('Thursday, October 15');
    expect(formatKeyDate(key, 'longNoYear', 'en-GB')).toBe('Thursday 15 October');
    expect(formatKeyDate(key, 'longNoYear', 'ja-JP')).toBe('10月15日木曜日');
  });

  it('short month-day dates', () => {
    expect(formatKeyDate('2026-11-01', 'monthDay', 'en-US')).toBe('Nov 1');
    expect(formatKeyDate('2026-11-01', 'monthDay', 'en-GB')).toBe('1 Nov');
    expect(formatKeyDate('2026-11-01', 'monthDay', 'ja-JP')).toBe('11月1日');
  });

  it('time-list heading parts: weekday and day number from Intl', () => {
    expect(weekdayAndDay(key, 'en-US')).toEqual({ weekday: 'Thu', day: '15' });
    expect(weekdayAndDay(key, 'en-GB')).toEqual({ weekday: 'Thu', day: '15' });
    expect(weekdayAndDay(key, 'ja-JP')).toEqual({ weekday: '木', day: '15日' });
  });

  it('month title parts mark the year wherever the locale puts it', () => {
    const text = (locale: string) => monthYearParts('2026-10-01', locale);
    expect(text('en-US').map((p) => p.text).join('')).toBe('October 2026');
    expect(text('en-US').filter((p) => p.isYear).map((p) => p.text)).toEqual(['2026']);
    expect(text('ja-JP').map((p) => p.text).join('')).toBe('2026年10月');
    expect(text('ja-JP')[0]).toEqual({ text: '2026', isYear: true });
  });

  it('weekday headers start on Sunday and are localized', () => {
    expect(weekdayNames('en-US').map((d) => d.short)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    expect(weekdayNames('en-GB')[1]).toEqual({ short: 'Mon', long: 'Monday' });
    expect(weekdayNames('ja-JP').map((d) => d.short)).toEqual(['日', '月', '火', '水', '木', '金', '土']);
  });

  it('zone names stay in English, like the sentences around them', () => {
    expect(zoneGenericName('America/Los_Angeles', t)).toBe('Pacific Time');
  });

  it('host-day labels use the requested locale', () => {
    // 11:30 PM Wed 14 Oct in LA is Thu 15 Oct in India.
    const start = Date.parse('2026-10-15T06:30:00Z');
    expect(labelHostDays([start], 'Asia/Kolkata', '2026-10-14', 'en-GB')).toEqual({
      shared: 'Thu 15',
      rows: [{ short: null, spoken: 'Thursday 15 October' }],
    });
    expect(labelHostDays([start], 'Asia/Kolkata', '2026-10-14', 'ja-JP').rows[0].spoken).toBe('10月15日木曜日');
  });

  it('the clock-change line no longer depends on English date punctuation', () => {
    const change = nextGapChange({
      hostZone: 'Asia/Kolkata',
      guestZone: LA,
      from: Date.parse('2026-10-13T15:30:00Z'),
      to: Date.parse('2026-11-30T00:00:00Z'),
    });
    expect(change && clockChangeLine(change)).toBe('Time difference changes on Nov 1');
  });
});

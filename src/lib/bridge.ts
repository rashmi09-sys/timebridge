import {
  clockOccurrence,
  dateKey,
  dayShift,
  findOffsetChanges,
  formatDuration,
  formatKeyDate,
  offsetDifference,
  getFormatLocale,
  spokenUtcOffset,
  zoneCity,
} from './time';
import type { Instant } from '../types';

/**
 * Pure logic behind every TimeBridge sentence. Kept separate from React so each
 * word the UI shows can be unit-tested.
 */

export interface ClockChange {
  at: Instant;
  /** City whose clocks change ("Los Angeles"). */
  city: string;
  /** "Sun, Nov 1" in the guest's calendar. */
  day: string;
  /** "Nov 1" in the guest's calendar. */
  shortDay: string;
  direction: 'back' | 'forward';
  /** Host-minus-guest difference after the change, in minutes. */
  differenceAfter: number;
  /** Host-minus-guest difference just before the change, in minutes. */
  differenceBefore: number;
}

export interface BridgeContext {
  /** Same offset and no upcoming change → the UI adds nothing. */
  sameTime: boolean;
  /** Minutes the host is ahead of the guest (negative = behind). */
  differenceMinutes: number;
  /** "12½ h ahead" */
  short: string;
  /** "Arjun is 12½ hours ahead of you" (announcements, screen readers) */
  summary: string;
  /** The next change to the gap after the time being viewed, within the booking window. */
  upcomingChange: ClockChange | null;
}

export function describeDifference(hostFirstName: string, minutes: number): string {
  if (minutes === 0) return `${hostFirstName} is on the same time as you`;
  return `${hostFirstName} is ${formatDuration(minutes)} ${minutes > 0 ? 'ahead of' : 'behind'} you`;
}

/** "12½ h ahead", "15 min behind", "5 h 45 min ahead", "same time" */
export function shortDifference(minutes: number): string {
  if (minutes === 0) return 'same time';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const amount = h === 0 ? `${m} min` : m === 0 ? `${h} h` : m === 30 ? `${h}½ h` : `${h} h ${m} min`;
  return `${amount} ${minutes > 0 ? 'ahead' : 'behind'}`;
}

export function buildBridgeContext(args: {
  hostFirstName: string;
  hostZone: string;
  guestZone: string;
  reference: Instant;
  windowEnd: Instant;
}): BridgeContext {
  const { hostFirstName, hostZone, guestZone, reference, windowEnd } = args;
  const differenceMinutes = offsetDifference(guestZone, hostZone, reference);
  const upcomingChange = nextGapChange({ hostZone, guestZone, from: reference, to: windowEnd });
  return {
    sameTime: differenceMinutes === 0 && !upcomingChange,
    differenceMinutes,
    short: shortDifference(differenceMinutes),
    summary: describeDifference(hostFirstName, differenceMinutes),
    upcomingChange,
  };
}

/**
 * The first clock change in either zone, strictly after `from` and up to `to`,
 * that alters the host/guest difference.
 */
export function nextGapChange(args: { hostZone: string; guestZone: string; from: Instant; to: Instant }): ClockChange | null {
  const { hostZone, guestZone, from, to } = args;
  if (to <= from) return null;
  const changes = [...findOffsetChanges(guestZone, from, to), ...findOffsetChanges(hostZone, from, to)].sort(
    (a, b) => a.at - b.at,
  );
  for (const c of changes) {
    if (c.at <= from) continue;
    const after = offsetDifference(guestZone, hostZone, c.at);
    const before = offsetDifference(guestZone, hostZone, c.at - 60_000);
    if (after === before) continue;
    return {
      at: c.at,
      city: zoneCity(c.zone),
      day: formatKeyDate(dateKey(guestZone, c.at), 'medium'),
      shortDay: formatKeyDate(dateKey(guestZone, c.at), 'monthDay'),
      direction: c.toMinutes < c.fromMinutes ? 'back' : 'forward',
      differenceAfter: after,
      differenceBefore: before,
    };
  }
  return null;
}

/** "12h 30m", "13h 30m", "5h 45m", "1h", "15m": compact, for the one-line difference. */
export function compactDuration(minutes: number): string {
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** "12 hours 30 minutes": the same amount written out for screen readers. */
export function spokenDuration(minutes: number): string {
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const hours = h === 0 ? '' : `${h} ${h === 1 ? 'hour' : 'hours'}`;
  const mins = m === 0 ? '' : `${m} ${m === 1 ? 'minute' : 'minutes'}`;
  return [hours, mins].filter(Boolean).join(' ') || '0 minutes';
}

/** Visible line: "Arjun’s time is 12h 30m ahead". */
export function hostTimeLine(hostFirstName: string, minutes: number): string {
  if (minutes === 0) return `${hostFirstName}’s time is the same as yours`;
  return `${hostFirstName}’s time is ${compactDuration(minutes)} ${minutes > 0 ? 'ahead' : 'behind'}`;
}

/** Spoken form of the same line: "Arjun’s time is 12 hours 30 minutes ahead of yours". */
export function hostTimeSpoken(hostFirstName: string, minutes: number): string {
  if (minutes === 0) return `${hostFirstName}’s time is the same as yours`;
  return `${hostFirstName}’s time is ${spokenDuration(minutes)} ${minutes > 0 ? 'ahead of' : 'behind'} yours`;
}

/** Short line, shown only when a clock change affects the chosen date: "Time difference changes on Nov 1". */
export function clockChangeLine(change: ClockChange): string {
  return `Time difference changes on ${change.shortDay}`;
}

/**
 * The plain-language detail behind that line:
 * "Clocks in Los Angeles go back an hour on Nov 1. From then, Arjun’s time is 13h 30m ahead."
 */
export function clockChangeDetail(change: ClockChange, hostFirstName: string): string {
  const shift = Math.abs(change.differenceAfter - change.differenceBefore);
  const amount = shift === 60 ? 'an hour' : spokenDuration(shift);
  const date = change.shortDay;
  return `Clocks in ${change.city} go ${change.direction} ${amount} on ${date}. From then, ${hostTimeLine(
    hostFirstName,
    change.differenceAfter,
  )}.`;
}

/** Shown once above a time list that contains repeated clock times; never for a DST day without them. */
export const REPEATED_TIMES_NOTE = 'Clocks go back on this day. Some times appear twice.';

export type Occurrence = 'before' | 'after' | 'during';

/** Plain words for which of two identical clock times is meant. No zone abbreviations. */
export const OCCURRENCE_TEXT: Record<Occurrence, string> = {
  before: 'Before clocks change',
  after: 'After clocks change',
  during: 'Clocks go back during this meeting',
};

/**
 * Which occurrence a meeting is, judged from both ends: a meeting that starts in the first
 * 1:45 AM ends at the second 1:00 AM, so its range ("1:45 AM – 1:00 AM") needs "during".
 * Null when neither end is a repeated clock time.
 */
export function meetingOccurrence(start: Instant, end: Instant, timeZone: string): Occurrence | null {
  const ends = new Set([clockOccurrence(start, timeZone), clockOccurrence(end, timeZone)]);
  ends.delete(null);
  if (ends.size === 0) return null;
  if (ends.size === 2) return 'during';
  return [...ends][0];
}

/** Screen-reader words for one time: "1:15 AM, after clocks change, UTC minus 8". Ordinary times are unchanged. */
export function spokenClockTime(time: string, instant: Instant, timeZone: string): string {
  const occurrence = clockOccurrence(instant, timeZone);
  if (!occurrence) return time;
  return `${time}, ${OCCURRENCE_TEXT[occurrence].toLowerCase()}, ${spokenUtcOffset(timeZone, instant)}`;
}

export interface HostDayLabels {
  /** The host's date when every time in the list falls on it and it isn't the guest's date ("Wed 14"); else null. */
  shared: string | null;
  /** Per time, in order. */
  rows: Array<{
    /** Short host date ("Thu 15") when it isn't already stated by the guest's date or `shared`; else null. */
    short: string | null;
    /** Full host date ("Thursday, October 15") for screen readers when it differs from the guest's date; else null. */
    spoken: string | null;
  }>;
}

/**
 * Which host dates a time list needs to show. The calendar date is always the guest's, so a
 * host date is written only where it differs: once in the column header if every time shares
 * it, otherwise on the rows that differ. Screen readers always hear a differing host date.
 */
export function labelHostDays(
  starts: Instant[],
  hostZone: string,
  guestDateKey: string,
  locale = getFormatLocale(),
): HostDayLabels {
  const keys = starts.map((t) => dateKey(hostZone, t));
  const unique = Array.from(new Set(keys));
  const sharedKey = unique.length === 1 && unique[0] !== guestDateKey ? unique[0] : null;
  const reference = sharedKey ?? guestDateKey;
  // Written without a year by Intl itself, so it reads correctly in any locale.
  const longDate = (key: string) => formatKeyDate(key, 'longNoYear', locale);
  return {
    shared: sharedKey && formatKeyDate(sharedKey, 'weekdayDay', locale),
    rows: keys.map((key) => ({
      short: key !== reference ? formatKeyDate(key, 'weekdayDay', locale) : null,
      spoken: key !== guestDateKey ? longDate(key) : null,
    })),
  };
}

/**
 * For a chosen meeting: a clock change between now and the meeting that the
 * guest might not expect. The displayed times already account for it.
 */
export function changeBeforeMeeting(args: {
  hostZone: string;
  guestZone: string;
  now: Instant;
  meeting: Instant;
}): ClockChange | null {
  return nextGapChange({ hostZone: args.hostZone, guestZone: args.guestZone, from: args.now, to: args.meeting });
}

export { dayShift };

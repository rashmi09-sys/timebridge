/**
 * Time-zone primitives built only on the platform's IANA database (Intl).
 * Nothing in here adds fixed UTC offsets: every offset is looked up for the
 * exact instant, so DST transitions, half-hour and quarter-hour zones work.
 */

import type { HourCycle, Instant } from '../types';

export type { HourCycle, Instant };

/* ------------------------------------------------------------------ */
/* Locale                                                              */
/* ------------------------------------------------------------------ */

/** The browser's formatting locale ("en-US", "en-GB", "ja-JP"), from Intl itself. */
export function detectLocale(): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().locale || 'en-US';
  } catch {
    return 'en-US';
  }
}

let formatLocale = detectLocale();

/**
 * Dates and times follow the browser's locale; interface copy and zone names stay in English
 * (the copy is not translated, and a translated zone name inside an English sentence reads badly).
 */
export function getFormatLocale(): string {
  return formatLocale;
}

/** For tests, which pin a locale instead of depending on the machine's. */
export function setFormatLocale(locale: string): void {
  formatLocale = locale;
}

/**
 * Engines disagree on the space before "AM": some ICU versions emit U+202F (narrow no-break
 * space) or U+2009, others a plain space. Normalising keeps labels identical in every browser.
 */
function plain(text: string): string {
  return text.replace(/[\u202f\u2009]/g, ' ');
}

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  weekday: number; // 0 = Sunday
}

/**
 * Intl.DateTimeFormat construction is far slower than formatting, and a time list formats
 * dozens of times per render (measured: ~13 ms for 40 slots without caching). Formatters are
 * immutable, so one per locale + options is reused.
 */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function dtf(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = formatterCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options);
    formatterCache.set(key, f);
  }
  return f;
}

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsFormatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
    });
    partsFormatterCache.set(timeZone, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function getZonedParts(timeZone: string, instant: Instant): ZonedParts & { second: number } {
  const out: Record<string, string> = {};
  for (const p of partsFormatter(timeZone).formatToParts(new Date(instant))) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: WEEKDAYS[out.weekday],
  };
}

/** Offset of `timeZone` from UTC at `instant`, in minutes (IST = +330). */
export function getOffsetMinutes(timeZone: string, instant: Instant): number {
  const p = getZonedParts(timeZone, instant);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const flooredInstant = Math.floor(instant / 1000) * 1000;
  return Math.round((asUtc - flooredInstant) / 60000);
}

export interface WallTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

export type Resolution = 'exact' | 'ambiguous' | 'skipped';

/**
 * Converts a wall-clock time in `timeZone` to an instant.
 * Mirrors Temporal's "compatible" disambiguation:
 *  - ambiguous (clocks go back, time happens twice) → the earlier instant
 *  - skipped (clocks go forward, time never happens) → shifted forward by the gap
 */
export function zonedTimeToInstant(
  timeZone: string,
  wall: WallTime,
): { instant: Instant; resolution: Resolution; later?: Instant } {
  const localAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  const DAY = 86_400_000;
  const before = getOffsetMinutes(timeZone, localAsUtc - DAY);
  const after = getOffsetMinutes(timeZone, localAsUtc + DAY);
  const candidates = Array.from(new Set([before, after]))
    .map((offset) => localAsUtc - offset * 60_000)
    .filter((t) => matchesWall(timeZone, t, wall))
    .sort((a, b) => a - b);

  if (candidates.length === 1) return { instant: candidates[0], resolution: 'exact' };
  if (candidates.length > 1) return { instant: candidates[0], resolution: 'ambiguous', later: candidates[candidates.length - 1] };
  // Gap: interpret with the offset in force before the transition, which lands after it.
  return { instant: localAsUtc - before * 60_000, resolution: 'skipped' };
}

function matchesWall(timeZone: string, instant: Instant, wall: WallTime): boolean {
  const p = getZonedParts(timeZone, instant);
  return (
    p.year === wall.year &&
    p.month === wall.month &&
    p.day === wall.day &&
    p.hour === wall.hour &&
    p.minute === wall.minute
  );
}

/** Calendar date key (YYYY-MM-DD) of an instant as seen in `timeZone`. */
export function dateKey(timeZone: string, instant: Instant): string {
  const p = getZonedParts(timeZone, instant);
  return toKey(p.year, p.month, p.day);
}

export function toKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseKey(key: string): { year: number; month: number; day: number } {
  const [year, month, day] = key.split('-').map(Number);
  return { year, month, day };
}

/** Pure calendar arithmetic on date keys (no time zone involved). */
export function addDaysToKey(key: string, days: number): string {
  const { year, month, day } = parseKey(key);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return toKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function daysBetweenKeys(a: string, b: string): number {
  const pa = parseKey(a);
  const pb = parseKey(b);
  return Math.round((Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) / 86_400_000);
}

export function weekdayOfKey(key: string): number {
  const { year, month, day } = parseKey(key);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Instant at which the given calendar day starts in `timeZone` (handles days that start at 01:00). */
export function startOfDay(timeZone: string, key: string): Instant {
  const { year, month, day } = parseKey(key);
  return zonedTimeToInstant(timeZone, { year, month, day, hour: 0, minute: 0 }).instant;
}

/* ------------------------------------------------------------------ */
/* Naming                                                              */
/* ------------------------------------------------------------------ */

/**
 * Browsers still report some legacy IANA identifiers (e.g. Asia/Calcutta,
 * Europe/Kiev). We keep the identifier for calculations and only map it to the
 * current spelling for display.
 */
const LEGACY_DISPLAY_NAMES: Record<string, string> = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Rangoon': 'Asia/Yangon',
  'Europe/Kiev': 'Europe/Kyiv',
  'America/Godthab': 'America/Nuuk',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Pacific/Ponape': 'Pacific/Pohnpei',
  'Pacific/Truk': 'Pacific/Chuuk',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
};

export function canonicalZoneName(timeZone: string): string {
  return LEGACY_DISPLAY_NAMES[timeZone] ?? timeZone;
}

/** "Los Angeles", "Kolkata", "Buenos Aires" */
export function zoneCity(timeZone: string): string {
  const name = canonicalZoneName(timeZone);
  const last = name.split('/').pop() ?? name;
  return last.replace(/_/g, ' ');
}

/** "Pacific Time", "India Standard Time" — the generic name people recognise. English, like the copy around it. */
export function zoneGenericName(timeZone: string, instant: Instant, locale = 'en-US'): string {
  const parts = dtf(locale, { timeZone, timeZoneName: 'longGeneric' }).formatToParts(
    new Date(instant),
  );
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  // Some zones have no localized name and come back as "GMT+05:45"; prefer the city then.
  return /^GMT[+-]?/.test(name) ? `${zoneCity(timeZone)} time` : name;
}

/** "GMT+5:30", "GMT-7", "GMT+5:45", "GMT" */
export function formatOffset(minutes: number): string {
  if (minutes === 0) return 'GMT';
  const sign = minutes > 0 ? '+' : '−';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `GMT${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

/** "12½ hours", "1 hour", "5 hours 45 minutes", "30 minutes" */
export function formatDuration(minutes: number): string {
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (m === 0) return `${h} ${h === 1 ? 'hour' : 'hours'}`;
  if (m === 30 && h > 0) return `${h}½ hours`;
  if (h === 0) return `${m} minutes`;
  return `${h} ${h === 1 ? 'hour' : 'hours'} ${m} minutes`;
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

/**
 * When clocks go back, one wall-clock time names two instants. For such a time, the short
 * zone names that tell them apart ("PDT" then "PST"), and which of the two `instant` is.
 * Null when the time happens once.
 */
export function repeatedTime(
  instant: Instant,
  timeZone: string,
  locale = formatLocale,
): { earlier: string; later: string; isLater: boolean } | null {
  const r = zonedTimeToInstant(timeZone, getZonedParts(timeZone, instant));
  if (r.resolution !== 'ambiguous' || r.later == null) return null;
  let earlier = zoneAbbreviation(timeZone, r.instant, locale);
  let later = zoneAbbreviation(timeZone, r.later, locale);
  // Some locales give both instants the same short name; the UTC offsets always differ.
  if (earlier === later) {
    earlier = formatOffset(getOffsetMinutes(timeZone, r.instant));
    later = formatOffset(getOffsetMinutes(timeZone, r.later));
  }
  return { earlier, later, isLater: instant >= r.later };
}

/** Whether any of these instants falls in an hour the guest's clock repeats (and is therefore labelled PDT/PST). */
export function hasRepeatedTimes(starts: readonly Instant[], timeZone: string): boolean {
  return starts.some((t) => repeatedTime(t, timeZone) != null);
}

/** Short zone name at an instant, as the locale writes it: "PDT", "PST", "GMT+1", "BST". */
export function zoneAbbreviation(timeZone: string, instant: Instant, locale = formatLocale): string {
  const parts = dtf(locale, { timeZone, timeZoneName: 'short' }).formatToParts(new Date(instant));
  return plain(parts.find((p) => p.type === 'timeZoneName')?.value ?? formatOffset(getOffsetMinutes(timeZone, instant)));
}

/**
 * "9:00 AM", "21:00", "午前9:00": the clock time only. When clocks go back, two instants can
 * share this label; callers tell them apart with `clockOccurrence` (see bridge.ts for the words).
 */
export function formatTime(instant: Instant, timeZone: string, cycle: HourCycle, locale = formatLocale): string {
  const time = plain(
    dtf(locale, {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
      hourCycle: cycle === '12h' ? 'h12' : 'h23',
    }).format(new Date(instant)),
  );
  return time;
}

/**
 * For a clock time that happens twice: whether this instant is the occurrence before the clocks
 * change or after it. Null for every ordinary time.
 */
export function clockOccurrence(instant: Instant, timeZone: string): 'before' | 'after' | null {
  const repeated = repeatedTime(instant, timeZone);
  return repeated ? (repeated.isLater ? 'after' : 'before') : null;
}

/** The UTC offset at an instant, written to be read aloud: "UTC minus 8", "UTC plus 5:30", "UTC". */
export function spokenUtcOffset(timeZone: string, instant: Instant): string {
  const minutes = getOffsetMinutes(timeZone, instant);
  if (minutes === 0) return 'UTC';
  const abs = Math.abs(minutes);
  const m = abs % 60;
  return `UTC ${minutes > 0 ? 'plus' : 'minus'} ${Math.floor(abs / 60)}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

export type KeyDateStyle =
  | 'long' // "Thursday, October 15, 2026"
  | 'longNoYear' // "Thursday, October 15"
  | 'medium' // "Thu, Oct 15"
  | 'monthDay' // "Oct 15"
  | 'monthYear' // "October 2026"
  | 'weekdayDay'; // "Thu 15"

const KEY_DATE_OPTIONS: Record<Exclude<KeyDateStyle, 'weekdayDay'>, Intl.DateTimeFormatOptions> = {
  long: { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' },
  longNoYear: { weekday: 'long', month: 'long', day: 'numeric' },
  medium: { weekday: 'short', month: 'short', day: 'numeric' },
  monthDay: { month: 'short', day: 'numeric' },
  monthYear: { month: 'long', year: 'numeric' },
};

function keyToDate(key: string): Date {
  const { year, month, day } = parseKey(key);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

/**
 * Weekday and day number for a column heading, each written by Intl for the locale
 * ("Thu" + "15", "木" + "15日"). Weekday first, as Cal.com's slot column reads.
 */
export function weekdayAndDay(key: string, locale = formatLocale): { weekday: string; day: string } {
  const d = keyToDate(key);
  return {
    weekday: plain(dtf(locale, { timeZone: 'UTC', weekday: 'short' }).format(d)),
    day: plain(dtf(locale, { timeZone: 'UTC', day: 'numeric' }).format(d)),
  };
}

export function formatKeyDate(key: string, style: KeyDateStyle, locale = formatLocale): string {
  if (style === 'weekdayDay') {
    const { weekday, day } = weekdayAndDay(key, locale);
    return `${weekday} ${day}`;
  }
  return plain(dtf(locale, { timeZone: 'UTC', ...KEY_DATE_OPTIONS[style] }).format(keyToDate(key)));
}

/** "October 2026" split by Intl into parts, so the year can be styled in any word order ("2026年10月"). */
export function monthYearParts(key: string, locale = formatLocale): Array<{ text: string; isYear: boolean }> {
  return dtf(locale, { timeZone: 'UTC', ...KEY_DATE_OPTIONS.monthYear })
    .formatToParts(keyToDate(key))
    .map((p) => ({ text: plain(p.value), isYear: p.type === 'year' }));
}

/** Weekday names from Sunday, as the locale writes them: { short: "Sun", long: "Sunday" }. */
export function weekdayNames(locale = formatLocale): Array<{ short: string; long: string }> {
  const short = dtf(locale, { timeZone: 'UTC', weekday: 'short' });
  const long = dtf(locale, { timeZone: 'UTC', weekday: 'long' });
  // 2026-01-04 is a Sunday.
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 0, 4 + i, 12));
    return { short: plain(short.format(d)), long: plain(long.format(d)) };
  });
}

/* ------------------------------------------------------------------ */
/* Comparison helpers used by the TimeBridge UI                        */
/* ------------------------------------------------------------------ */

/** Positive when `other` is ahead of `self` at that instant (minutes). */
export function offsetDifference(self: string, other: string, instant: Instant): number {
  return getOffsetMinutes(other, instant) - getOffsetMinutes(self, instant);
}

/** Calendar-day difference between how two zones label the same instant (-1, 0, +1). */
export function dayShift(self: string, other: string, instant: Instant): number {
  return daysBetweenKeys(dateKey(self, instant), dateKey(other, instant));
}

export interface OffsetChange {
  /** First instant with the new offset. */
  at: Instant;
  zone: string;
  fromMinutes: number;
  toMinutes: number;
}

/**
 * Finds UTC-offset changes (DST transitions or rule changes) for a zone between
 * two instants. Hour-level sampling, then binary search to the minute.
 */
export function findOffsetChanges(timeZone: string, from: Instant, to: Instant): OffsetChange[] {
  const HOUR = 3_600_000;
  const changes: OffsetChange[] = [];
  let prevT = from;
  let prevOffset = getOffsetMinutes(timeZone, from);
  for (let t = from + HOUR; t <= to + HOUR; t += HOUR) {
    const off = getOffsetMinutes(timeZone, t);
    if (off !== prevOffset) {
      let lo = prevT;
      let hi = t;
      while (hi - lo > 60_000) {
        const mid = lo + Math.floor((hi - lo) / 2 / 60_000) * 60_000;
        if (getOffsetMinutes(timeZone, mid) === prevOffset) lo = mid;
        else hi = mid;
      }
      if (hi <= to) changes.push({ at: hi, zone: timeZone, fromMinutes: prevOffset, toMinutes: off });
      prevOffset = off;
    }
    prevT = t;
  }
  return changes;
}

export function detectDeviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

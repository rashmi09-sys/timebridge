/** Shared domain types. Time is always an absolute instant; zones are IANA ids. */

/** Epoch milliseconds (UTC). */
export type Instant = number;

export type HourCycle = '12h' | '24h';

export interface Slot {
  start: Instant;
  end: Instant;
}

/** Weekly working hours in the host's own time zone, the way Cal.com schedules are stored. */
export interface HostSchedule {
  timeZone: string;
  /** weekday (0 = Sunday) → working ranges as "HH:MM" pairs */
  weekly: Record<number, Array<[string, string]>>;
}

export interface EventType {
  title: string;
  lengthMinutes: number;
  /** Minimum notice before a booking can start. */
  minimumNoticeMinutes: number;
  /** How far ahead guests can book (days, counted in the host's calendar). */
  bookingWindowDays: number;
}

export interface HostProfile {
  name: string;
  firstName: string;
  initials: string;
  /** Where the host works from, shown beside their zone name ("India Standard Time · Bengaluru"). */
  city: string;
}

/** Example guest for the demo: shown as form placeholders, never filled in for the user. */
export interface DemoGuest {
  name: string;
  email: string;
}

/**
 * Production would make this a host setting. Showing a host's local time
 * reveals roughly where they are, so it must be the host's choice.
 */
export interface HostPrivacy {
  shareLocalTime: boolean;
}

export interface BookingRequest {
  slot: Slot;
  name: string;
  email: string;
  notes: string;
  guestTimeZone: string;
}

export interface Booking extends BookingRequest {
  uid: string;
}

export type NetworkMode = 'normal' | 'slow' | 'fail-next-load' | 'conflict-next-booking';

export type Step = 'select' | 'details' | 'done';
export type LoadState = 'loading' | 'ready' | 'error';

export interface MonthRef {
  year: number;
  month: number; // 1-12
}

export type ThemeChoice = 'system' | 'light' | 'dark';

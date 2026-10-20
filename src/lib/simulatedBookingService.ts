import { generateSlots, isPreBooked } from './availability';
import type { Booking, BookingRequest, DemoGuest, EventType, HostPrivacy, HostProfile, HostSchedule, Instant, NetworkMode, Slot } from '../types';

export type { Booking, BookingRequest, NetworkMode };

/**
 * SIMULATED — this does not talk to Cal.com. A stand-in availability service. It behaves like a network API (latency,
 * failures, conflicts) so the UI's loading, error and race-condition states are
 * real code paths rather than mock screens. Swap this module for Cal.com's
 * slots endpoint in a real integration.
 */

export class AvailabilityError extends Error {
  constructor() {
    super('Could not load availability');
    this.name = 'AvailabilityError';
  }
}

/** The chosen time can no longer be booked: someone took it, or it is now inside the minimum notice. */
export class SlotUnavailableError extends Error {
  constructor(readonly reason: 'taken' | 'too-soon') {
    super(reason === 'taken' ? 'That time was just booked' : 'That time is now too soon to book');
    this.name = 'SlotUnavailableError';
  }
}

/*
 * Demo identities: fictional people, defined once and used everywhere.
 * Arjun hosts from Bengaluru (Asia/Kolkata, below); Yuki is the example guest, in Tokyo.
 */
export const HOST: HostProfile = {
  name: 'Arjun Mehta',
  firstName: 'Arjun',
  initials: 'AM',
  city: 'Bengaluru',
};

export const DEMO_GUEST: DemoGuest = {
  name: 'Yuki Tanaka',
  email: 'yuki@example.com',
};

export const SCHEDULE: HostSchedule = {
  timeZone: 'Asia/Kolkata',
  weekly: {
    1: [['09:00', '17:00']],
    2: [['09:00', '17:00']],
    3: [['09:00', '17:00']],
    4: [['09:00', '17:00']],
    5: [['09:00', '17:00']],
  },
};

/**
 * Test and demo fixture (?schedule=every-day): the same hours on every day of the week. Only
 * weekend nights reach the hour that repeats when clocks go back in Europe and the Americas, and
 * Arjun's weekday hours never land there, so the repeated-time labels need this to be seen.
 */
export const EVERY_DAY_SCHEDULE: HostSchedule = {
  timeZone: SCHEDULE.timeZone,
  weekly: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [['09:00', '17:00']]])) as HostSchedule['weekly'],
};

let activeSchedule: HostSchedule = SCHEDULE;

export function applyScheduleFixture(name: string | null) {
  activeSchedule = name === 'every-day' ? EVERY_DAY_SCHEDULE : SCHEDULE;
}

/** Simulated host setting. Defaults on for this demo; see CASE_STUDY.md on privacy. */
export const DEFAULT_PRIVACY: HostPrivacy = { shareLocalTime: true };

export const EVENT: EventType = {
  title: '15 min introduction',
  lengthMinutes: 15,
  minimumNoticeMinutes: 120,
  bookingWindowDays: 60,
};

interface ApiState {
  mode: NetworkMode;
  bookings: Set<Instant>;
}

const state: ApiState = { mode: 'normal', bookings: new Set() };

const listeners = new Set<(mode: NetworkMode) => void>();

export function setNetworkMode(mode: NetworkMode) {
  state.mode = mode;
  listeners.forEach((l) => l(mode));
}

export function subscribeNetworkMode(listener: (mode: NetworkMode) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getNetworkMode(): NetworkMode {
  return state.mode;
}

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(id);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });
}

function latency() {
  return state.mode === 'slow' ? 2200 : 350;
}

export async function fetchSlots(from: Instant, to: Instant, now: Instant, signal?: AbortSignal): Promise<Slot[]> {
  await wait(latency(), signal);
  if (state.mode === 'fail-next-load') {
    setNetworkMode('normal');
    throw new AvailabilityError();
  }
  return generateSlots(activeSchedule, EVENT, from, to, now).filter(
    (s) => !isPreBooked(s.start) && !state.bookings.has(s.start),
  );
}

/**
 * Re-validates the slot at booking time, like a real server would: it may have
 * been taken, or the page may have been open long enough that it is now inside
 * the minimum notice.
 */
export async function createBooking(req: BookingRequest, now: Instant): Promise<Booking> {
  await wait(latency() + 250);
  if (state.mode === 'conflict-next-booking') {
    // Someone else took this exact slot between viewing and confirming.
    setNetworkMode('normal');
    state.bookings.add(req.slot.start);
    throw new SlotUnavailableError('taken');
  }
  if (state.bookings.has(req.slot.start) || isPreBooked(req.slot.start)) throw new SlotUnavailableError('taken');
  if (req.slot.start < now + EVENT.minimumNoticeMinutes * 60_000) throw new SlotUnavailableError('too-soon');
  state.bookings.add(req.slot.start);
  return { ...req, uid: Math.random().toString(36).slice(2, 10) };
}

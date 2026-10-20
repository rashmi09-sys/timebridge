import { describe, expect, it, vi } from 'vitest';
import { buildIcs, googleCalendarUrl } from '../../src/lib/calendarLinks';
import { createClock } from '../../src/lib/clock';
import { createBooking, SlotUnavailableError } from '../../src/lib/simulatedBookingService';
import { isPreBooked } from '../../src/lib/availability';

const utc = (s: string) => Date.parse(s);

describe('calendar export', () => {
  const slot = { start: utc('2026-10-14T06:45:00Z'), end: utc('2026-10-14T07:00:00Z') }; // 11:45 PM PDT Tue = 12:15 PM IST Wed

  it('writes the exact instant in UTC, independent of any zone', () => {
    const ics = buildIcs({ uid: 'abc', slot, title: 'Meet, again; ok', description: 'Line 1\nLine 2' });
    expect(ics).toContain('DTSTART:20261014T064500Z');
    expect(ics).toContain('DTEND:20261014T070000Z');
    expect(ics).toContain('SUMMARY:Meet\\, again\\; ok');
    expect(ics).toContain('DESCRIPTION:Line 1\\nLine 2');
    expect(ics.split('\r\n')[0]).toBe('BEGIN:VCALENDAR');
  });

  it('turns every kind of typed line break into an escaped \\n, so notes cannot add calendar properties', () => {
    const ics = buildIcs({ uid: 'abc', slot, title: 'T', description: 'a\r\nATTENDEE:x\rb\nc' });
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain('DESCRIPTION:a\\nATTENDEE:x\\nb\\nc\r\n');
    expect(unfolded.split('\r\n').filter((l) => l.startsWith('ATTENDEE'))).toEqual([]);
    expect(ics).not.toMatch(/\r(?!\n)/); // no bare CR anywhere
  });

  it('folds long lines at 75 octets without splitting a character, and unfolds to the original', () => {
    const description = `Notes: ${'café 東京 '.repeat(30)}`;
    const ics = buildIcs({ uid: 'abc', slot, title: 'T', description });
    const encoder = new TextEncoder();
    for (const line of ics.split('\r\n')) expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    expect(ics).not.toContain('\uFFFD');
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain(`DESCRIPTION:${description}\r\n`);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('builds a Google Calendar link for the same instant', () => {
    const url = new URL(googleCalendarUrl({ slot, title: 'T', description: 'D' }));
    expect(url.searchParams.get('dates')).toBe('20261014T064500Z/20261014T070000Z');
  });
});

describe('clock', () => {
  it('starts at the pinned instant and keeps moving with real time', () => {
    let real = 1_000;
    const clock = createClock(utc('2026-10-13T15:30:00Z'), () => real);
    expect(clock.now()).toBe(utc('2026-10-13T15:30:00Z'));
    real += 90 * 60_000;
    expect(clock.now()).toBe(utc('2026-10-13T17:00:00Z'));
    expect(clock.origin).toBe(utc('2026-10-13T15:30:00Z'));
  });
});

describe('booking re-validation', () => {
  vi.useFakeTimers();

  // A start time the simulation hasn't marked as pre-booked.
  function freeSlotAfter(from: number) {
    let t = from;
    while (isPreBooked(t)) t += 15 * 60_000;
    return { start: t, end: t + 15 * 60_000 };
  }

  const request = (slot: { start: number; end: number }) => ({
    slot,
    name: 'Jane',
    email: 'jane@example.com',
    notes: '',
    guestTimeZone: 'America/Los_Angeles',
  });

  it('rejects a time that has moved inside the minimum notice while the page was open', async () => {
    const slot = freeSlotAfter(utc('2026-10-14T04:00:00Z'));
    const pending = createBooking(request(slot), slot.start - 30 * 60_000); // 30 min before start; notice is 2 h
    const assertion = expect(pending).rejects.toMatchObject({ reason: 'too-soon' });
    await vi.runAllTimersAsync();
    await assertion;
  });

  it('rejects a second booking of the same time', async () => {
    const slot = freeSlotAfter(utc('2026-10-20T04:00:00Z'));
    const now = slot.start - 3 * 86_400_000;
    const first = createBooking(request(slot), now);
    await vi.runAllTimersAsync();
    await expect(first).resolves.toMatchObject({ slot });
    const second = createBooking(request(slot), now);
    const assertion = expect(second).rejects.toBeInstanceOf(SlotUnavailableError);
    await vi.runAllTimersAsync();
    await assertion;
  });
});

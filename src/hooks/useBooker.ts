import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildBridgeContext, changeBeforeMeeting } from '../lib/bridge';
import type { Clock } from '../lib/clock';
import {
  createBooking,
  EVENT,
  fetchSlots,
  HOST,
  SCHEDULE,
  SlotUnavailableError,
} from '../lib/simulatedBookingService';
import { chooseDate } from '../lib/dateSelection';
import { addDaysToKey, dateKey, daysInMonth, startOfDay, toKey } from '../lib/time';
import type { Booking, LoadState, MonthRef, Slot, Step } from '../types';

export interface Conflict {
  slot: Slot;
  reason: 'taken' | 'too-soon';
}

function addMonths(m: MonthRef, delta: number): MonthRef {
  const index = m.year * 12 + (m.month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/**
 * All booking-flow state and side effects live here; components only render.
 */
export function useBooker(opts: { guestZone: string; clock: Clock }) {
  const { guestZone, clock } = opts;
  // Stable reference instant for this page view (availability, "today", the window).
  const now = clock.origin;
  const hostZone = SCHEDULE.timeZone;

  const todayKey = dateKey(guestZone, now);
  const [month, setMonth] = useState<MonthRef>(() => {
    const [y, m] = todayKey.split('-').map(Number);
    return { year: y, month: m };
  });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [step, setStep] = useState<Step>('select');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [load, setLoad] = useState<LoadState>('loading');
  const [reloadToken, setReloadToken] = useState(0);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const firstKey = toKey(month.year, month.month, 1);
  const nextMonth = addMonths(month, 1);
  const range = useMemo(
    () => ({
      start: startOfDay(guestZone, firstKey),
      end: startOfDay(guestZone, toKey(nextMonth.year, nextMonth.month, 1)),
    }),
    [guestZone, firstKey, nextMonth.year, nextMonth.month],
  );

  // Fetch the visible month whenever it (or the guest's zone) changes.
  // The result is tagged with the request it answers, so a new month reads as
  // "loading" from its very first render, never as "ready" with last month's data
  // (which made screen readers hear "no available days" before the data arrived).
  const requestKey = `${range.start}|${range.end}|${reloadToken}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const requestId = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    const id = ++requestId.current;
    setLoad('loading');
    // Availability is computed against the live clock, so a retry or reload never offers stale times.
    fetchSlots(range.start, range.end, clock.now(), controller.signal)
      .then((result) => {
        if (id !== requestId.current) return;
        setSlots(result);
        setLoad('ready');
        setLoadedKey(requestKey);
      })
      .catch((err) => {
        if (controller.signal.aborted || id !== requestId.current) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setSlots([]);
        setLoad('error');
        setLoadedKey(requestKey);
      });
    return () => controller.abort();
    // requestKey is derived from range and reloadToken, so listing it adds no extra runs.
  }, [range.start, range.end, clock, reloadToken, requestKey]);
  const currentLoad: LoadState = loadedKey === requestKey ? load : 'loading';

  const slotsByDate = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const s of slots) {
      const key = dateKey(guestZone, s.start);
      const list = map.get(key);
      if (list) list.push(s);
      else map.set(key, [s]);
    }
    return map;
  }, [slots, guestZone]);

  // Memoised so the derived values below don't recompute on every render when no date has times.
  const daySlots = useMemo(() => (selectedDate ? (slotsByDate.get(selectedDate) ?? []) : []), [selectedDate, slotsByDate]);

  const bridge = useMemo(() => {
    const reference = daySlots[0]?.start ?? slots.find((s) => s.start >= now)?.start ?? now;
    return buildBridgeContext({
      hostFirstName: HOST.firstName,
      hostZone,
      guestZone,
      reference,
      // Look for clock changes across the whole booking window, not just this month.
      windowEnd: now + EVENT.bookingWindowDays * 86_400_000,
    });
  }, [daySlots, slots, now, hostZone, guestZone]);

  // A clock change matters only if it falls between now and the date being looked
  // at, i.e. the time difference on that date differs from today's.
  const selectedChange = useMemo(
    () => (daySlots[0] ? changeBeforeMeeting({ hostZone, guestZone, now, meeting: daySlots[0].start }) : null),
    [daySlots, hostZone, guestZone, now],
  );

  const monthDays = useMemo(() => {
    const count = daysInMonth(month.year, month.month);
    return Array.from({ length: count }, (_, i) => toKey(month.year, month.month, i + 1));
  }, [month]);

  const canGoBack = month.year * 12 + month.month > Number(todayKey.slice(0, 4)) * 12 + Number(todayKey.slice(5, 7));
  const windowEndKey = addDaysToKey(dateKey(hostZone, now), EVENT.bookingWindowDays + 1);
  const canGoForward = toKey(nextMonth.year, nextMonth.month, 1) <= windowEndKey;

  /*
   * Automatic date choice (rules in lib/dateSelection.ts):
   * - On load, the earliest open date in the guest's calendar is shown, so times are
   *   visible without a click. If this month has none, the next month is checked.
   * - When the guest's zone changes, a chosen time keeps its instant (its date may
   *   move), a picked date is kept while it still has times, and otherwise the nearest
   *   open date is shown and `movedFrom` says which date had no times.
   * - A date or month the guest picks is never changed afterwards for any other reason.
   */
  const [autoPending, setAutoPending] = useState(true);
  const [checkedZone, setCheckedZone] = useState(guestZone);
  const [movedFrom, setMovedFrom] = useState<string | null>(null);
  const [nothingOpen, setNothingOpen] = useState(false);
  useEffect(() => {
    if (currentLoad !== 'ready' || step !== 'select') return;
    if (!autoPending && checkedZone === guestZone) return;
    const chosenStillOpen = selectedSlot && slots.some((s) => s.start === selectedSlot.start);
    const { date, moved } = chooseDate({
      monthDays,
      isOpen: (key) => slotsByDate.has(key),
      todayKey,
      current: selectedDate,
      chosenDateKey: chosenStillOpen ? dateKey(guestZone, selectedSlot.start) : null,
    });
    if (date) {
      setSelectedDate(date);
      // Keep the note if this date was reached by moving on from an empty month.
      setMovedFrom((prev) => (moved ? selectedDate : selectedDate == null ? prev : null));
    } else if (canGoForward) {
      // Nothing open this month: look at the next one (the date moves with it).
      if (selectedDate) setMovedFrom(selectedDate);
      setSelectedDate(null);
      setMonth((m) => addMonths(m, 1));
      setAutoPending(true);
      return;
    } else {
      setNothingOpen(!selectedDate);
    }
    setAutoPending(false);
    setCheckedZone(guestZone);
  }, [currentLoad, step, autoPending, checkedZone, guestZone, selectedSlot, slots, monthDays, slotsByDate, todayKey, selectedDate, canGoForward]);

  const goToMonth = useCallback((delta: number) => {
    setMonth((m) => addMonths(m, delta));
    setSelectedDate(null);
    setMovedFrom(null);
    setAutoPending(false);
  }, []);

  const selectDate = useCallback((key: string) => {
    setSelectedDate(key);
    setConflict(null);
    setMovedFrom(null);
  }, []);

  const chooseSlot = useCallback((slot: Slot) => {
    setSelectedSlot(slot);
    setConflict(null);
    setStep('details');
  }, []);

  const backToSelect = useCallback(() => setStep('select'), []);

  const submit = useCallback(
    async (details: { name: string; email: string; notes: string }) => {
      if (!selectedSlot || submittingRef.current) return;
      submittingRef.current = true;
      setSubmitting(true);
      try {
        const result = await createBooking({ slot: selectedSlot, guestTimeZone: guestZone, ...details }, clock.now());
        setBooking(result);
        setStep('done');
      } catch (err) {
        if (err instanceof SlotUnavailableError) {
          setConflict({ slot: selectedSlot, reason: err.reason });
          setSlots((prev) => prev.filter((s) => s.start !== selectedSlot.start));
          setSelectedSlot(null);
          setStep('select');
          // Too soon means time has moved on while the page was open: refresh what's offered.
          if (err.reason === 'too-soon') setReloadToken((t) => t + 1);
        } else {
          throw err;
        }
      } finally {
        submittingRef.current = false;
        setSubmitting(false);
      }
    },
    [selectedSlot, guestZone, clock],
  );

  const reset = useCallback(() => {
    setBooking(null);
    setSelectedSlot(null);
    setSelectedDate(null);
    setStep('select');
    setReloadToken((t) => t + 1);
    setMovedFrom(null);
    setNothingOpen(false);
    setAutoPending(true);
  }, []);

  const retry = useCallback(() => setReloadToken((t) => t + 1), []);

  return {
    hostZone,
    guestZone,
    todayKey,
    month,
    monthDays,
    range,
    canGoBack,
    canGoForward,
    goToMonth,
    load: currentLoad,
    retry,
    slots,
    slotsByDate,
    selectedDate,
    selectDate,
    /** The date the guest had, when a zone change left it with no open times. */
    movedFrom,
    /** Nothing at all is open within the booking window. */
    nothingOpen: nothingOpen && currentLoad === 'ready',
    daySlots,
    selectedSlot,
    chooseSlot,
    step,
    backToSelect,
    submit,
    submitting,
    conflict,
    clearConflict: () => setConflict(null),
    booking,
    reset,
    bridge,
    selectedChange,
  };
}

export type Booker = ReturnType<typeof useBooker>;

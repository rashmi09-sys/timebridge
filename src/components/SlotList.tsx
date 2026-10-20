import { Switch } from '@base-ui/react/switch';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import { Toggle } from '@base-ui/react/toggle';
import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Conflict } from '../hooks/useBooker';
import { labelHostDays, OCCURRENCE_TEXT, REPEATED_TIMES_NOTE, spokenClockTime } from '../lib/bridge';
import { clockOccurrence, formatKeyDate, formatTime, hasRepeatedTimes, spokenUtcOffset, startOfDay, weekdayAndDay, zoneGenericName } from '../lib/time';
import type { HourCycle, LoadState, Slot } from '../types';
import { AlertIcon } from './Icons';

export interface SlotListHandle {
  /** Focus the first time (after a keyboard date choice). */
  focusFirst: () => void;
  /** Focus a specific time (after Back). Falls back to the first time. */
  focusSlot: (start: number) => void;
  /** Bring the list's heading into view (small screens, after a tap on a date). */
  scrollIntoView: (options?: ScrollIntoViewOptions) => void;
}

export interface SlotListProps {
  /** Open times for `selectedDate`, in order. */
  slots: Slot[];
  /** The guest's calendar date being shown (YYYY-MM-DD), or null before one is chosen. */
  selectedDate: string | null;
  guestZone: string;
  hostZone: string;
  load: LoadState;
  /** A time that was taken (or became too soon) while confirming; explained above the list. */
  conflict: Conflict | null;
  /** Start of the time chosen earlier, marked as current after Back. */
  chosenStart: number | null;
  /** A date that lost all its times when the guest's zone changed (the list now shows another). */
  movedFrom: string | null;
  /** Nothing is open to book within the booking window. */
  nothingOpen: boolean;
  onSelect: (slot: Slot) => void;
  hourCycle: HourCycle;
  onHourCycleChange: (c: HourCycle) => void;
  /** Whether the host-time comparison may be offered: the zones differ and the host shares their time. */
  canCompare: boolean;
  compare: boolean;
  onCompareChange: (v: boolean) => void;
}

/**
 * Time slots for the chosen day: a native list of action buttons (choosing a time moves on
 * to the details step, so this is not a selection widget). One tab stop; ArrowUp/ArrowDown
 * move between times and Home/End jump to the ends, matching the calendar grid.
 *
 * The tab stop is derived from the current list: it is the time last focused in *this* list,
 * else the time chosen earlier, else the first time. It never carries over from another date.
 */
export const SlotList = forwardRef<SlotListHandle, SlotListProps>(function SlotList(props, ref) {
  const { slots, selectedDate, guestZone, hostZone, load, conflict, chosenStart, hourCycle, compare } = props;
  const titleId = useId();
  const noteId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<number, HTMLButtonElement>());

  // Identity of the list on screen. When it changes (new date, zone or availability),
  // the remembered position is discarded; focus itself is never moved by a list change.
  const listKey = useMemo(() => `${selectedDate}|${slots.map((s) => s.start).join(',')}`, [selectedDate, slots]);
  const [active, setActive] = useState<{ listKey: string; start: number } | null>(null);
  const inList = (start: number | null | undefined) => start != null && slots.some((s) => s.start === start);
  const tabStop =
    active && active.listKey === listKey && inList(active.start)
      ? active.start
      : inList(chosenStart)
        ? chosenStart!
        : slots[0]?.start;

  const focusStart = (start: number | undefined) => {
    if (start != null) buttons.current.get(start)?.focus();
  };

  useImperativeHandle(ref, () => ({
    focusFirst: () => requestAnimationFrame(() => focusStart(slots[0]?.start)),
    focusSlot: (start: number) => requestAnimationFrame(() => focusStart(inList(start) ? start : slots[0]?.start)),
    scrollIntoView: (options) => titleRef.current?.scrollIntoView(options),
  }));

  // A conflict is explained, and focused, as soon as the list appears with it.
  useEffect(() => {
    if (conflict) requestAnimationFrame(() => noticeRef.current?.focus());
  }, [conflict]);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const next: Record<string, number> = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: slots.length - 1 };
    if (e.key in next) {
      e.preventDefault();
      focusStart(slots[Math.max(0, Math.min(next[e.key], slots.length - 1))]?.start);
    }
  }

  const showCompare = compare && props.canCompare;
  const hostDays = useMemo(
    () => (selectedDate ? labelHostDays(slots.map((s) => s.start), hostZone, selectedDate) : null),
    [slots, hostZone, selectedDate],
  );
  const heading = selectedDate ? weekdayAndDay(selectedDate) : null;
  const ready = load === 'ready';
  const conflictOccurrence = conflict ? clockOccurrence(conflict.slot.start, guestZone) : null;
  // Only when this list actually holds a repeated time: a DST day without one needs no explanation.
  const repeated = useMemo(() => hasRepeatedTimes(slots.map((s) => s.start), guestZone), [slots, guestZone]);

  return (
    <section className="slots" aria-labelledby={titleId}>
      <div className="slots-header">
        <h2 className="slots-title" id={titleId} ref={titleRef}>
          {selectedDate ? (
            <>
              {heading?.weekday} <span className="muted">{heading?.day}</span>
              <span className="sr-only">, available times</span>
            </>
          ) : (
            <span className="muted">Available times</span>
          )}
        </h2>
        <ToggleGroup
          className="segmented"
          value={[hourCycle]}
          onValueChange={(v) => v[0] && props.onHourCycleChange(v[0] as HourCycle)}
          aria-label="Time format"
        >
          <Toggle value="12h" className="segmented-item" aria-label="12-hour clock">
            12h
          </Toggle>
          <Toggle value="24h" className="segmented-item" aria-label="24-hour clock">
            24h
          </Toggle>
        </ToggleGroup>
      </div>

      {props.canCompare && ready && slots.length > 0 && (
        <label className="compare-toggle">
          <Switch.Root checked={compare} onCheckedChange={props.onCompareChange} className="switch">
            <Switch.Thumb className="switch-thumb" />
          </Switch.Root>
          <span>Show host’s time</span>
        </label>
      )}

      {conflict && (
        <div className="notice" role="alert" tabIndex={-1} ref={noticeRef}>
          <AlertIcon size={16} />
          <p>
            <strong>
              {formatTime(conflict.slot.start, guestZone, hourCycle)}
              {conflictOccurrence && ` (${OCCURRENCE_TEXT[conflictOccurrence].toLowerCase()})`}{' '}
              {conflict.reason === 'taken' ? 'was just booked by someone else.' : 'is now too soon to book.'}
            </strong>{' '}
            Pick another time{slots.length ? ' below' : ''}.
          </p>
        </div>
      )}

      {showCompare && ready && slots.length > 0 && (
        <div className="slot-columns" aria-hidden="true">
          <span>Your time</span>
          <span>
            Host’s time{hostDays?.shared && <span className="slot-columns-day"> · {hostDays.shared}</span>}
          </span>
        </div>
      )}

      <div className="slots-scroll">
        {load === 'loading' && (
          <ul className="slot-list" aria-hidden="true">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i}>
                <div className="slot slot-skeleton" />
              </li>
            ))}
          </ul>
        )}

        {ready && !selectedDate && (
          <p className="slots-empty">
            {props.nothingOpen ? 'No times are open to book right now.' : 'Choose a date to see available times.'}
          </p>
        )}

        {ready && selectedDate && props.movedFrom && slots.length > 0 && (
          <p className="slots-moved">
            No open times on {formatKeyDate(props.movedFrom, 'medium')} in{' '}
            {zoneGenericName(guestZone, startOfDay(guestZone, selectedDate))}, so showing {formatKeyDate(selectedDate, 'medium')}.
          </p>
        )}

        {ready && selectedDate && slots.length === 0 && (
          <p className="slots-empty" role="status">
            No open times on {formatKeyDate(selectedDate, 'medium')} in{' '}
            {zoneGenericName(guestZone, startOfDay(guestZone, selectedDate))}. Choose another date.
          </p>
        )}

        {ready && slots.length > 0 && repeated && (
          // Plain text in reading order (no live region); the date announcement in App mentions it once.
          <p className="slots-note" id={noteId}>
            {REPEATED_TIMES_NOTE}
          </p>
        )}

        {ready && slots.length > 0 && hostDays && (
          <ul className="slot-list" aria-labelledby={titleId} aria-describedby={repeated ? noteId : undefined}>
            {slots.map((slot, i) => (
              <li key={slot.start}>
                <SlotButton
                  ref={(el) => {
                    if (el) buttons.current.set(slot.start, el);
                    else buttons.current.delete(slot.start);
                  }}
                  guestTime={formatTime(slot.start, guestZone, hourCycle)}
                  occurrence={clockOccurrence(slot.start, guestZone)}
                  guestOffset={spokenUtcOffset(guestZone, slot.start)}
                  hostTime={showCompare ? formatTime(slot.start, hostZone, hourCycle) : null}
                  hostSpoken={showCompare ? spokenClockTime(formatTime(slot.start, hostZone, hourCycle), slot.start, hostZone) : null}
                  hostDay={hostDays.rows[i]}
                  current={slot.start === chosenStart}
                  tabIndex={slot.start === tabStop ? 0 : -1}
                  onFocus={() => setActive({ listKey, start: slot.start })}
                  onKeyDown={(e) => onKeyDown(e, i)}
                  onClick={() => props.onSelect(slot)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
});

/** One time. Presentational: every string arrives formatted; it knows nothing about zones or booking. */
const SlotButton = forwardRef<
  HTMLButtonElement,
  {
    guestTime: string;
    /** For a clock time that happens twice that day: which one this is. Null for ordinary times. */
    occurrence: 'before' | 'after' | null;
    /** The guest's UTC offset at this instant, spoken ("UTC minus 8"); used only for repeated times. */
    guestOffset: string;
    /** The host's time, or null when the comparison is off. */
    hostTime: string | null;
    /** The host's time as read aloud (with the occurrence if the host's clock repeats it). */
    hostSpoken: string | null;
    hostDay: { short: string | null; spoken: string | null };
    /** The time chosen earlier in this booking. */
    current: boolean;
    tabIndex: number;
    onFocus: () => void;
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
    onClick: () => void;
  }
>(function SlotButton({ guestTime, occurrence, guestOffset, hostTime, hostSpoken, hostDay, current, ...handlers }, ref) {
  const when = occurrence ? OCCURRENCE_TEXT[occurrence] : null;
  const spoken = [
    // "1:15 AM your time, after clocks change, UTC minus 8": both occurrences differ in words and offset.
    `${guestTime} your time${when ? `, ${when.toLowerCase()}, ${guestOffset}` : ''}`,
    hostTime != null ? `host’s time ${hostSpoken}${hostDay.spoken ? `, ${hostDay.spoken}` : ''}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <button
      ref={ref}
      type="button"
      className="slot"
      data-compare={hostTime != null || undefined}
      // "Current item in a set": the time already chosen, announced as "current" after Back.
      // Not aria-pressed/aria-selected: these are action buttons, not toggles or options.
      aria-current={current || undefined}
      aria-label={spoken}
      {...handlers}
    >
      {when ? (
        // Only for a time that happens twice: the plain time, with a quiet line saying which one.
        <span className="slot-label">
          <span className="slot-time">{guestTime}</span>
          <span className="slot-when">{when}</span>
        </span>
      ) : (
        <span className="slot-time">{guestTime}</span>
      )}
      {hostTime != null && (
        <span className="slot-host" aria-hidden="true">
          {hostTime}
          {hostDay.short && <span className="slot-host-day"> · {hostDay.short}</span>}
        </span>
      )}
    </button>
  );
});

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Booker } from '../hooks/useBooker';
import { EVENT } from '../lib/simulatedBookingService';
import { addDaysToKey, formatKeyDate, getFormatLocale, monthYearParts, parseKey, weekdayNames, weekdayOfKey } from '../lib/time';
import { AlertIcon, ChevronLeftIcon, ChevronRightIcon } from './Icons';

/**
 * Month grid following the WAI-ARIA date-grid pattern:
 * one tab stop, arrows move by day/week, Home/End to week edges,
 * PageUp/PageDown change month, Enter/Space choose.
 */
export function MonthCalendar(props: {
  booker: Booker;
  onDateChosen: (key: string, viaKeyboard: boolean) => void;
}) {
  const { booker, onDateChosen } = props;
  const { month, monthDays, slotsByDate, selectedDate, todayKey, load } = booker;
  const monthPrefix = `${month.year}-${String(month.month).padStart(2, '0')}`;

  const firstAvailable = monthDays.find((d) => slotsByDate.has(d));
  // The tab stop rests on an open date: the selected one if it still has times, else the first open one.
  const defaultFocus =
    (selectedDate?.startsWith(monthPrefix) && slotsByDate.has(selectedDate) && selectedDate) ||
    firstAvailable ||
    (todayKey.startsWith(monthPrefix) ? todayKey : monthDays[0]);

  const [focusKey, setFocusKey] = useState(defaultFocus);
  const pendingFocus = useRef<string | null>(null);
  const gridRef = useRef<HTMLTableElement>(null);

  // Re-anchor the roving tab stop when the month or data changes.
  useEffect(() => {
    if (!focusKey.startsWith(monthPrefix)) setFocusKey(pendingFocus.current ?? defaultFocus);
  }, [monthPrefix, defaultFocus, focusKey]);

  useEffect(() => {
    if (load === 'ready' && !pendingFocus.current && !gridRef.current?.contains(document.activeElement)) {
      setFocusKey(defaultFocus);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, monthPrefix]);

  // When the selection changes without the guest moving through the grid (a zone change or the
  // first automatic choice), move the tab stop with it, so Tab never lands on a date with no times.
  useEffect(() => {
    if (selectedDate?.startsWith(monthPrefix) && !gridRef.current?.contains(document.activeElement)) setFocusKey(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target || !target.startsWith(monthPrefix)) return;
    pendingFocus.current = null;
    setFocusKey(target);
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLButtonElement>(`[data-key="${target}"]`)?.focus());
  }, [monthPrefix]);

  const weeks = useMemo(() => {
    const lead = weekdayOfKey(monthDays[0]);
    const cells: Array<string | null> = [...Array(lead).fill(null), ...monthDays];
    while (cells.length % 7) cells.push(null);
    const rows: Array<Array<string | null>> = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return rows;
  }, [monthDays]);

  const availableDays = monthDays.filter((d) => slotsByDate.has(d)).length;

  function moveFocus(target: string) {
    if (target.startsWith(monthPrefix)) {
      setFocusKey(target);
      gridRef.current?.querySelector<HTMLButtonElement>(`[data-key="${target}"]`)?.focus();
      return;
    }
    const delta = target < monthPrefix ? -1 : 1;
    if ((delta < 0 && !booker.canGoBack) || (delta > 0 && !booker.canGoForward)) return;
    pendingFocus.current = target;
    booker.goToMonth(delta);
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, key: string) {
    const wd = weekdayOfKey(key);
    const map: Record<string, () => string> = {
      ArrowLeft: () => addDaysToKey(key, -1),
      ArrowRight: () => addDaysToKey(key, 1),
      ArrowUp: () => addDaysToKey(key, -7),
      ArrowDown: () => addDaysToKey(key, 7),
      Home: () => addDaysToKey(key, -wd),
      End: () => addDaysToKey(key, 6 - wd),
      PageUp: () => shiftMonth(key, -1),
      PageDown: () => shiftMonth(key, 1),
    };
    const fn = map[e.key];
    if (fn) {
      e.preventDefault();
      moveFocus(fn());
    }
  }

  // Written by Intl for the browser's locale; the year is muted wherever the locale puts it.
  // Weeks start on Sunday in every locale (a known limitation, see ACCESSIBILITY.md).
  const titleParts = monthYearParts(`${monthPrefix}-01`);
  const monthName = new Intl.DateTimeFormat(getFormatLocale(), { timeZone: 'UTC', month: 'long' }).format(
    Date.UTC(month.year, month.month - 1, 15),
  );
  const weekdays = useMemo(() => weekdayNames(), []);

  return (
    <div className="calendar">
      <div className="calendar-header">
        <h2 className="calendar-title" id="calendar-title">
          {titleParts.map((p, i) => (p.isYear ? <span key={i} className="muted">{p.text}</span> : p.text))}
        </h2>
        <div className="calendar-nav">
          <button
            type="button"
            className="icon-button"
            onClick={() => booker.goToMonth(-1)}
            disabled={!booker.canGoBack}
            aria-label="Previous month"
          >
            <ChevronLeftIcon />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => booker.goToMonth(1)}
            disabled={!booker.canGoForward}
            aria-label="Next month"
          >
            <ChevronRightIcon />
          </button>
        </div>
      </div>

      <div className="calendar-body">
        <table
          ref={gridRef}
          role="grid"
          className="calendar-grid"
          aria-labelledby="calendar-title"
          aria-busy={load === 'loading'}
          aria-describedby="calendar-status"
        >
          <thead>
            <tr>
              {weekdays.map((d) => (
                <th key={d.long} scope="col" abbr={d.long}>
                  {d.short.toLocaleUpperCase(getFormatLocale())}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, wi) => (
              <tr key={wi}>
                {week.map((key, di) => {
                  if (!key) return <td key={`e${di}`} role="gridcell" className="day-empty" />;
                  const count = slotsByDate.get(key)?.length ?? 0;
                  const available = load === 'ready' && count > 0;
                  const selected = key === selectedDate;
                  const isToday = key === todayKey;
                  const label = `${formatKeyDate(key, 'long')}${isToday ? ', today' : ''}, ${
                    load !== 'ready' ? 'loading' : available ? `${count} ${count === 1 ? 'time' : 'times'} available` : 'no availability'
                  }`;
                  return (
                    <td key={key} role="gridcell" aria-selected={selected}>
                      <button
                        type="button"
                        data-key={key}
                        className="day"
                        data-available={available || undefined}
                        data-selected={selected || undefined}
                        data-today={isToday || undefined}
                        data-loading={load === 'loading' || undefined}
                        tabIndex={key === focusKey ? 0 : -1}
                        aria-disabled={!available}
                        aria-label={label}
                        onFocus={() => setFocusKey(key)}
                        onKeyDown={(e) => onKeyDown(e, key)}
                        onClick={(e) => {
                          if (!available) return;
                          onDateChosen(key, e.detail === 0);
                        }}
                      >
                        {parseKey(key).day}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        {load === 'error' && (
          <div className="calendar-overlay" role="alert">
            <AlertIcon size={18} />
            <p>
              <strong>Couldn’t load available times.</strong>
              <br />
              Check your connection and try again.
            </p>
            <button type="button" className="button button-secondary" onClick={booker.retry}>
              Try again
            </button>
          </div>
        )}
      </div>

      <p id="calendar-status" className="calendar-status">
        {load === 'ready' && availableDays === 0
          ? `No open times in ${monthName}. Bookings open up to ${EVENT.bookingWindowDays} days ahead.`
          : ''}
      </p>
    </div>
  );
}

function shiftMonth(key: string, delta: number): string {
  const { year, month, day } = parseKey(key);
  const index = year * 12 + (month - 1) + delta;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

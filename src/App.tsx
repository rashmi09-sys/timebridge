import { useCallback, useEffect, useRef, useState } from 'react';
import { BookingForm } from './components/BookingForm';
import { Confirmation } from './components/Confirmation';
import { GUEST_PRESETS, SIMULATION_DISCLOSURE, SiteHeader } from './components/SiteHeader';
import { EventMeta } from './components/EventMeta';
import { MonthCalendar } from './components/MonthCalendar';
import { SlotList, type SlotListHandle } from './components/SlotList';
import { useBooker } from './hooks/useBooker';
import { hostTimeSpoken, REPEATED_TIMES_NOTE } from './lib/bridge';
import { createClock } from './lib/clock';
import {
  DEFAULT_PRIVACY,
  getNetworkMode,
  HOST,
  setNetworkMode,
  subscribeNetworkMode,
  applyScheduleFixture,
} from './lib/simulatedBookingService';
import { detectDeviceTimeZone, formatKeyDate, hasRepeatedTimes, isValidTimeZone, offsetDifference, zoneGenericName } from './lib/time';
import type { HourCycle, NetworkMode, ThemeChoice } from './types';

const params = new URLSearchParams(window.location.search);
applyScheduleFixture(params.get('schedule'));

function initialClock() {
  const fixed = params.get('now');
  const parsed = fixed ? Date.parse(fixed) : NaN;
  return createClock(Number.isNaN(parsed) ? Date.now() : parsed);
}

function initialZone(): string {
  const fromUrl = params.get('tz');
  if (fromUrl && isValidTimeZone(fromUrl)) return fromUrl;
  return detectDeviceTimeZone();
}

function defaultHourCycle(): HourCycle {
  try {
    const hc = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle;
    return hc === 'h23' || hc === 'h24' ? '24h' : '12h';
  } catch {
    return '12h';
  }
}

function readPref<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage can be unavailable (private mode); preferences just won't persist */
  }
}

export function App() {
  const [clock] = useState(initialClock);
  const now = clock.origin;
  const [guestZone, setGuestZone] = useState(initialZone);
  const [hourCycle, setHourCycle] = useState<HourCycle>(() => readPref('tb.hourCycle', defaultHourCycle()));
  const [compare, setCompare] = useState(() => readPref<'on' | 'off'>('tb.compare', 'off') === 'on');
  const [theme, setTheme] = useState<ThemeChoice>(() => readPref('tb.theme', 'system'));
  const [network, setNetwork] = useState<NetworkMode>(getNetworkMode());
  const [announcement, setAnnouncement] = useState('');
  const [shareHostTime, setShareHostTime] = useState(
    () => (params.get('share') ?? (DEFAULT_PRIVACY.shareLocalTime ? 'on' : 'off')) !== 'off',
  );

  const booker = useBooker({ guestZone, clock });
  const slotListRef = useRef<SlotListHandle>(null);
  const keyboardDate = useRef(false);

  const announce = useCallback((text: string) => {
    // Clear first so repeating the same sentence is still announced.
    setAnnouncement('');
    requestAnimationFrame(() => setAnnouncement(text));
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    writePref('tb.theme', theme);
  }, [theme]);

  // One-shot failure modes reset themselves inside the simulated API; mirror that in the select.
  useEffect(() => subscribeNetworkMode(setNetwork), []);

  const changeZone = useCallback(
    (zone: string) => {
      setGuestZone(zone);
      const diff = offsetDifference(zone, booker.hostZone, now);
      announce(
        `Times now shown in ${zoneGenericName(zone, now)}.${
          diff === 0 || !shareHostTime ? '' : ` ${hostTimeSpoken(HOST.firstName, diff)}.`
        }`,
      );
    },
    [announce, booker.hostZone, now, shareHostTime],
  );

  const preset = GUEST_PRESETS.find((p) => (p.zone ?? detectDeviceTimeZone()) === guestZone)?.label ?? 'custom';

  // Announce data changes once they land.
  const lastAnnounced = useRef('');
  useEffect(() => {
    if (booker.load !== 'ready' || booker.step !== 'select') return;
    const key = `${booker.month.year}-${booker.month.month}-${guestZone}`;
    if (lastAnnounced.current === key) return;
    lastAnnounced.current = key;
    const days = booker.monthDays.filter((d) => booker.slotsByDate.has(d)).length;
    const label = formatKeyDate(`${booker.month.year}-${String(booker.month.month).padStart(2, '0')}-01`, 'monthYear');
    announce(`${label}: ${days === 0 ? 'no available days' : `${days} days with available times`}.`);
  }, [booker.load, booker.month, booker.monthDays, booker.slotsByDate, booker.step, guestZone, announce]);

  // Say it when a zone change moved the guest to another date (the list shows it too).
  useEffect(() => {
    if (booker.movedFrom && booker.selectedDate) {
      announce(
        `No open times on ${formatKeyDate(booker.movedFrom, 'long')} in ${zoneGenericName(guestZone, now)}. Showing ${formatKeyDate(booker.selectedDate, 'long')}.`,
      );
    }
  }, [booker.movedFrom, booker.selectedDate, guestZone, now, announce]);

  // Move keyboard users from the calendar straight to the times they just revealed.
  useEffect(() => {
    if (keyboardDate.current && booker.daySlots.length) {
      keyboardDate.current = false;
      slotListRef.current?.focusFirst();
    }
  }, [booker.daySlots]);

  const returnFocusTo = useRef<number | null>(null);

  return (
    <>
      <SiteHeader
        theme={theme}
        onTheme={setTheme}
        guestPreset={preset}
        onGuestPreset={(label) => {
          const p = GUEST_PRESETS.find((x) => x.label === label);
          if (p) changeZone(p.zone ?? detectDeviceTimeZone());
        }}
        shareHostTime={shareHostTime}
        onShareHostTime={setShareHostTime}
        network={network}
        onNetwork={setNetworkMode}
      />

      <main className="page">
        {booker.step === 'done' && booker.booking ? (
          <div className="card card-confirm">
            <Confirmation
              booking={booker.booking}
              hostZone={booker.hostZone}
              hourCycle={hourCycle}
              shareHostTime={shareHostTime}
              now={clock.now()}
              onBookAnother={booker.reset}
            />
          </div>
        ) : booker.step === 'details' && booker.selectedSlot ? (
          <div className="card card-details">
            <EventMeta
              booker={booker}
              clock={clock}
              hourCycle={hourCycle}
              shareHostTime={shareHostTime}
              onZoneChange={changeZone}
              chosen={booker.selectedSlot}
            />
            <div className="details-pane">
              <BookingForm
                submitting={booker.submitting}
                onBack={() => {
                  returnFocusTo.current = booker.selectedSlot?.start ?? null;
                  booker.backToSelect();
                  requestAnimationFrame(() => {
                    if (returnFocusTo.current != null) slotListRef.current?.focusSlot(returnFocusTo.current);
                  });
                }}
                onSubmit={booker.submit}
              />
            </div>
          </div>
        ) : (
          <div className="card card-booker" data-has-date={booker.selectedDate ? '' : undefined}>
            <EventMeta
              booker={booker}
              clock={clock}
              hourCycle={hourCycle}
              shareHostTime={shareHostTime}
              onZoneChange={changeZone}
            />
            <MonthCalendar
              booker={booker}
              onDateChosen={(key, viaKeyboard) => {
                // Choosing the date that's already shown (often today, picked automatically) doesn't
                // change the list, so take keyboard users to its times directly.
                if (viaKeyboard && key === booker.selectedDate) slotListRef.current?.focusFirst();
                keyboardDate.current = viaKeyboard && key !== booker.selectedDate;
                booker.selectDate(key);
                const daySlots = booker.slotsByDate.get(key) ?? [];
                const repeats = hasRepeatedTimes(daySlots.map((s) => s.start), guestZone);
                announce(`${formatKeyDate(key, 'long')}: ${daySlots.length} times available.${repeats ? ` ${REPEATED_TIMES_NOTE}` : ''}`);
                if (!viaKeyboard && window.matchMedia('(max-width: 899px)').matches) {
                  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                  requestAnimationFrame(() =>
                    slotListRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }),
                  );
                }
              }}
            />
            <SlotList
              ref={slotListRef}
              slots={booker.daySlots}
              selectedDate={booker.selectedDate}
              guestZone={guestZone}
              hostZone={booker.hostZone}
              load={booker.load}
              conflict={booker.conflict}
              chosenStart={booker.selectedSlot?.start ?? null}
              movedFrom={booker.movedFrom}
              nothingOpen={booker.nothingOpen}
              onSelect={booker.chooseSlot}
              hourCycle={hourCycle}
              onHourCycleChange={(c) => {
                setHourCycle(c);
                writePref('tb.hourCycle', c);
              }}
              // The host-time column exists only when the clocks differ and the host shares their time.
              canCompare={booker.bridge.differenceMinutes !== 0 && shareHostTime}
              compare={compare}
              onCompareChange={(v) => {
                setCompare(v);
                writePref('tb.compare', v ? 'on' : 'off');
              }}
            />
          </div>
        )}
      </main>

      <footer className="site-footer">
        <p>{SIMULATION_DISCLOSURE}</p>
      </footer>

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </>
  );
}

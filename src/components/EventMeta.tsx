import type { Booker } from '../hooks/useBooker';
import type { Clock } from '../lib/clock';
import { EVENT, HOST } from '../lib/simulatedBookingService';
import { hostTimeLine, hostTimeSpoken } from '../lib/bridge';
import type { HourCycle, Slot } from '../types';
import { startOfDay } from '../lib/time';
import { ClockChangeNote } from './ClockChangeNote';
import { ClockIcon, HostTimeIcon, VideoIcon } from './Icons';
import { TimeComparison } from './TimeComparison';
import { TimezonePicker } from './TimezonePicker';

export function EventMeta(props: {
  booker: Booker;
  clock: Clock;
  hourCycle: HourCycle;
  shareHostTime: boolean;
  onZoneChange: (zone: string) => void;
  /** On the details step the chosen time replaces the zone picker. */
  chosen?: Slot | null;
}) {
  const { booker, clock, hourCycle, shareHostTime, onZoneChange, chosen } = props;
  return (
    <div className="meta">
      <div className="avatar" aria-hidden="true">
        {HOST.initials}
      </div>
      {/* Read as one phrase: "15 min introduction, with Arjun Mehta" — the guest books a meeting with the host. */}
      <h1 className="meta-title">{EVENT.title}</h1>
      <p className="meta-host">With {HOST.name}</p>

      {chosen && (
        <div className="meta-chosen">
          <TimeComparison
            slot={chosen}
            guestZone={booker.guestZone}
            hostZone={booker.hostZone}
            hostFirstName={HOST.firstName}
            hostCity={HOST.city}
            showHost={shareHostTime}
            hourCycle={hourCycle}
            now={clock.now()}
          />
        </div>
      )}

      <ul className="meta-list">
        <li>
          <ClockIcon className="meta-icon" />
          <span>{EVENT.lengthMinutes} min</span>
        </li>
        <li>
          <VideoIcon className="meta-icon" />
          <span>Cal Video</span>
        </li>
        {!chosen && (
          <li className="meta-tz">
            <TimezonePicker value={booker.guestZone} onChange={onZoneChange} at={offsetsAt(booker, clock.origin)} />
          </li>
        )}
        {!chosen && shareHostTime && <HostTimeRow booker={booker} />}
      </ul>
    </div>
  );
}

/**
 * One relative-time line: "Arjun’s time is 12h 30m ahead". The difference is for the
 * date being viewed. A clock change appears only if it affects that date.
 */
function HostTimeRow({ booker }: { booker: Booker }) {
  const { bridge, selectedChange } = booker;
  const diff = bridge.differenceMinutes;
  if (diff === 0 && !selectedChange) return null;
  return (
    <li className="meta-hosttime" id="bridge-note">
      <HostTimeIcon className="meta-icon" />
      <div className="hosttime">
        <p className="hosttime-main">
          <span aria-hidden="true">{hostTimeLine(HOST.firstName, diff)}</span>
          <span className="sr-only">{hostTimeSpoken(HOST.firstName, diff)}</span>
        </p>
        {selectedChange && <ClockChangeNote change={selectedChange} hostFirstName={HOST.firstName} />}
      </div>
    </li>
  );
}

/**
 * GMT offsets in the zone list follow the date being viewed (its first time, else midday),
 * not today: after a clock change, today's offset would be wrong for that date.
 */
function offsetsAt(booker: Booker, today: number): number {
  if (!booker.selectedDate) return today;
  return booker.daySlots[0]?.start ?? startOfDay(booker.guestZone, booker.selectedDate) + 12 * 3_600_000;
}

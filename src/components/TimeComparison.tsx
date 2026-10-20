import { meetingOccurrence, OCCURRENCE_TEXT } from '../lib/bridge';
import { dateKey, formatKeyDate, formatTime, offsetDifference, spokenUtcOffset, zoneCity, zoneGenericName } from '../lib/time';
import type { HourCycle, Instant, Slot } from '../types';

/**
 * One meeting, two clocks, read top to bottom:
 *   Your time       — date, time, zone   (primary)
 *   Arjun’s time    — date, time, zone   (secondary, only if the host shares it)
 * Dates are always written out, so a day change is explicit without a badge.
 * The times are exact for the meeting date, so no clock-change note is needed here.
 * Used on the details step and the confirmation so both read identically.
 */
export function TimeComparison(props: {
  slot: Slot;
  guestZone: string;
  hostZone: string;
  hostFirstName: string;
  /** Where the host works from, shown with their zone. */
  hostCity: string;
  /** Host's privacy setting: whether their local time may be shown. */
  showHost: boolean;
  hourCycle: HourCycle;
  now: Instant;
}) {
  const { slot, guestZone, hostZone, hostFirstName, hourCycle } = props;
  const differs = offsetDifference(guestZone, hostZone, slot.start) !== 0;
  const showHost = props.showHost && differs;
  const range = (zone: string) => `${formatTime(slot.start, zone, hourCycle)} – ${formatTime(slot.end, zone, hourCycle)}`;
  // When the clocks repeat an hour, the plain range is followed by which occurrence it is
  // (screen readers also hear the UTC offset). Ordinary meetings show nothing extra.
  const when = (zone: string) => {
    const occurrence = meetingOccurrence(slot.start, slot.end, zone);
    if (!occurrence) return null;
    return (
      <p className="tc-when">
        {OCCURRENCE_TEXT[occurrence]}
        <span className="sr-only">
          , {occurrence === 'during' ? `starts at ${spokenUtcOffset(zone, slot.start)}, ends at ${spokenUtcOffset(zone, slot.end)}` : spokenUtcOffset(zone, slot.start)}
        </span>
      </p>
    );
  };
  const longDate = (zone: string) => formatKeyDate(dateKey(zone, slot.start), 'longNoYear');

  return (
    <div className="tc">
      <section className="tc-block" aria-label="Your time">
        <p className="tc-label">Your time</p>
        <p className="tc-date">{longDate(guestZone)}</p>
        <p className="tc-time">{range(guestZone)}</p>
        {when(guestZone)}
        <p className="tc-zone">
          {zoneGenericName(guestZone, slot.start)} · {zoneCity(guestZone)}
        </p>
      </section>

      {showHost && (
        <section className="tc-block tc-block-host" aria-label={`${hostFirstName}’s time`}>
          <p className="tc-label">{hostFirstName}’s time</p>
          <p className="tc-date">{longDate(hostZone)}</p>
          <p className="tc-time">{range(hostZone)}</p>
          {when(hostZone)}
          <p className="tc-zone">
            {zoneGenericName(hostZone, slot.start)} · {props.hostCity}
          </p>
        </section>
      )}

    </div>
  );
}

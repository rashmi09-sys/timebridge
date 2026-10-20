import { useEffect, useMemo, useRef } from 'react';
import { buildIcs, googleCalendarUrl } from '../lib/calendarLinks';
import { EVENT, HOST } from '../lib/simulatedBookingService';
import type { Booking, HourCycle, Instant } from '../types';
import { CheckIcon, DownloadIcon } from './Icons';
import { TimeComparison } from './TimeComparison';

export const EXPORT_DISCLOSURE =
  'Simulated booking from TimeBridge, an independent concept not affiliated with Cal.com. No invitation was sent.';

export function Confirmation(props: {
  booking: Booking;
  hostZone: string;
  hourCycle: HourCycle;
  shareHostTime: boolean;
  now: Instant;
  onBookAnother: () => void;
}) {
  const { booking, hostZone, hourCycle, shareHostTime, now, onBookAnother } = props;
  const { slot, guestTimeZone } = booking;
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);

  const title = `${EVENT.title} between ${HOST.name} and ${booking.name}`;
  // The exported event must not pass for a real booking once it sits in someone's calendar.
  const description = `${EVENT.title} with ${HOST.name}.${booking.notes ? `\n\nNotes: ${booking.notes}` : ''}\n\n${EXPORT_DISCLOSURE}`;

  // In a calendar's day view only the title shows, so it says "Simulated" too.
  const exportTitle = `Simulated: ${title}`;
  const icsHref = useMemo(() => {
    const ics = buildIcs({ uid: booking.uid, slot, title: exportTitle, description });
    return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
  }, [booking.uid, slot, exportTitle, description]);

  return (
    <div className="confirm">
      <div className="confirm-badge" aria-hidden="true">
        <CheckIcon size={20} />
      </div>
      <h1 className="confirm-title" ref={headingRef} tabIndex={-1}>
        This meeting is scheduled
      </h1>
      <p className="confirm-sub">
        This is a simulated booking: no email or invite was sent, and {HOST.firstName} wasn’t notified.
      </p>

      <dl className="confirm-rows">
        <dt>What</dt>
        <dd>{title}</dd>
        <dt>When</dt>
        <dd>
          <TimeComparison
            slot={slot}
            guestZone={guestTimeZone}
            hostZone={hostZone}
            hostFirstName={HOST.firstName}
            hostCity={HOST.city}
            showHost={shareHostTime}
            hourCycle={hourCycle}
            now={now}
          />
        </dd>
        <dt>Who</dt>
        <dd>
          {HOST.name} <span className="pill">Host</span>
          <br />
          {booking.name} <span className="pill">Guest</span> <span className="muted">· {booking.email}</span>
        </dd>
        <dt>Where</dt>
        <dd>
          Cal Video <span className="muted">· simulated, no meeting link created</span>
        </dd>
        {booking.notes && (
          <>
            <dt>Notes</dt>
            <dd>{booking.notes}</dd>
          </>
        )}
      </dl>

      <div className="confirm-actions">
        <span className="muted">Add to calendar</span>
        <a className="button button-secondary" href={googleCalendarUrl({ slot, title: exportTitle, description })} target="_blank" rel="noreferrer">
          Google Calendar<span className="sr-only"> (opens in a new tab)</span>
        </a>
        <a className="button button-secondary" href={icsHref} download="meeting.ics">
          <DownloadIcon size={15} /> .ics file
        </a>
      </div>
      <button type="button" className="link-button" onClick={onBookAnother}>
        Book another time
      </button>
    </div>
  );
}

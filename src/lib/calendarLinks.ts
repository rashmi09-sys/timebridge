import type { Slot } from './availability';

function stamp(instant: number): string {
  return new Date(instant).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** RFC 5545 TEXT escaping. Any line break (CRLF, CR or LF) becomes "\n", so typed notes can't add properties. */
function escapeIcs(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

/** RFC 5545 §3.1: content lines longer than 75 octets are folded (CRLF + space), never inside a UTF-8 character. */
function fold(line: string): string {
  const encoder = new TextEncoder();
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // continuation lines start with a space
    if (bytes + size > limit) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n ');
}

/** Times are written in UTC, so every calendar app places the event correctly. */
export function buildIcs(args: { uid: string; slot: Slot; title: string; description: string }): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TimeBridge concept//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${args.uid}@timebridge.local`,
    `DTSTAMP:${stamp(Date.now())}`,
    `DTSTART:${stamp(args.slot.start)}`,
    `DTEND:${stamp(args.slot.end)}`,
    `SUMMARY:${escapeIcs(args.title)}`,
    `DESCRIPTION:${escapeIcs(args.description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .map(fold)
    .join('\r\n')
    .concat('\r\n');
}

export function googleCalendarUrl(args: { slot: Slot; title: string; description: string }): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: args.title,
    dates: `${stamp(args.slot.start)}/${stamp(args.slot.end)}`,
    details: args.description,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

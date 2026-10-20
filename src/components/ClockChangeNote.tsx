import { clockChangeDetail, clockChangeLine, type ClockChange } from '../lib/bridge';
import { ChevronDownIcon } from './Icons';

/**
 * A clock change that affects the chosen date: one short line, with the plain
 * explanation in a native disclosure (keyboard and screen-reader support built in).
 */
export function ClockChangeNote({ change, hostFirstName }: { change: ClockChange; hostFirstName: string }) {
  // Keep the date and the chevron together so a wrapped line never strands either.
  const line = clockChangeLine(change);
  const [, lead, date] = line.match(/^(.*) (\S+ \S+)$/) ?? [line, line, ''];
  return (
    <details className="change-note">
      <summary className="change-note-summary">
        <span className="change-note-line">
          {lead}{' '}
          <span className="nowrap">
            {date}
            <ChevronDownIcon size={12} className="change-note-chevron" />
          </span>
        </span>
      </summary>
      <p className="change-note-detail">{clockChangeDetail(change, hostFirstName)}</p>
    </details>
  );
}

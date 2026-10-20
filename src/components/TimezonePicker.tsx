import { Combobox } from '@base-ui/react/combobox';
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  canonicalZoneName,
  formatOffset,
  getOffsetMinutes,
  zoneCity,
  zoneGenericName,
  type Instant,
} from '../lib/time';
import { CheckIcon, ChevronDownIcon, GlobeIcon, SearchIcon } from './Icons';

interface ZoneItem {
  value: string; // IANA id used for calculations
  label: string; // city
  region: string; // "Pacific Time"
  offset: string; // "GMT−7"
  offsetMinutes: number;
  search: string;
}

function listZones(now: Instant, include: string[]): ZoneItem[] {
  let ids: string[] = [];
  try {
    ids = Intl.supportedValuesOf('timeZone');
  } catch {
    ids = [];
  }
  // One entry per real zone: legacy ids (Asia/Calcutta) and current ids (Asia/Kolkata)
  // collapse together, keeping whichever spelling is currently selected.
  const byCanonical = new Map<string, string>();
  for (const id of [...ids, ...include]) {
    const key = canonicalZoneName(id);
    if (!byCanonical.has(key) || include.includes(id)) byCanonical.set(key, id);
  }
  return [...byCanonical.values()]
    .filter((id) => id.includes('/') || id === 'UTC')
    .map((id) => {
      const offsetMinutes = getOffsetMinutes(id, now);
      const offset = formatOffset(offsetMinutes);
      const region = zoneGenericName(id, now);
      const canonical = canonicalZoneName(id);
      const label = zoneCity(id);
      return {
        value: id,
        label,
        region,
        offset,
        offsetMinutes,
        search: `${label} ${canonical} ${region} ${offset} ${offset.replace('−', '-')}`.toLowerCase(),
      };
    })
    .sort((a, b) => a.offsetMinutes - b.offsetMinutes || a.label.localeCompare(b.label));
}

// Tie-breaker only: when several zones match equally, the ones most people mean come first.
const MAJOR = new Set([
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Toronto',
  'America/Vancouver', 'America/Mexico_City', 'America/Sao_Paulo', 'America/Bogota', 'America/Argentina/Buenos_Aires',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Amsterdam', 'Europe/Istanbul',
  'Europe/Kyiv', 'Europe/Moscow', 'Africa/Lagos', 'Africa/Cairo', 'Africa/Johannesburg', 'Africa/Nairobi',
  'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Calcutta', 'Asia/Dhaka', 'Asia/Bangkok', 'Asia/Jakarta',
  'Asia/Singapore', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Tokyo', 'Asia/Seoul', 'Asia/Manila',
  'Australia/Sydney', 'Australia/Melbourne', 'Pacific/Auckland', 'Pacific/Honolulu',
]);

function rank(item: ZoneItem, q: string): number {
  const city = item.label.toLowerCase();
  const tier = city === q ? 0 : city.startsWith(q) ? 1 : city.split(' ').some((w) => w.startsWith(q)) ? 2 : 3;
  return tier * 2 + (MAJOR.has(item.value) ? 0 : 1);
}

export function TimezonePicker(props: {
  value: string;
  onChange: (zone: string) => void;
  /** The instant offsets are shown for: the date being viewed, so a November date lists November offsets. */
  at: Instant;
}) {
  const { value, onChange, at } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Typing on the closed trigger must never silently change the zone (the default
  // type-ahead would). Instead, open the search and start the query with that key.
  function onTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement> & { preventBaseUIHandler?: () => void }) {
    if (e.key.length !== 1 || e.metaKey || e.ctrlKey || e.altKey || e.key === ' ') return;
    e.preventDefault();
    e.preventBaseUIHandler?.();
    setQuery((q) => (open ? q : '') + e.key);
    setOpen(true);
  }
  const zones = useMemo(() => listZones(at, [value]), [at, value]);
  const selected = zones.find((z) => z.value === value) ?? null;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return zones;
    return zones
      .filter((z) => z.search.includes(q))
      .map((z, i) => ({ z, i, r: rank(z, q) }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map(({ z }) => z);
  }, [zones, query]);

  return (
    <Combobox.Root
      items={zones}
      value={selected}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
      inputValue={query}
      onInputValueChange={setQuery}
      onValueChange={(item) => {
        if (item && !Array.isArray(item)) onChange((item as ZoneItem).value);
      }}
      itemToStringLabel={(item: ZoneItem) => item.label}
      isItemEqualToValue={(a: ZoneItem, b: ZoneItem) => a.value === b.value}
      filteredItems={filtered}
      autoHighlight
    >
      <Combobox.Trigger
        className="tz-trigger"
        onKeyDown={onTriggerKeyDown}
        aria-label={`Your time zone: ${selected?.region ?? value}, ${selected?.label ?? ''}. Times are shown in this zone. Change time zone`}
      >
        <GlobeIcon className="meta-icon" />
        <span className="tz-trigger-text">
          <span className="tz-trigger-name">
            {selected?.region ?? value}
            <ChevronDownIcon size={14} className="tz-trigger-chevron" />
          </span>
          {/* No GMT offset here: it changes with the clocks, so for dates after a change
              today's offset would be wrong. The zone name is always right. */}
          <span className="tz-trigger-city">{selected?.label}</span>
        </span>
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner className="layer" align="start" sideOffset={6} collisionPadding={12}>
          <Combobox.Popup className="popup tz-popup" aria-label="Choose your time zone" initialFocus={inputRef}>
            <div className="tz-search">
              <SearchIcon size={15} />
              <Combobox.Input ref={inputRef} className="tz-input" placeholder="City, region or GMT offset" aria-label="Search time zones" />
            </div>
            <Combobox.Empty className="tz-empty">No time zone matches. Try a city like “Chicago” or an offset like “GMT+2”.</Combobox.Empty>
            <Combobox.List className="tz-list">
              {(item: ZoneItem) => (
                <Combobox.Item key={item.value} value={item} className="tz-item">
                  <span className="tz-item-main">
                    <span className="tz-item-city">{item.label}</span>
                    <span className="tz-item-region">{item.region}</span>
                  </span>
                  <span className="tz-item-offset">{item.offset}</span>
                  <Combobox.ItemIndicator className="tz-item-check">
                    <CheckIcon size={14} />
                  </Combobox.ItemIndicator>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

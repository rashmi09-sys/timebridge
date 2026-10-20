import { Menu } from '@base-ui/react/menu';
import { Dialog } from '@base-ui/react/dialog';
import { Popover } from '@base-ui/react/popover';
import { Switch } from '@base-ui/react/switch';
import { useEffect, useId, useRef, useState, type Ref } from 'react';
import type { NetworkMode, ThemeChoice } from '../types';
import { CheckIcon, CloseIcon, MonitorIcon, MoonIcon, SlidersIcon, SunIcon } from './Icons';
import { SelectField, type SelectOption } from './SelectField';

export const GUEST_PRESETS: Array<{ label: string; zone: string | null }> = [
  { label: 'This device', zone: null },
  { label: 'Los Angeles', zone: 'America/Los_Angeles' },
  { label: 'New York', zone: 'America/New_York' },
  { label: 'London', zone: 'Europe/London' },
  { label: 'Kathmandu', zone: 'Asia/Kathmandu' },
  { label: 'Tokyo', zone: 'Asia/Tokyo' },
  { label: 'Same as host (India)', zone: 'Asia/Kolkata' },
];

const THEMES: Array<{ value: ThemeChoice; label: string; Icon: typeof SunIcon }> = [
  { value: 'system', label: 'System', Icon: MonitorIcon },
  { value: 'light', label: 'Light', Icon: SunIcon },
  { value: 'dark', label: 'Dark', Icon: MoonIcon },
];

export const SIMULATION_DISCLOSURE =
  'Availability and bookings are simulated in your browser. TimeBridge is not affiliated with or connected to Cal.com.';

/**
 * Quiet frame around the booking card: attribution on the left, a theme menu
 * and the demo settings on the right. Everything test-related lives in the
 * settings drawer, so the default view reads as the product, not a test harness.
 */
export function SiteHeader(props: {
  theme: ThemeChoice;
  onTheme: (t: ThemeChoice) => void;
  guestPreset: string;
  onGuestPreset: (label: string) => void;
  shareHostTime: boolean;
  onShareHostTime: (v: boolean) => void;
  network: NetworkMode;
  onNetwork: (m: NetworkMode) => void;
}) {
  return (
    <header className="site-header">
      <p className="site-brand">
        <span className="site-brand-name">TimeBridge</span>
        <span className="site-brand-sep" aria-hidden="true">
          ·
        </span>
        <span className="site-brand-note">Independent booking UX concept</span>
      </p>
      <div className="site-actions">
        <ThemeMenu theme={props.theme} onTheme={props.onTheme} />
        <DemoSettings {...props} />
      </div>
    </header>
  );
}

function ThemeMenu({ theme, onTheme }: { theme: ThemeChoice; onTheme: (t: ThemeChoice) => void }) {
  const current = THEMES.find((t) => t.value === theme) ?? THEMES[0];
  return (
    <Menu.Root>
      <Menu.Trigger className="header-button header-icon-button" aria-label={`Theme: ${current.label}`}>
        <current.Icon size={16} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="layer" align="end" sideOffset={6} collisionPadding={12}>
          <Menu.Popup className="popup menu-popup">
            <Menu.RadioGroup value={theme} onValueChange={(v) => onTheme(v as ThemeChoice)}>
              <Menu.GroupLabel className="menu-label">Theme</Menu.GroupLabel>
              {THEMES.map(({ value, label, Icon }) => (
                <Menu.RadioItem key={value} value={value} className="popup-item menu-item" closeOnClick>
                  <Icon size={15} className="menu-item-icon" />
                  <span>{label}</span>
                  <Menu.RadioItemIndicator className="popup-item-check">
                    <CheckIcon size={14} />
                  </Menu.RadioItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Below this width a 340px popover can't sit comfortably beside the trigger, so a bottom sheet is used. */
const SHEET_QUERY = '(max-width: 520px)';

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [query]);
  return matches;
}

const NETWORK_OPTIONS: ReadonlyArray<SelectOption<NetworkMode>> = [
  { value: 'normal', label: 'Normal' },
  { value: 'slow', label: 'Slow responses' },
  { value: 'fail-next-load', label: 'Fail next load' },
  { value: 'conflict-next-booking', label: 'Slot taken on confirmation' },
];

interface DemoSettingsProps {
  guestPreset: string;
  onGuestPreset: (label: string) => void;
  shareHostTime: boolean;
  onShareHostTime: (v: boolean) => void;
  network: NetworkMode;
  onNetwork: (m: NetworkMode) => void;
}

/**
 * Reviewer controls, closed by default.
 * - Desktop and tablet: a Base UI Popover anchored under its button (end-aligned,
 *   collision-aware). It floats above the page without shifting the layout, and closes
 *   on Escape or an outside click. Nested select popups count as inside it.
 * - Phones: the same content in a modal bottom sheet (Base UI Dialog) with a close button.
 * Keyboard opens land on the first setting; focus returns to the button on close.
 */
function DemoSettings(props: DemoSettingsProps) {
  const [open, setOpen] = useState(false);
  const sheet = useMediaQuery(SHEET_QUERY);
  const firstControl = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // Crossing the breakpoint while open would swap components under the user; close instead.
  useEffect(() => setOpen(false), [sheet]);
  const initialFocus = (type: string) => (type === 'keyboard' ? firstControl.current : panel.current);
  const trigger = (
    <>
      <SlidersIcon size={15} />
      <span className="header-settings-label">Demo settings</span>
    </>
  );

  if (sheet) {
    return (
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger className="header-button header-settings" aria-label="Demo settings">
          {trigger}
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Backdrop className="settings-backdrop" />
          <Dialog.Popup ref={panel} className="popup settings-panel settings-sheet" aria-modal initialFocus={initialFocus}>
            <div className="settings-head">
              <Dialog.Title className="settings-title">Demo settings</Dialog.Title>
              <Dialog.Close className="icon-button settings-close" aria-label="Close demo settings">
                <CloseIcon size={16} />
              </Dialog.Close>
            </div>
            <SettingsBody {...props} firstControl={firstControl} />
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className="header-button header-settings" aria-label="Demo settings">
        {trigger}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner className="layer" side="bottom" align="end" sideOffset={6} collisionPadding={12}>
          <Popover.Popup ref={panel} className="popup settings-panel settings-popover" initialFocus={initialFocus}>
            <Popover.Title className="settings-title">Demo settings</Popover.Title>
            <SettingsBody {...props} firstControl={firstControl} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function SettingsBody(props: DemoSettingsProps & { firstControl: Ref<HTMLButtonElement> }) {
  const id = useId();
  const guestOptions: SelectOption<string>[] = GUEST_PRESETS.map((p) => ({ value: p.label, label: p.label }));
  // A zone picked on the booking page isn't one of the presets; show it as such, not as blank.
  if (props.guestPreset === 'custom') guestOptions.push({ value: 'custom', label: 'Other (chosen on the page)', disabled: true });
  return (
    <>
      <SelectField
        label="Guest timezone"
        value={props.guestPreset}
        options={guestOptions}
        onValueChange={props.onGuestPreset}
        triggerRef={props.firstControl}
      />

      <div className="settings-switch">
        <span className="settings-switch-text">
          <span className="settings-switch-label" id={`${id}-share`}>
            Host shares local time
          </span>
          <span className="settings-hint" id={`${id}-share-hint`}>
            Shows the host’s time to guests
          </span>
        </span>
        <Switch.Root
          className="switch"
          checked={props.shareHostTime}
          onCheckedChange={props.onShareHostTime}
          aria-labelledby={`${id}-share`}
          aria-describedby={`${id}-share-hint`}
        >
          <Switch.Thumb className="switch-thumb" />
        </Switch.Root>
      </div>

      <SelectField label="Network simulation" value={props.network} options={NETWORK_OPTIONS} onValueChange={props.onNetwork} />

      <p className="settings-note">Simulated data. Not connected to Cal.com.</p>
    </>
  );
}

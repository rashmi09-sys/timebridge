import { Select } from '@base-ui/react/select';
import type { Ref } from 'react';
import { CheckIcon, ChevronDownIcon } from './Icons';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

/**
 * A labelled single-choice select on Base UI Select, styled with the shared popup layer
 * (`.popup`, `.popup-item`) so it reads like the theme menu: same surface, item height,
 * highlight bar and check indicator. The popup drops below the trigger at the trigger's
 * width (not the macOS-style overlay), and stays inside the viewport.
 *
 * Same composition as coss ui's Select (Root + Label + Trigger/Value/Icon + Popup/Item with
 * indicator), built directly on Base UI with this project's CSS rather than Tailwind.
 */
export function SelectField<T extends string>(props: {
  label: string;
  value: T;
  options: ReadonlyArray<SelectOption<T>>;
  onValueChange: (value: T) => void;
  triggerRef?: Ref<HTMLButtonElement>;
}) {
  const { label, value, options, onValueChange, triggerRef } = props;
  return (
    <Select.Root
      items={options}
      value={value}
      onValueChange={(v) => {
        if (v != null) onValueChange(v as T);
      }}
    >
      <div className="select-field">
        <Select.Label className="select-label">{label}</Select.Label>
        <Select.Trigger className="select-trigger" ref={triggerRef}>
          <Select.Value className="select-value" />
          <Select.Icon className="select-icon">
            <ChevronDownIcon size={14} />
          </Select.Icon>
        </Select.Trigger>
      </div>
      <Select.Portal>
        <Select.Positioner className="layer" alignItemWithTrigger={false} sideOffset={4} collisionPadding={12}>
          <Select.Popup className="popup select-popup">
            <Select.List>
              {options.map((o) => (
                <Select.Item key={o.value} value={o.value} disabled={o.disabled} className="popup-item select-item">
                  <Select.ItemText>{o.label}</Select.ItemText>
                  <Select.ItemIndicator className="popup-item-check">
                    <CheckIcon size={14} />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

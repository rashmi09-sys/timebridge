/**
 * Moves focus in response to a key press and asks the browser to show the focus ring.
 *
 * Browsers decide whether script-moved focus matches :focus-visible. Safari doesn't show it
 * after an earlier mouse click, even when a key press moved the focus: clicking a date and
 * then pressing an arrow key would leave the new date with no visible focus. The
 * `focusVisible` option (Safari 18.4, Firefox 104, Chrome 145) states the intent; older
 * browsers ignore it and keep their own heuristic.
 */
export function focusFromKeyboard(el: HTMLElement | null | undefined) {
  // `focusVisible` is not in TypeScript's DOM types yet.
  el?.focus({ focusVisible: true } as FocusOptions & { focusVisible: boolean });
}

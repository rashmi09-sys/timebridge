# Accessibility: what is checked, and what is not

TimeBridge aims at WCAG 2.2 AA. This page separates what automated tests check from what still needs a person. **Passing automated checks is not a conformance claim.**

## Checked automatically

These run in CI in five Playwright projects, all passing in [run 39385853563](https://github.com/rashmi09-sys/timebridge/actions/runs/39385853563) (2026-10-20, Playwright 1.56):

| Project | Engine | Result |
|---|---|---|
| desktop-chromium | Chromium 141 | 104 passed, 0 failed, 1 skipped |
| desktop-firefox | Firefox 142 | 104 passed, 0 failed, 1 skipped |
| desktop-webkit | WebKit 26 | 104 passed, 0 failed, 1 skipped |
| mobile-chromium | Chromium 141, emulating a Pixel 7 | 84 passed, 0 failed, 21 skipped |
| mobile-webkit | WebKit 26, emulating an iPhone 13 | 84 passed, 0 failed, 21 skipped |

These are Playwright's own Linux builds of each engine, not the browsers people install. The two phone projects are **simulated**: they set the screen size, touch support and user agent on a desktop engine. They are not tests on real phones (see [Other known limitations](#other-known-limitations)).

- **axe-core** (WCAG 2.0, 2.1 and 2.2 A + AA rules): zero violations across the calendar, theme menu, Demo settings with a select open, time comparison, open zone list, form errors, confirmation, the open clock-change detail and the error-recovery screen, in light and dark themes.
- **Text contrast (1.4.3)** and **non-text contrast (1.4.11)**: design-token pairs are unit-tested with the WCAG formula (`tests/unit/contrast.test.ts`). The rendered edges of the text fields, both selects, the switch track and thumb, and the selected 12h/24h segment are measured in the browser in both themes and must reach 3:1 against what is next to them.
- **Keyboard:** a full booking by keyboard only; a visible focus ring when keys move focus, including after a mouse click; the calendar grid (arrows, Home/End, PageUp/PageDown); the time list's single tab stop; focus after each step change, after *Back*, after a conflict and after a crash; Escape order in nested popups; focus return.
- **Reflow and targets:** no horizontal scroll from 1440 px down to 375 px; 24 px minimum targets; reduced motion.
- **Scrolling:** on desktop the time list scrolls inside the card; focus moved with End/Home stays fully in view, and the wheel scrolls the list, not the page. On phones and at 640 px (200% zoom) there is no nested scroll area.
- **Repeated clock times:** when clocks go back, two different instants never share a visible or spoken label: the visible time carries “Before clocks change” or “After clocks change”, and the spoken name adds the UTC offset (“1:15 AM your time, after clocks change, UTC minus 8”). Arrow keys reach both in time order, and *Back* restores the one that was chosen. The explanation line is plain text above the list (described-by on the list) and is added once to the date announcement; it is not a live region.

### Non-text contrast: what counts as essential

Control boundaries that identify a control use `--control-border` (≥ 3:1 against the card, measured 3.51:1 light and 3.90:1 dark): text fields, select triggers, the zone search field, the switch track, and the ring on the selected 12h/24h segment.

Time buttons and calendar days keep lighter borders and fills. They are identified by their text (the time or day number), which meets 4.5:1, and an unavailable date is distinguished from an available one by text contrast (7.44:1 light, 5.70:1 dark) and by its accessible name. This follows WCAG's note that a boundary is not required when the control is identifiable by its text. A reviewer could reasonably argue for stronger tile edges; it would be a visual change, so it is left for a design decision.

## Not yet tested by a person

**No manual screen-reader testing has been performed.** The checklist below is what should be done before claiming screen-reader support. Each item lists what to listen for.

| Pairing | Status |
|---|---|
| VoiceOver + Safari (macOS) | Not yet performed |
| VoiceOver + Safari (iOS) | Not yet performed |
| NVDA + Firefox (Windows) | Not yet performed |
| JAWS + Chrome (Windows) | Not yet performed |
| TalkBack + Chrome (Android) | Not yet performed |

### 1. Choosing a date

- [ ] On load, the grid is announced with its month and the selected date; each day reads its full date, "today" where it applies, and the number of open times ("Tuesday, October 13, 2026, today, 10 times available").
- [ ] Arrow keys move by day and week; PageUp/PageDown change month and the new month is announced once, after its data loads, with the right count.
- [ ] Days with no times read "no availability" and can't be chosen.

### 2. Choosing a time

- [ ] Enter on a date moves to the first time; each time reads "9:00 PM your time" and, with *Show host's time* on, the host's time and date when it differs.
- [ ] In the repeated hour when clocks go back, the two 1:15 AMs are clearly different by ear ("before clocks change, UTC minus 7" / "after clocks change, UTC minus 8"), and "UTC minus 8" is read naturally.
- [ ] Choosing Nov 1 (with `?schedule=every-day`) reads "Clocks go back on this day. Some times appear twice." once, with the count, and not again on every time.
- [ ] After *Back*, the chosen time is focused and announced as current.

### 3. Changing the guest's time zone

- [ ] The zone combobox announces its value, the search field, the result count as you type, and the chosen zone.
- [ ] The polite announcement after a zone change (and the "No open times on …, so showing …" message when the date moves) is read once, without interrupting.

### 4. Details, conflicts and confirmation

- [ ] Field errors are read when Confirm is pressed and when leaving a mistyped email; they stop being read once fixed.
- [ ] A conflict ("was just booked by someone else") is read, and focus lands on it.
- [ ] The confirmation heading is read on arrival, followed by the simulated-booking notice.

### 5. Demo settings, theme menu and error screen

- [ ] Demo settings opens as a dialog on its first control; nested selects announce their options; Escape closes the inner popup first.
- [ ] On phones, the bottom sheet is modal: content behind it is not reachable by swiping.
- [ ] After a crash, "Something went wrong" is read and *Try again* / *Start over* are reachable.

## Other known limitations

- **Real devices:** not tested. Phone layouts are checked only in simulated phones: a Pixel 7 profile in Chromium and an iPhone 13 profile in WebKit. That covers screen size, touch events and layout, but not Chrome on Android, Safari on iOS, real touch input, on-screen keyboards, or TalkBack and VoiceOver.
- **Text spacing (1.4.12) and browser text-only zoom:** not tested automatically.
- **Windows High Contrast / forced colours:** CSS rules exist but are unverified.
- **Locale:** dates and times follow the browser's locale (tested in en-US, en-GB and ja-JP). Interface copy and zone names are English only, and weeks start on Sunday in every locale.
- **Browsers:** the suite passes in Playwright's Chromium, Firefox and WebKit builds on Linux. WebKit on Linux is not Safari, so Safari on macOS and iOS has not been tested, nor have Chrome, Firefox or Edge on Windows and macOS.
- **Focus ring in older Safari:** keyboard moves in the calendar and time list call `focus({ focusVisible: true })`, supported from Safari 18.4, Firefox 104 and Chrome 145. Safari before 18.4 ignores it, so after a mouse click, arrowing through dates or times there may show no focus ring. Chrome before 145 shows the ring through its own rules (tested in Chromium 141).

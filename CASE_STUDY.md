# TimeBridge: what a meeting time means for both people

*A design-engineering concept for Cal.com's booking page, by Rashmi Basavaraj. Not affiliated with Cal.com. Availability is simulated.*

## 1. What we verified, and what we didn't

| | Finding | Source |
|---|---|---|
| ✅ Verified | Cal.com converts correctly for a guest in `America/Los_Angeles`: slots appear in the guest's zone. | Live booking test on my own Cal.com event, Oct 2026 |
| ✅ Verified | The guest's confirmation correctly shows Los Angeles time (`2:15–2:30 AM PDT`). | Same test |
| ✅ Verified | With a host working 9–5 in India, a Los Angeles guest is offered times around midnight and early morning. | Same test |
| ✅ Verified | The tested booking flow shows no host-local time or explanation of the gap. | Same test |
| ✅ Verified | On Cal.com's own booking page, keyboard navigation, full date announcements and basic VoiceOver use worked in the paths we tested. (This was Cal.com, not TimeBridge; TimeBridge has not been tested with a screen reader.) | Live manual test |
| ❌ Not established | That guests are confused, slowed down or put off by this. | No user research yet |

**So TimeBridge is a researched UX hypothesis, not a proven fix.** Cal.com's booking flow is not inaccessible or broken; the gap is context, not correctness.

**Demo identities.** The live test above used my own link. The demo uses two fictional people so the roles can't be confused: Arjun Mehta hosts from Bengaluru, and Yuki Tanaka (the example guest) books from Tokyo, 3h 30m ahead of him. The confirmation labels Arjun as Host and the guest as Guest.

## 2. The hypothesis

A guest whose available times all fall at night, with no explanation, may hesitate, assume the host is barely available, or mis-read which day the meeting falls on for the host. A small amount of context, shown at the right moment, should make the booking feel trustworthy without slowing anyone down.

## 3. What changes: three moments

**A. Understanding availability.** The left panel keeps host, duration, video and the guest's time zone, plus one line when the zones differ: **"Arjun's time is 12h 30m ahead."** Screen readers hear it written out ("12 hours 30 minutes ahead of yours"). The difference is computed for the date being viewed, so November dates in Los Angeles say 13h 30m. There are no live clocks and no paragraphs.

A clock change gets one short line, only when it falls between today and the chosen date and so actually changes the difference shown: **"Time difference changes on Oct 25"**. A native disclosure opens one plain sentence for anyone who wants it: "Clocks in London go back an hour on Oct 25. From then, Arjun's time is 5h 30m ahead." Clock-change dates are never hard-coded; they come from the IANA zone data.

**Time slots are just times.** There are no icons, markers or legends on the list; the guest reads their own clock, and the host's time sits beside it when shown.

**B. Selecting a meeting.** "Show host's time" adds a second, quieter column. The columns are labelled **"Your time | Host's time"**. The calendar date is always the guest's. If every host time is on another date, the header says it once ("Host's time · Wed 14"). If the list spans two host dates, only the rows on a different date carry a label ("· Thu 15"). Screen readers always hear the host's date when it differs.

**Times without a click.** On arrival the earliest open date in the guest's own calendar is selected and its times are listed: today if it still has times, otherwise the next open date, moving to the next month if this one has none left. The guest's zone comes from the browser; the zone picker stays for travellers. A date or month the guest picks is never changed for them afterwards, with one exception: when the guest's zone changes, a time they already chose keeps its instant (its date follows it), a picked date is kept while it still has times, and otherwise the nearest open date is shown with one line saying why ("No open times on Tue, Oct 13 in United Kingdom Time, so showing Wed, Oct 14."). The rules live in one pure, unit-tested function (`chooseDate`). Changing zones never changes Arjun's availability, only how its instants read on the guest's clock.

**Who's who.** The left panel reads "15 min introduction" then "With Arjun Mehta": the guest is booking a meeting with someone, not looking at their own calendar.

**Availability marking.** Open dates are already filled tiles with their count in the label ("Wednesday, October 14, 2026, 30 times available", counted from the real slots), and the small dot means *today*. A second dot for availability was considered and left out: it would repeat the fill and make the today dot ambiguous.

After choosing, the details panel reads "Your time" (date, time, zone), then "Arjun's time" (date, time, zone, with his city: "India Standard Time · Bengaluru"), with written-out dates and no badges. Those times are exact for the meeting date, so no clock-change note is repeated there.

**C. Confirming.** The confirmation's "When" row uses the same block, in the guest's chosen 12- or 24-hour format. The .ics file and Google Calendar link are written in UTC.

**Kept as it was:** the three-column booker, guest-zone detection and picker, the 12h/24h switch, the month → time → details → confirmation flow, and the confirmation conventions. When guest and host share a clock, the page is unchanged.

## 4. Host privacy

Showing a host's local time reveals roughly where they are. **TimeBridge doesn't assume permission.** Everything about the host (the context row, the comparison switch, the host line in the comparison, and the clock-change notes, which depend on the host's zone) appears only when the host shares their local time. The demo simulates this as a host setting ("Host shares local time" in Demo settings, or `?share=off`).

With sharing off, the page shows only the guest's own times, exactly as booking pages do today. In production this should be a host-level setting. My suggestion is on by default for personal links and team-controlled for organisations; the default needs product and legal input.

## 5. Alternatives considered

- **A world-clock panel (host / guest / UTC).** Rejected: three clocks to read where one row answers the question.
- **Both times on every slot by default.** Rejected: it doubles the reading for every guest. Kept as an opt-in switch.
- **An overlap timeline or heat-map.** Rejected: the host's hours are already fixed, so there's nothing to negotiate.
- **Colour-coding "bad" times.** Rejected: meaning by colour alone fails WCAG 1.4.1, and it passes judgement on the guest's choice.
- **A confirm-time modal before the form.** Rejected: an extra step in a flow that already has a natural review moment, the details panel.
- **Night-time markers (moon icons and a "10 PM–7 AM" legend).** Built, tested and then removed. The guest already reads their own clock, so the icon added a symbol to learn and a legend to explain it without adding information. A "late at night for you" sentence was removed earlier for the same reason.

## 6. Accessibility

- **Calendar:** WAI-ARIA date grid. One tab stop; arrows, Home/End and PageUp/PageDown move around. Each day has a full name and slot count ("Tuesday, October 13, 2026, today, 10 times available").
- **Time list:** a native list of buttons with one tab stop and Up/Down/Home/End. Choosing a date by keyboard moves focus to its first time; mouse users keep their place. After *Back*, the chosen time is the tab stop and is announced as "current" (`aria-current`).
- **Focus at every step change:** first form field, the exact time after *Back*, the confirmation heading after booking, the explanation after a conflict.
- **Announcements:** one polite live region for zone changes, month loads and date selection.
- **Native or Base UI semantics:** the clock-change detail is a native `<details>` disclosure. The switch, 12h/24h toggle and zone combobox are Base UI. Form errors are tied to their fields, and focus moves to the first error.
- **Non-text contrast (1.4.11):** control edges (text fields, selects, the zone search, the switch track, the selected 12h/24h segment) use one token that reaches 3.51:1 (light) and 3.90:1 (dark) against the card. Before this, they measured 1.47:1 and 1.60:1. Time buttons and calendar days are identified by their text, so their lighter edges were kept; the reasoning is in [`ACCESSIBILITY.md`](ACCESSIBILITY.md).
- **Repeated times:** when clocks go back, both 1:15 AMs show the plain time with a smaller line, "Before clocks change" or "After clocks change"; their spoken names add the UTC offset ("1:15 AM your time, after clocks change, UTC minus 8"). An earlier version showed "PDT"/"PST", which was exact but meaningless to most guests. When the list holds such times, one muted line above it reads "Clocks go back on this day. Some times appear twice." It is plain text in reading order, linked to the list with `aria-describedby`, and added once to the polite announcement made when the date is chosen; it isn't a live region of its own. A clock-change day without repeated open times (Arjun's real hours on Nov 1) shows no line.
- **Recovery:** a rendering error shows a short message with focus on its heading, says nothing was booked, and offers *Try again* and *Start over*.
- **Also covered:** reduced motion respected, 24px+ targets, reflow at 200% zoom (640 px) with no horizontal scroll, forced-colours rules.

## 7. Engineering notes

- **No fixed offsets.** Offsets come from `Intl` (the IANA database) for the exact instant. Wall-clock times are converted with Temporal's "compatible" rule: a repeated time takes the earlier instant, a skipped time moves past the gap.
- **Host hours** are generated in the host's own zone, so a DST-zone host keeps "9 AM" across their own change (tested with New York).
- **Legacy zone ids** such as `Asia/Calcutta` and `Europe/Kiev`, which some browsers report, are kept for maths and shown with their current spelling.
- **The page clock** can be pinned for demos but always advances. The simulated service **re-validates at booking time**: a slot taken by someone else, or one that has drifted inside the 2-hour minimum notice while the page was open, is rejected with a clear message, and availability refreshes.
- **Every sentence** comes from pure functions in `src/lib/bridge.ts`; components only render, and state lives in `useBooker`.
- **Repeated wall-clock times** are detected with the same conversion: if a time's wall clock resolves to two instants, the UI says which one in words. A meeting range is judged from both ends, because a slot starting at the first 1:45 AM ends at the second 1:00 AM; its range reads "1:45 AM – 1:00 AM", so it is labelled "Clocks go back during this meeting" rather than either side. Exports are in UTC and never depend on these words.
- **Locale:** formatting reads the browser's locale from `Intl` once. Month titles are built from `formatToParts`, so the year can be muted wherever the locale puts it ("October 2026", "2026年10月"); weekday headers and dates come from `Intl` too, replacing hard-coded English arrays and the English-only regexes that trimmed dates. Recent ICU data can put a narrow no-break space before "AM"; V8 already swaps it for a plain space, and labels now do the same so other engines should produce identical text (unverified until Firefox and WebKit run in CI).
- **Tooling:** ESLint (typescript-eslint, React hook rules, jsx-a11y) and a GitHub Actions workflow. Lint found two real issues, now fixed: an array rebuilt on every render invalidated two memoised values in `useBooker`, and an effect's dependency list was incomplete.
- **Dependencies:** React, Base UI, Inter and Cal Sans. No date library.

## 7a. Component design decisions

**The time list stays native.** It is a `<ul>` of `<button>`s. Choosing a time moves straight to the details step, so it is an *action*, not a selection: a listbox or radio group would announce a state that never persists. The one-tab-stop model matches the calendar grid next to it.

**One accessibility bug, found and fixed.** An audit of `SlotList` found that its roving tab stop was stored as an index and never reset. After pressing End on Oct 14 (11:30 PM) and then clicking Oct 15, Tab landed on **10:30 PM**, the same position mid-list, instead of the first time. A keyboard user was dropped into the middle of a new day. The fix:

- The tab stop is now **derived** from the list on screen: the time last focused in *this* list, else the time chosen earlier, else the first time. The remembered position is tied to the list's identity (date plus slot instants), so it can never carry over to another date. A list change updates the tab stop without moving focus.
- Buttons are tracked with **refs keyed by slot instant**, not looked up with a CSS selector.
- A regression test reproduces the original failure; it failed on the old code and passes now.

**What "chosen" means for an action button.** After *Back*, the previously chosen time carries `aria-current="true"` (the current item in a set) and a firmer border, with a forced-colours fallback. `aria-pressed` (a toggle) and `aria-selected` (an option in a listbox) were rejected because neither describes an action button.

**Boundaries, only where they paid off.**
- `SlotList` takes explicit props (`slots`, `selectedDate`, zones, `load`, `conflict`, `chosenStart`, `onSelect`, `canCompare`, format and comparison controls) instead of the whole booking hook. Whether a comparison is allowed (the clocks differ and the host shares their time) is decided by the parent, where the privacy setting lives.
- Ids are generated with `useId`. The page no longer looks elements up by global id: scrolling to the list and focusing a conflict notice go through the component's handle and a ref.
- The host-date rule (say a differing host date once in the column header, or only on the rows that differ; screen readers always hear it) is a pure function, `labelHostDays`, with unit tests across a shared date, mixed dates, the US clock change and another locale. The locale test caught a real bug: the year was being stripped with an English-only regex. Dates are now formatted without a year by `Intl` itself, and weekday names come from `Intl` rather than a hard-coded English list.
- Repeated-time labels live in the shared `formatTime`, not in components, so the time list, its spoken labels, the conflict notice, the details summary and the confirmation all disambiguate the same way without five separate changes. A small `ErrorBoundary` wraps the app in `main.tsx`.
- **Not done, deliberately:** no generic `TimeSlotPicker`. There is one consumer, so a reusable abstraction would be speculative.

**Base UI here, and how it maps to Cal.com's coss ui.** coss ui is Cal.com's design system: Base UI primitives styled with Tailwind CSS v4 and coss's own token set, added to a project as source through the shadcn CLI (`@coss/*`). TimeBridge does **not** use coss ui. It uses the same Base UI primitives, styled with its own CSS custom properties:

| TimeBridge | Base UI primitive | coss ui counterpart |
|---|---|---|
| Time-zone picker | Combobox | Combobox |
| 12h / 24h control | ToggleGroup + Toggle | Toggle Group (`ToggleGroup`, `ToggleGroupItem`) |
| "Show host's time", "Host shares local time" | Switch | Switch |
| Demo settings | Popover (anchored, `align="end"`); Dialog bottom sheet on phones | Popover; Sheet (`side="bottom"`) |
| Guest timezone, Network simulation | Select (`Select.Label`, `items`, `alignItemWithTrigger={false}`, `ItemIndicator`) | Select (wrapped in Field) |
| Theme control | Menu + RadioGroup | Menu |
| Time list | native `<ul>`/`<button>` | none (product-specific) |

I evaluated adopting one coss component (Sheet, Toggle Group, then Select and Popover) and chose not to. Their behaviour and accessibility come from the same Base UI parts TimeBridge already uses. Their value is Tailwind styling and variants, which would mean adding Tailwind and a second token set next to `tokens.css`: duplicated styling infrastructure for no measurable gain in this codebase. In Cal.com's codebase these screens would be composed from coss components. The parts specific to TimeBridge (time-zone-correct labelling, privacy rules, focus flow) would sit on top unchanged.

**One interaction system for floating surfaces.** The theme menu was the reference. Demo settings became a popover anchored to its button (end-aligned, 6px below, 340px, collision-aware, scrolling within the viewport if short) instead of a docked drawer: it relates to the button that opened it and never reflows the booking card. On phones, where a 340px popover can't sit beside its trigger, the same content is a modal bottom sheet. The two native selects inside it became Base UI Selects, following coss's composition (label, trigger with value and icon, popup of items with a check indicator), so their popups match the theme menu instead of the operating system's. All floating surfaces now share a small layer, not a component library: `--popup-*` tokens (surface, border, radius, shadow, item height and padding, motion), a `.popup` surface, a `.popup-item` row with one highlight bar and one check, and one stacking level. Nested popups are part of the parent: choosing in a select never closes Demo settings, and Escape closes the innermost popup first. Item icons were considered for the selects and left out; city names and network modes are recognised by their words, and icons there would be decoration.

## 8. How it was checked

All results below come from runs in this environment (Chromium 141 via Playwright 1.56, Node 22). Typecheck, lint and the production build also pass.

- **184 unit tests**, all passing, covering:
  - guest-local readings at 9:15/9:59/10:00 PM and 12:00/6:59/7:00 AM in 12- and 24-hour formats; one instant on the Los Angeles, London and India clocks; Kathmandu; across midnight; and on the Nov 1 DST day
  - half- and quarter-hour zones (India, Nepal, Eucla)
  - the US (Nov 1) and UK (Oct 25) clock changes
  - repeated and skipped times, and a day that starts at 01:00 (Santiago)
  - cross-date detection
  - slot generation, notice and window
  - every TimeBridge sentence
  - automatic date choice (today, next open date, nothing open, kept, moved, chosen instant preserved)
  - host-date labels (shared date, mixed dates, the US clock change, another locale)
  - .ics and Google Calendar instants
  - the advancing clock
  - booking re-validation ("too soon", double booking)
  - design-token contrast pairs in light, system dark and chosen dark (text 4.5:1, control edges and focus 3:1)
  - repeated times: Los Angeles on Nov 1 (every 15 minutes of the repeated hour distinct once its occurrence is stated; exact boundaries at 12:59 AM, the first 1:00 and 1:59 AM, the second 1:00 and 1:59 AM, and 2:00 AM; spoken offsets; meeting ranges before, after and across the change), London on Oct 25 in en-US and en-GB, Lord Howe's half-hour change, and no false positives on skipped or ordinary times
  - the whole Nov 1 pipeline in Los Angeles: generation is a gap-free 15-minute grid inside the host's hours; every missing quarter-hour is one of the simulation's pre-booked times (and no pre-booked time is shown); instants are unique and chronological; “Before clocks change” sits on UTC−7 instants and “After clocks change” on UTC−8, with the same plain time in both hour cycles; the two 1:15 AMs export an hour apart; the explanation applies to Nov 1 only, and not to Nov 1 under Arjun's weekday hours
  - clock changes found from IANA data for Los Angeles, New York, London, Sydney, Adelaide and Lord Howe in each year 2026–2029 (one forward and one back per year), ten change instants checked against UTC times worked out by hand from each published rule, repeated and skipped intervals around every change (including Lord Howe's 30 minutes), no changes for India, Nepal and Tokyo, a repeated Sydney time exported as two UTC instants an hour apart, and dates across months, years and leap days
  - `.ics`: any typed line break (CR, LF or CRLF) escaped so notes can't add calendar properties; lines folded at 75 octets without splitting a character
  - en-US, en-GB and ja-JP times in both hour cycles, long and short dates, heading parts, month-title parts and weekday names
- **104 browser scenarios, configured for five projects** (desktop Chromium, Firefox and WebKit; Pixel 7 Chromium; iPhone 13 WebKit). **Only the two Chromium projects have run:** desktop 103 passed, 1 skipped; Pixel 7 84 passed, 20 skipped; none failed. Skips are by design (keyboard-only and fixed-width checks run on desktop, the bottom-sheet check on phones). Firefox and WebKit couldn't be installed in this environment; CI runs them. The scenarios include:
  - changing the guest zone with a date selected (kept when valid, explained when not), across 12/24-hour and host-time on/off
  - host-date labelling (once in the header, or per row on mixed days)
  - London's Oct 25 change line shown for Oct 26 but not Oct 14, with its detail opened by keyboard
  - every slot's host time checked against its guest time in four guest zones (exact gap, inside the host's 9–5), plus the 9:15 PM / 10:00 PM / 12:00 AM / 6:30 AM / 7:00 AM readings, with no icons on any slot
  - 24-hour format applied to both columns of every slot
  - the clock-change line appearing only for November, and the gap reading 13½ hours for November dates
  - explicit-date rollover (Tue Oct 13 in Los Angeles = Wed Oct 14 in India) and 24-hour formatting kept through confirmation
  - Demo settings popover: anchored 6px under its button and end-aligned at 1440, 1280, 1024 and 768px, 320–360px wide, opaque, on screen, page not moved or made inert; scrolls inside a 300px-tall viewport; outside click dismisses, choosing in a nested select does not; bottom sheet on phones (modal, page inert, nested select on screen, close returns focus)
  - both selects by keyboard: ArrowDown opens on the current value, arrows move, Enter chooses, Escape closes the select before the panel, focus returns to the button; one checked, `aria-selected` option; select popups at the trigger's width, on screen and on top
  - the theme menu anchored under its button, on screen, Escape returning focus
  - select chevrons: one arrow per select, centred, inset 12px, clear of the text, with matching control heights
  - the chosen time reading identically in the slot list, the details summary and the confirmation (including the host's next-day date)
  - no horizontal scroll at 1440, 1280, 1024, 768, 390 and 375px across booker, details and confirmation
  - a keyboard-only booking with focus checks
  - the earliest open date chosen on load (today; the next day for an India guest after hours; November 1 when the rest of October is empty), date labels counting exactly the times listed, a chosen time keeping its instant across a zone change, and the details step updating in place
  - India against Tokyo, Dubai, London (after its change), New York (after its change, different dates) and New York in 24-hour time: both people's dates and start and end times checked against the booked instants via `Intl`, with no offsets typed into the tests
  - email checked when leaving the field, never while typing, and cleared as soon as it is fixed
  - time-zone offsets in the zone list following the date being viewed (Los Angeles GMT−7 on Oct 14, GMT−8 on Nov 3; London GMT+1, then GMT)
  - the guest's zone reading identically on the booking card, details and confirmation
  - calendar exports: a booking across midnight (11:45 PM PDT, Oct 13 → 06:45 UTC, Oct 14) and one after the US clock change (PST) checked in both the .ics file and the Google Calendar link, which also say the booking is simulated
  - month announcements matching the loaded data, including on a slow connection
  - time-list focus: the tab stop resets to the first time after a date change (regression test), keyboard date changes focus the new first time, and after *Back* the chosen time is focused, is the tab stop and is marked current (axe-checked in light and dark)
  - slot-by-slot verification that host time = guest time + 12½ h before Nov 1 and + 13½ h after
  - privacy off, clock-change notes, conflict and error recovery
  - zone search, no horizontal scroll, target sizes, reduced motion
  - the theme menu and Demo settings: keyboard opening, Escape, focus return, persistence, and popups that are fully opaque from their first frame
  - control-edge contrast measured on the rendered page, in light and dark: switch track and thumb, the selected 12h/24h ring, both selects and the three form fields, each at least 3:1 (this test failed at 1.47:1 against the previous styles)
  - the repeated hour on Nov 1 for a Los Angeles guest: both 1:00 and 1:15 AMs listed with "Before"/"After clocks change", every "before" ahead of every "after", occurrence lines only inside that hour and no abbreviations anywhere; spoken names with UTC offsets; repeated buttons the same size as ordinary ones with the second line inside
  - the repeated-times line: shown once, above the list, muted, with no box, icon, role or live region, and not on Nov 2 or on Nov 1 under Arjun's weekday hours; the date announcement includes it once; 24-hour labels "01:15" with their occurrence lines, distinct and ordered; booking either 1:15 AM gives its own details and confirmation ("1:15 AM – 1:30 AM" plus the occurrence line), zone line, .ics and Google Calendar instants (08:15 and 09:15 UTC); arrow keys visit both occurrences in time order with a visible focus ring, and *Back* restores the chosen one as current; switching to Tokyo keeps that instant (6:15 PM) and drops the line; axe-clean in light and dark
  - en-US, en-GB and ja-JP browsers: month title with the year muted, weekday headers, time-list heading and times all match the browser's own `Intl`; the default hour cycle follows the locale (12h, 24h, 24h) and a chosen one survives a reload
  - the time list's own scrolling on desktop: the focused time stays fully visible after End and Home, the last time sits inside the card, and the mouse wheel scrolls the list rather than the page; at phone width and at 640 px (200% zoom) there is no nested scroll area and the last time is reachable and not covered
  - a complete booking and "Book another time" with no console errors or warnings
  - the error boundary: a forced rendering error shows the recovery screen with focus on its heading and no axe violations; *Try again* recovers; *Start over* reloads keeping only the zone and demo clock
  - **axe-core with WCAG 2.0/2.1/2.2 A + AA rules, zero violations** in light and dark across calendar, theme menu, Demo settings (with a select open), comparison, open zone popup, form errors, confirmation and the open clock-change detail
- **No console warnings or errors** in a full journey on the development build (React StrictMode).
- **Visual review** from screenshots at 1440, 1280, 1024, 768, 390 and 375 px, light and dark.

**Defects found and fixed during these passes:**
1. Typing right after opening the zone picker silently changed the zone through the trigger's type-ahead. Keystrokes now open the search instead (regression-tested).
2. Searching "new" ranked New Salem above New York.
3. "It's … there now" could go stale on a long-open page. It now ticks on minute boundaries.
4. A slot could still be offered after time had moved inside the minimum notice. Booking now re-validates.
5. At 1024 px, host times in comparison mode touched the slot edge.
6. Fade-in animations (time list, then every popup) rendered text below 4.5:1 for ~100 ms (measured 4.03:1). Motion is now transform-only, so text is never translucent; the earlier test workaround was removed.
7. Keyboard-highlighted rows in the theme menu and zone list were marked only by a ~1.1:1 fill; they now also get a high-contrast edge bar.
8. Choosing a theme left the menu open; it now closes and returns focus to its trigger.
9. The time-zone button showed today's GMT offset (−7) while browsing November dates (−8). The offset is gone; the zone name is always right.
10. Night markers were silently skipped when guest and host shared a zone. (The markers have since been removed entirely.)
11. Changing the guest's zone silently cleared a selected date that had no times left on the new clock. The date is now kept and the list explains why it's empty.
12. Clock-change copy was long and showed for changes that didn't affect the chosen date. It's now one short line, shown only when relevant, with the detail in a disclosure.
13. Demo settings went through two layouts: an early popover that covered the calendar, then a docked drawer that reflowed the page. It is now an anchored popover with proper collision handling and nested-popup behaviour (see 7a), with a bottom sheet on phones.
14. The native select arrows sat tight against the right edge. Selects now use one custom chevron, centred and inset to match the rest of the interface.
15. **Keyboard focus:** after changing dates, the time list's single tab stop stayed at the previous date's position (Tab landed on 10:30 PM instead of 12:00 AM). The tab stop is now derived from the list on screen; see 7a.
16. Host dates for screen readers dropped the year with an English-only pattern, which failed in other locales. They are now formatted by `Intl` without a year.
17. **Wrong announcement:** moving to the next month told screen-reader users "November 2026: no available days" while 26 days were open. It came from one render in which the new month still carried the previous month's "ready" state, and the correct count was never announced. Loaded data is now tagged with the request it answers, so a new month reads as loading until its own data arrives. A regression test records the live region.
18. **Offsets for the wrong date:** the zone list showed today's GMT offsets while browsing later dates (Los Angeles as GMT−7 on Nov 3, when it is GMT−8). Offsets now follow the date being viewed.
19. **Exported events looked real:** the .ics file and Google Calendar link described an ordinary meeting. They now say it is a simulated booking from an independent concept and that no invitation was sent.
20. **Calendar tab stop on an empty date:** after a zone change moved the selection, the calendar's single tab stop stayed on the old date, which had no times. It now follows the selection and only rests on open dates.
21. **Enter on the shown date did nothing:** with today selected automatically, pressing Enter on it no longer moved keyboard users to its times (the list hadn't changed). It now does.
22. **Stale form errors:** a fixed email kept its error until the next Confirm. Errors now clear as soon as the value is valid, and a typed email is checked when leaving the field.
23. **Control edges below 3:1:** input, select and switch-track boundaries measured 1.47:1 (light) and 1.60:1 (dark) against the card, failing WCAG 1.4.11. They now use a dedicated token (3.51:1 and 3.90:1), with unit and browser regression tests.
24. **Two meetings, one label:** on Nov 1 in Los Angeles, 08:30 and 09:30 UTC both read "1:30 AM". Times in a repeated hour now say "Before clocks change" or "After clocks change" (they first carried PDT/PST, replaced for plain language).
25. **English-only date handling:** the calendar's weekday headers were hard-coded, its title was split on a space, and clock-change dates were trimmed with English regexes. All now come from `Intl` parts.
26. **A crash meant a blank page.** There is now an error boundary with a recovery screen.
27. **Two test races under load:** a keyboard test pressed arrow keys before focus had reached the time list, and a phone test tapped an option while its popup was still animating. Each failed once in a parallel run and passed five times out of five alone. The tests now wait for the focus and the animation; the app was unchanged.
28. **Formatting cost:** one render of a 40-slot list spent about 13 ms formatting (measured in Node), because every label built a new `Intl.DateTimeFormat`. Formatters are now cached per locale and options: 2.8 ms, with identical output.
29. **Exported events:** in a calendar's day view only the title shows, and it didn't say "simulated". Exports are now titled "Simulated: …". Typed notes containing a bare carriage return weren't escaped, and long lines weren't folded as RFC 5545 requires. Both fixed, with unit tests.
30. **Dead code:** two unused icons, two unused formatters and a superseded sentence function were removed.

**Not verified, and not claimed:**
- Screen readers by ear (VoiceOver, NVDA, JAWS, TalkBack). No manual screen-reader testing has been done; [`ACCESSIBILITY.md`](ACCESSIBILITY.md) has the checklist
- Real phones
- Windows High Contrast (CSS written, unverified)
- Firefox and WebKit (configured and in CI, not yet run)

Passing axe is not WCAG conformance.

## 8a. Trade-offs

- **Base UI directly, not coss ui.** It keeps the same primitives and accessibility behaviour without adopting Tailwind for one page. The cost: in Cal.com's codebase these components would be rebuilt with coss ui's tokens and classes.
- **A fixed-height booker on desktop.** The time list scrolls inside the card, as in Cal.com's booker, so the calendar doesn't move as lists change length. The cost is a nested scroll area, so tests check that focus is always scrolled into view. On phones and at 200% zoom the list flows with the page.
- **Words, not abbreviations, for repeated times.** "Before clocks change" means something to everyone; "PDT" doesn't. Screen readers still hear the UTC offset, and exports are exact UTC.
- **Simulated backend.** It makes every loading, failure and conflict state real code, but nothing about Cal.com's real availability engine is tested.
- **English copy, localised formats.** Translating the interface was out of scope; a translated zone name inside an English sentence would read worse than an English one.

## 9. What needs validation with real people

1. Do cross-zone guests hesitate or mis-book today? Compare completion time and reschedule rate for bookings where the zones differ, with and without TimeBridge.
2. Do guests notice and understand the context row, or is it skipped?
3. Do guests want any explicit signal for very late or early times, or is their own clock enough? (Markers were tried and removed for simplicity.)
4. The host privacy default, and how it applies to teams and round-robin events.
5. Wording, and ICU zone names that read awkwardly ("United Kingdom Time").

**How success could be measured** (proposed; nothing here has been measured). For bookings where guest and host zones differ, compare with and without TimeBridge:
- the share of booking pages that end in a booking
- time from opening the page to choosing a time
- reschedules and no-shows within 48 hours that cite a time mix-up
- how often "Show host's time" is turned on, and whether the clock-change detail is opened
- in moderated sessions, whether guests can say what time it will be for the host, and which day.

## 10. Deliberately left out

- **"Jump to next available date".** The empty-months report came from a community fork and wasn't reproduced on the hosted product, so it's omitted.
- **Team, round-robin and seated events, and translation of the interface.** Out of scope for one focused improvement. Dates and times are localised; sentences and zone names are English, and weeks start on Sunday everywhere.

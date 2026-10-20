import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const NOW = '2026-10-13T15:30:00Z'; // Tue 13 Oct, 8:30 AM in Los Angeles, 9:00 PM in India
const la = `/?tz=America/Los_Angeles&now=${NOW}`;

async function ready(page: Page) {
  await expect(page.locator('button.day[data-available]').first()).toBeVisible();
}

/**
 * Waits for running CSS transitions (theme colours, popup motion) to finish. Two frames first,
 * because a transition only starts on the frame after the change that triggers it.
 */
async function transitionsDone(page: Page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a instanceof CSSTransition)
        .map((a) => a.finished.catch(() => undefined)),
    );
  });
}

/** Checks the page as people see it: after colour transitions (e.g. from a theme change) have finished. */
async function axe(page: Page, label: string) {
  await transitionsDone(page);
  // axe-core bundles its own playwright-core types; the runtime page is the same object.
  const results = await new AxeBuilder({ page } as unknown as ConstructorParameters<typeof AxeBuilder>[0])
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const summary = results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  expect(summary, `axe violations on ${label}`).toEqual([]);
}

/** The visible host-time line (a spoken version sits beside it for screen readers). */
const hostLine = (page: Page) => page.locator('#bridge-note .hosttime-main > [aria-hidden="true"]');

/** Measure geometry only after the settings panel's entry motion has settled. */
async function settled(page: Page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('.settings-panel');
    return !!el && el.getAnimations({ subtree: true }).length === 0 && getComputedStyle(el).transform === 'none';
  });
}

/**
 * Waits until a popup has finished its entry motion (it starts at scale 0.98, 2px up), so its
 * geometry is final. "No running animations" alone is not enough: WebKit reports none in the
 * frame before the transition starts.
 */
async function popupSettled(page: Page, selector: string) {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    return (
      !!el &&
      !el.hasAttribute('data-starting-style') &&
      el.getAnimations().length === 0 &&
      getComputedStyle(el).transform === 'none'
    );
  }, selector);
}

/** Chooses an option in one of the Demo settings selects (its popup is portalled, so look it up on the page). */
async function pick(page: Page, label: string, option: string) {
  await settled(page); // the phone sheet slides in; don't tap a moving target
  await page.getByRole('combobox', { name: label }).click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await popupSettled(page, '.select-popup');
  await page.getByRole('option', { name: option, exact: true }).click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: label })).toHaveText(option);
}

/** Opens Demo settings, applies a change, and closes the panel again with Escape. */
async function demoSetting(page: Page, change: (panel: ReturnType<Page['getByRole']>) => Promise<unknown>) {
  await page.getByRole('button', { name: 'Demo settings', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Demo settings' });
  await expect(panel).toBeVisible();
  await change(panel);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
}

function minutesOf(time: string): number {
  const m = time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/)!;
  let h = Number(m[1]) % 12;
  if (m[3] === 'PM') h += 12;
  return h * 60 + Number(m[2]);
}

test.describe('TimeBridge context', () => {
  test('explains the gap for a Los Angeles guest', async ({ page }) => {
    await page.goto(la);
    await ready(page);
    const note = page.locator('#bridge-note');
    // One relative-time line; no live clocks or paragraphs.
    await expect(hostLine(page)).toHaveText('Arjun’s time is 12h 30m ahead');
    // Screen readers hear the amount written out rather than "12h 30m".
    await expect(note.locator('.hosttime-main .sr-only')).toHaveText('Arjun’s time is 12 hours 30 minutes ahead of yours');
    await expect(note.locator('p')).toHaveCount(1);
    // Today (Tue 13) is shown automatically; it is before the US change, so no clock-change note.
    await expect(note.locator('.change-note')).toHaveCount(0);
  });

  test('adds nothing when guest and host share a time zone', async ({ page }) => {
    await page.goto(`/?tz=Asia/Kolkata&now=${NOW}`);
    await ready(page);
    await expect(page.locator('#bridge-note')).toHaveCount(0);
    await page.locator('button.day[data-available]').first().click();
    await expect(page.locator('button.slot').first()).toBeVisible();
    await expect(page.locator('.compare-toggle')).toHaveCount(0);
    await expect(page.locator('button.slot svg')).toHaveCount(0);
  });

  test('handles a quarter-hour zone (Kathmandu)', async ({ page }) => {
    await page.goto(`/?tz=Asia/Kathmandu&now=${NOW}`);
    await ready(page);
    await expect(page.locator('#bridge-note')).toContainText('Arjun’s time is 15m behind');
  });

  test('host-time comparison stays correct across the US clock change', async ({ page }) => {
    await page.goto(la);
    await ready(page);
    await page.getByRole('button', { name: 'Next month' }).click();
    await page.getByRole('button', { name: /Tuesday, November 3, 2026, \d+ times available/ }).click();
    await page.locator('.compare-toggle').click();
    const labels = await page.locator('button.slot').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')!));
    expect(labels.length).toBeGreaterThan(10);
    for (const label of labels) {
      const [guest, host] = label.match(/\d{1,2}:\d{2}\s*(?:AM|PM)/g)!;
      const diff = (minutesOf(host) - minutesOf(guest) + 1440) % 1440;
      expect(diff, label).toBe(13 * 60 + 30); // PST → IST after Nov 1
    }
    // And before the change it is 12½ hours.
    await page.getByRole('button', { name: 'Previous month' }).click();
    await page.getByRole('button', { name: /Tuesday, October 27, 2026, \d+ times available/ }).click();
    const first = await page.locator('button.slot').first().getAttribute('aria-label');
    const [g, h] = first!.match(/\d{1,2}:\d{2}\s*(?:AM|PM)/g)!;
    expect((minutesOf(h) - minutesOf(g) + 1440) % 1440).toBe(12 * 60 + 30);
  });

  test('time slots carry no icons or legend, only times', async ({ page }) => {
    await page.goto(la);
    await ready(page);
    await page.locator('button.day[data-available]').first().click();
    await expect(page.locator('button.slot').first()).toBeVisible();
    await expect(page.locator('button.slot svg')).toHaveCount(0);
    await expect(page.locator('.slots-legend')).toHaveCount(0);
    await expect(page.locator('.slots')).not.toContainText(/moon|late night/i);
    await page.locator('.compare-toggle').click();
    await expect(page.locator('button.slot svg')).toHaveCount(0);
  });
});

test.describe('host privacy', () => {
  test('without the host’s permission, no host time appears anywhere', async ({ page }) => {
    await page.goto(`${la}&share=off`);
    await ready(page);
    await expect(page.locator('#bridge-note')).toHaveCount(0);
    await page.locator('button.day[data-available]').first().click();
    await expect(page.locator('.compare-toggle')).toHaveCount(0);
    await expect(page.locator('button.slot').first()).not.toHaveAttribute('aria-label', /host/);
    await page.locator('button.slot').first().click();
    await expect(page.locator('.tc-block-host')).toHaveCount(0);
    await expect(page.locator('.tc-label')).toHaveText('Your time');
    await expect(page.locator('.meta')).not.toContainText('India');
  });
});

test.describe('clock changes', () => {
  test('a meeting after the US change explains it at selection; the summary shows exact times only', async ({ page }) => {
    await page.goto(la);
    await ready(page);
    await page.getByRole('button', { name: 'Next month' }).click();
    await page.getByRole('button', { name: /Monday, November 2, 2026, \d+ times available/ }).click();
    await expect(page.locator('#bridge-note .change-note-summary')).toHaveText('Time difference changes on Nov 1');
    const slot = page.locator('button.slot').first();
    const guestTime = (await slot.getAttribute('aria-label'))!.match(/^\d{1,2}:\d{2}\s*(?:AM|PM)/)![0];
    await slot.click();
    // The chosen times are exact for that date, so the summary needs no clock-change note.
    await expect(page.locator('.tc .change-note')).toHaveCount(0);
    const blocks = page.locator('.meta .tc-block');
    await expect(blocks.first()).toContainText('Monday, November 2');
    await expect(blocks.first().locator('.tc-time')).toContainText(guestTime);
    // 13½ hours after Nov 1 (PST → IST), checked from the rendered times themselves.
    const host = (await blocks.nth(1).locator('.tc-time').textContent())!.match(/^\d{1,2}:\d{2}\s*(?:AM|PM)/)![0];
    expect((minutesOf(host) - minutesOf(guestTime) + 1440) % 1440).toBe(13 * 60 + 30);
  });

  test('a meeting before the change has no clock-change note', async ({ page }) => {
    await page.goto(la);
    await ready(page);
    await page.locator('button.day[data-available]').first().click();
    await page.locator('button.slot').first().click();
    await expect(page.locator('.tc-block-host')).toBeVisible();
    await expect(page.locator('.change-note')).toHaveCount(0);
  });
});

test.describe('time list focus (regression: stale tab stop after changing dates)', () => {
  // Before the fix, the list remembered the previous date's position: after End on Oct 14
  // (11:30 PM), clicking Oct 15 left the single tab stop on 10:30 PM, mid-list.
  test('changing date with the mouse resets the tab stop to the first time, without moving focus', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Keyboard behaviour');
    await page.goto(la);
    await ready(page);
    await page.getByRole('button', { name: /Wednesday, October 14, 2026, \d+ times available/ }).click();
    const slots = page.locator('button.slot');
    await slots.first().focus();
    await page.keyboard.press('End');
    await expect(page.locator(':focus')).toHaveAttribute('aria-label', /^11:30 PM your time/);

    const oct15 = page.getByRole('button', { name: /Thursday, October 15, 2026, \d+ times available/ });
    await oct15.click();
    await expect(oct15).toBeFocused(); // a mouse date change does not pull focus into the list
    await expect(slots.first()).toHaveAttribute('aria-label', /^12:00 AM your time/);
    await expect(page.locator('button.slot[tabindex="0"]')).toHaveCount(1);
    await expect(slots.first()).toHaveAttribute('tabindex', '0');

    // Tabbing in from the controls above lands on the first time, not mid-list.
    await page.getByRole('button', { name: '24-hour clock' }).focus();
    await page.keyboard.press('Tab'); // host-time switch
    await page.keyboard.press('Tab');
    await expect(slots.first()).toBeFocused();
  });

  test('changing date with the keyboard moves focus to the new first time', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Keyboard behaviour');
    await page.goto(la);
    await ready(page);
    await page.getByRole('button', { name: /Wednesday, October 14, 2026, \d+ times available/ }).click();
    await page.locator('button.slot').first().focus();
    await page.keyboard.press('End');
    await page.getByRole('button', { name: /Wednesday, October 14, 2026, \d+ times available/ }).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(page.locator(':focus')).toHaveAttribute('aria-label', /^12:00 AM your time/);
    await expect(page.locator('button.slot[tabindex="0"]')).toHaveCount(1);
  });

  // Regression (Safari): after a mouse click, WebKit stopped matching :focus-visible on focus
  // moved by script, even when a key press moved it, so arrowing left no visible focus.
  test('after a mouse click, focus moved by keys still shows the focus ring', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Keyboard behaviour');
    await page.goto(la);
    await ready(page);
    const oct14 = page.getByRole('button', { name: /Wednesday, October 14, 2026, \d+ times available/ });
    await oct14.click();
    await oct14.focus(); // Safari doesn't focus buttons on click; make the starting point the same everywhere
    const focused = page.locator(':focus');
    const ringShown = () => focused.evaluate((el) => el.matches(':focus-visible') && getComputedStyle(el).outlineStyle !== 'none');

    await page.keyboard.press('ArrowRight');
    await expect(focused).toHaveAttribute('data-key', '2026-10-15');
    expect(await ringShown()).toBe(true);

    await page.keyboard.press('Enter');
    await expect(focused).toHaveAttribute('aria-label', /^12:00 AM your time/);
    expect(await ringShown()).toBe(true);

    await page.keyboard.press('ArrowDown');
    await expect(focused).toHaveAttribute('aria-label', /^12:15 AM your time/);
    expect(await ringShown()).toBe(true);
  });

  test('after Back, the chosen time is the tab stop and is marked as current', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Keyboard behaviour');
    await page.goto(la);
    await ready(page);
    await page.getByRole('button', { name: /Wednesday, October 14, 2026, \d+ times available/ }).click();
    const slots = page.locator('button.slot');
    await expect(slots.first()).not.toHaveAttribute('aria-current', /.*/); // nothing chosen yet
    await slots.first().focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    const label = (await page.locator(':focus').getAttribute('aria-label'))!;
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Back' }).click();

    const chosen = page.locator(`button.slot[aria-label="${label}"]`);
    await expect(chosen).toBeFocused();
    await expect(chosen).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('button.slot[aria-current]')).toHaveCount(1);
    // The list is still named by its date heading (generated ids, no hard-coded ones).
    await expect(page.getByRole('list', { name: /^Wed 14 ?, available times$/ })).toBeVisible();
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await axe(page, `time list after Back (${scheme})`);
    }
    // Leaving and re-entering the list returns to the chosen time.
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(chosen).toBeFocused();
    // Another date has no chosen time, so nothing is marked and the first time is the tab stop.
    await page.getByRole('button', { name: /Thursday, October 15, 2026, \d+ times available/ }).click();
    await expect(page.locator('button.slot[aria-current]')).toHaveCount(0);
    await expect(slots.first()).toHaveAttribute('tabindex', '0');
    // Returning to the chosen date marks it again.
    await page.getByRole('button', { name: /Wednesday, October 14, 2026, \d+ times available/ }).click();
    await expect(chosen).toHaveAttribute('aria-current', 'true');
    await expect(chosen).toHaveAttribute('tabindex', '0');
  });
});

test('after Back by tap or click, the chosen time is marked as current (all profiles)', async ({ page }) => {
  await page.goto(la);
  await ready(page);
  await page.getByRole('button', { name: /Wednesday, October 14, 2026, \d+ times available/ }).click();
  const slot = page.locator('button.slot').nth(3);
  const label = (await slot.getAttribute('aria-label'))!;
  await slot.click();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.locator(`button.slot[aria-label="${label}"]`)).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('button.slot[aria-current]')).toHaveCount(1);
});

test.describe('time-zone consistency, exports and announcements', () => {
  const zoneRow = async (page: Page, query: string) => {
    await page.locator('.tz-trigger').click();
    await page.getByRole('combobox', { name: 'Search time zones' }).fill(query);
    const text = await page.locator('.tz-item').first().innerText();
    await page.keyboard.press('Escape');
    return text.replace(/\s+/g, ' ');
  };

  test('zone offsets follow the date being viewed, not today (regression)', async ({ page }) => {
    await page.goto(la);
    await ready(page);
    expect(await zoneRow(page, 'los angeles')).toContain('GMT−7'); // no date yet: today
    await page.getByRole('button', { name: /Wednesday, October 14, 2026, \d+ times available/ }).click();
    expect(await zoneRow(page, 'los angeles')).toContain('GMT−7');
    expect(await zoneRow(page, 'london')).toContain('GMT+1');
    await page.getByRole('button', { name: 'Next month' }).click();
    await page.getByRole('button', { name: /Tuesday, November 3, 2026, \d+ times available/ }).click();
    // After the US (Nov 1) and UK (Oct 25) changes. Before the fix this still read GMT−7.
    expect(await zoneRow(page, 'los angeles')).toContain('GMT−8');
    expect(await zoneRow(page, 'london')).toMatch(/London .* GMT( |$)/);
    expect(await zoneRow(page, 'kolkata')).toContain('GMT+5:30'); // no DST in India
  });

  test('the guest zone reads the same on the booking card, details and confirmation', async ({ page }) => {
    await page.goto(`/?tz=Europe/London&now=${NOW}`);
    await ready(page);
    await expect(page.locator('.tz-trigger-name')).toHaveText('United Kingdom Time');
    await expect(page.locator('.tz-trigger-city')).toHaveText('London');
    await page.getByRole('button', { name: /Wednesday, October 14, 2026, \d+ times available/ }).click();
    await page.locator('button.slot').first().click();
    await expect(page.locator('.meta .tc-block').first().locator('.tc-zone')).toHaveText('United Kingdom Time · London');
    await page.locator('#f-name').fill('Jane Doe');
    await page.locator('#f-email').fill('jane@example.com');
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.locator('.confirm-rows .tc-block').first().locator('.tc-zone')).toHaveText('United Kingdom Time · London');
  });

  async function book(page: Page, url: string, day: RegExp, nextMonth = false) {
    await page.goto(url);
    await ready(page);
    if (nextMonth) await page.getByRole('button', { name: 'Next month' }).click();
    await page.getByRole('button', { name: day }).click();
    await page.locator('button.slot').last().click();
    await page.locator('#f-name').fill('Jane Doe');
    await page.locator('#f-email').fill('jane@example.com');
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByRole('heading', { name: 'This meeting is scheduled' })).toBeVisible();
    const ics = decodeURIComponent((await page.locator('a[download="meeting.ics"]').getAttribute('href'))!.split(',')[1]);
    const google = new URL((await page.getByRole('link', { name: /Google Calendar/ }).getAttribute('href'))!);
    return { ics, google };
  }

  test('calendar export across midnight: Tue 11:45 PM in Los Angeles is written in UTC', async ({ page }) => {
    const { ics, google } = await book(page, la, /Tuesday, October 13, 2026, today, \d+ times available/);
    const when = page.locator('.confirm-rows .tc-block');
    await expect(when.nth(0).locator('.tc-date')).toHaveText('Tuesday, October 13');
    await expect(when.nth(0).locator('.tc-time')).toHaveText('11:45 PM – 12:00 AM');
    await expect(when.nth(1).locator('.tc-date')).toHaveText('Wednesday, October 14');
    await expect(when.nth(1).locator('.tc-time')).toHaveText('12:15 PM – 12:30 PM');
    // 11:45 PM PDT (UTC−7) = 06:45 UTC the next day; the meeting ends at midnight local.
    expect(ics).toContain('\r\nDTSTART:20261014T064500Z\r\n');
    expect(ics).toContain('\r\nDTEND:20261014T070000Z\r\n');
    expect(google.searchParams.get('dates')).toBe('20261014T064500Z/20261014T070000Z');
    // The exported event says it is simulated, so it can't pass for a real booking.
    // Long lines are folded (RFC 5545); unfold before reading the text, as calendar apps do.
    expect(ics.replace(/\r\n /g, '')).toContain('No invitation was sent.');
    expect(google.searchParams.get('details')).toContain('Simulated booking from TimeBridge');
    expect(google.searchParams.get('text')).toMatch(/^Simulated: 15 min introduction between Arjun Mehta and /);
    await expect(page.locator('.confirm-sub')).toHaveText('This is a simulated booking: no email or invite was sent, and Arjun wasn’t notified.');
  });

  test('calendar export after the US clock change uses the new offset (PST, UTC−8)', async ({ page }) => {
    const { ics } = await book(page, la, /Tuesday, November 3, 2026, \d+ times available/, true);
    await expect(page.locator('.confirm-rows .tc-block').first().locator('.tc-time')).toHaveText('11:45 PM – 12:00 AM');
    expect(ics).toContain('\r\nDTSTART:20261104T074500Z\r\n');
    expect(ics).toContain('\r\nDTEND:20261104T080000Z\r\n');
  });

  test('a new month is announced only once its data has loaded (regression)', async ({ page }) => {
    await page.goto(la);
    await ready(page);
    await page.evaluate(() => {
      const w = window as unknown as { said: string[] };
      w.said = [];
      const live = document.querySelector('.sr-only[role="status"]')!;
      new MutationObserver(() => live.textContent && w.said.push(live.textContent)).observe(live, { childList: true, subtree: true, characterData: true });
    });
    await demoSetting(page, () => pick(page, 'Network simulation', 'Slow responses'));
    await page.getByRole('button', { name: 'Next month' }).click();
    await expect(page.locator('button.day[data-available]').first()).toBeVisible({ timeout: 15_000 });
    const days = await page.locator('button.day[data-available]').count();
    // Before the fix this announced "November 2026: no available days." while loading, and never corrected it.
    await expect.poll(() => page.evaluate(() => (window as unknown as { said: string[] }).said)).toEqual([
      `November 2026: ${days} days with available times.`,
    ]);
  });
});

test.describe('demo identities: Arjun hosts from India, Yuki books from Tokyo', () => {
  test('full journey: Tokyo guest, India host, one instant in two zones, both identities kept', async ({ page }) => {
    await page.goto(`/?now=${NOW}`); // device zone; the guest then chooses Tokyo in Demo settings
    await ready(page);
    // 1. Arjun Mehta is the host; no guest name on the booking page.
    await expect(page.locator('.meta-host')).toHaveText('With Arjun Mehta');
    await expect(page.locator('.meta-title')).toHaveText('15 min introduction');
    await expect(page.locator('main')).not.toContainText('Yuki');
    // 2. Guest timezone: Tokyo.
    await demoSetting(page, () => pick(page, 'Guest timezone', 'Tokyo'));
    await expect(page.locator('.tz-trigger-name')).toHaveText('Japan Standard Time');
    await expect(page.locator('.tz-trigger-city')).toHaveText('Tokyo');
    // Tokyo (UTC+9) is 3h 30m ahead of India (UTC+5:30), so Arjun's time is behind.
    await expect(hostLine(page)).toHaveText('Arjun’s time is 3h 30m behind');
    // 3–4. Choose Thursday, Oct 15; every slot is Arjun's time + 3h 30m, same date.
    await page.getByRole('button', { name: /Thursday, October 15, 2026, \d+ times available/ }).click();
    const sw = page.getByRole('switch', { name: 'Show host’s time' });
    if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click();
    const rows = await page.locator('button.slot').evaluateAll((els) =>
      els.map((e) => [e.querySelector('.slot-time')!.textContent!, e.querySelector('.slot-host')!.textContent!]),
    );
    expect(rows.length).toBeGreaterThan(5);
    for (const [guest, host] of rows) {
      expect((minutesOf(guest) - minutesOf(host.match(/^\d{1,2}:\d{2}\s*(?:AM|PM)/)![0]) + 1440) % 1440, guest).toBe(210);
      expect(host, guest).not.toContain('·'); // same calendar date for both
    }
    // 5. Details: 6:45 PM in Tokyo is 3:15 PM in India, both Thursday, October 15.
    await page.locator('button.slot', { has: page.locator('.slot-time', { hasText: /^6:45 PM$/ }) }).click();
    const check = async (scope: string) => {
      const blocks = page.locator(`${scope} .tc-block`);
      await expect(blocks.nth(0).locator('.tc-label')).toHaveText('Your time');
      await expect(blocks.nth(0).locator('.tc-date')).toHaveText('Thursday, October 15');
      await expect(blocks.nth(0).locator('.tc-time')).toHaveText('6:45 PM – 7:00 PM');
      await expect(blocks.nth(0).locator('.tc-zone')).toHaveText('Japan Standard Time · Tokyo');
      await expect(blocks.nth(1).locator('.tc-label')).toHaveText('Arjun’s time');
      await expect(blocks.nth(1).locator('.tc-date')).toHaveText('Thursday, October 15');
      await expect(blocks.nth(1).locator('.tc-time')).toHaveText('3:15 PM – 3:30 PM');
      await expect(blocks.nth(1).locator('.tc-zone')).toHaveText('India Standard Time · Bengaluru');
    };
    await check('.meta');
    await expect(page.locator('.meta-host')).toHaveText('With Arjun Mehta');
    // Yuki is an example, not a pre-filled identity.
    await expect(page.locator('#f-name')).toHaveValue('');
    await expect(page.locator('#f-name')).toHaveAttribute('placeholder', 'Yuki Tanaka');
    await expect(page.locator('#f-email')).toHaveAttribute('placeholder', 'yuki@example.com');
    // 6–7. Enter Yuki and confirm.
    await page.locator('#f-name').fill('Yuki Tanaka');
    await page.locator('#f-email').fill('yuki@example.com');
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByRole('heading', { name: 'This meeting is scheduled' })).toBeVisible();
    // 8. Both identities and zones on the confirmation; still clearly simulated.
    await check('.confirm-rows');
    const rowsText = page.locator('.confirm-rows');
    await expect(rowsText).toContainText('15 min introduction between Arjun Mehta and Yuki Tanaka');
    await expect(rowsText).toContainText(/Arjun Mehta\s*Host/);
    await expect(rowsText).toContainText(/Yuki Tanaka\s*Guest\s*· yuki@example\.com/);
    await expect(rowsText).toContainText('Cal Video · simulated, no meeting link created');
    await expect(page.locator('.confirm-sub')).toHaveText('This is a simulated booking: no email or invite was sent, and Arjun wasn’t notified.');
    // The calendar file is the same instant: 6:45 PM JST = 09:45 UTC.
    const ics = decodeURIComponent((await page.locator('a[download="meeting.ics"]').getAttribute('href'))!.split(',')[1]);
    expect(ics).toContain('\r\nDTSTART:20261015T094500Z\r\n');
    // The exported title says it's simulated, since calendars show only the title in their day view.
    expect(ics).toContain('\r\nSUMMARY:Simulated: 15 min introduction between Arjun Mehta and Yuki Tanaka\r\n');
  });

  test('a typed guest name is used as entered', async ({ page }) => {
    await page.goto(`/?tz=Asia/Tokyo&now=${NOW}`);
    await ready(page);
    await page.locator('button.day[data-available]').first().click();
    await page.locator('button.slot').first().click();
    await page.locator('#f-name').fill('María José Núñez');
    await page.locator('#f-email').fill('mj@example.com');
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.locator('.confirm-rows')).toContainText('between Arjun Mehta and María José Núñez');
    await expect(page.locator('.confirm-rows')).not.toContainText('Yuki');
  });
});

test.describe('earliest open date, zone switching and conversions', () => {
  const at = (tz: string, now = NOW) => `/?tz=${tz}&now=${now}`;

  test('first load shows today and its times, no click needed', async ({ page }) => {
    await page.goto(la);
    await ready(page);
    await expect(page.locator('.slots-title')).toContainText('Tue 13');
    await expect(page.locator('button.slot').first()).toBeVisible();
    await expect(page.locator('td[aria-selected="true"] button')).toHaveAttribute('aria-label', /^Tuesday, October 13, 2026, today, \d+ times available$/);
  });

  test('today has no times left: the next open date is shown (India guest after hours)', async ({ page }) => {
    await page.goto(at('Asia/Kolkata')); // 9:00 PM Tue in India
    await ready(page);
    await expect(page.locator('.slots-title')).toContainText('Wed 14');
    await expect(page.locator('td[aria-selected="true"] button')).toHaveAttribute('aria-label', /^Wednesday, October 14, 2026, \d+ times available$/);
    await expect(page.locator('.slots-moved')).toHaveCount(0); // nothing was moved; this is the first choice
  });

  test('rest of the month empty: the next month opens on its first open date (Nov 1, the US change day)', async ({ page }) => {
    await page.goto(at('America/Los_Angeles', '2026-10-30T15:30:00Z')); // Fri Oct 30, 8:30 AM in Los Angeles
    await ready(page);
    await expect(page.locator('.calendar-title')).toContainText('November');
    await expect(page.locator('td[aria-selected="true"] button')).toHaveAttribute('aria-label', /^Sunday, November 1, 2026, \d+ times available$/);
    // After clocks go back that morning, India's 9:00 AM Monday is 7:30 PM Sunday in Los Angeles.
    await expect(page.locator('button.slot').first()).toHaveAttribute('aria-label', /^7:30 PM your time/);
    await expect(hostLine(page)).toHaveText('Arjun’s time is 13h 30m ahead');
    await expect(page.getByRole('button', { name: 'Previous month' })).toBeEnabled();
  });

  test('each date’s label counts exactly the times it lists', async ({ page }) => {
    await page.goto(la);
    await ready(page);
    for (const day of [/Tuesday, October 13, 2026/, /Wednesday, October 14, 2026/, /Monday, October 19, 2026/]) {
      const button = page.getByRole('button', { name: day });
      const count = Number((await button.getAttribute('aria-label'))!.match(/(\d+) times? available$/)![1]);
      await button.click();
      await expect(page.locator('button.slot')).toHaveCount(count);
    }
    // Weekends in India have no times, and say so.
    await expect(page.getByRole('button', { name: /Saturday, October 17, 2026/ })).toHaveAttribute('aria-label', /no availability$/);
  });

  test('changing zone after choosing a time keeps that instant; its date follows it', async ({ page }) => {
    await page.goto(la);
    await ready(page);
    await page.getByRole('button', { name: /Wednesday, October 14, 2026, \d+ times available/ }).click();
    await page.locator('button.slot').last().click(); // 11:30 PM Wed in LA
    await page.getByRole('button', { name: 'Back' }).click();
    await demoSetting(page, () => pick(page, 'Guest timezone', 'Tokyo'));
    // The same instant is 3:30 PM Thursday in Tokyo; Wed 14 still has times, so no "moved" note.
    await expect(page.locator('.slots-title')).toContainText('Thu 15');
    await expect(page.locator('button.slot[aria-current="true"]')).toHaveAttribute('aria-label', /^3:30 PM your time/);
    await expect(page.locator('.slots-moved')).toHaveCount(0);
  });

  test('changing zone on the details step keeps the meeting; only the guest’s clock changes', async ({ page }) => {
    await page.goto(la);
    await ready(page);
    await page.getByRole('button', { name: /Wednesday, October 14, 2026, \d+ times available/ }).click();
    await page.locator('button.slot').last().click();
    const blocks = page.locator('.meta .tc-block');
    await expect(blocks.nth(0).locator('.tc-time')).toHaveText('11:30 PM – 11:45 PM');
    await expect(blocks.nth(1).locator('.tc-date')).toHaveText('Thursday, October 15');
    await expect(blocks.nth(1).locator('.tc-time')).toHaveText('12:00 PM – 12:15 PM');
    await demoSetting(page, () => pick(page, 'Guest timezone', 'Tokyo'));
    await expect(blocks.nth(0).locator('.tc-date')).toHaveText('Thursday, October 15');
    await expect(blocks.nth(0).locator('.tc-time')).toHaveText('3:30 PM – 3:45 PM');
    await expect(blocks.nth(0).locator('.tc-zone')).toHaveText('Japan Standard Time · Tokyo');
    await expect(blocks.nth(1).locator('.tc-time')).toHaveText('12:00 PM – 12:15 PM'); // Arjun's time unchanged
  });

  // Each booking is checked against the instants in its own calendar file, formatted by Intl for
  // both zones: no offsets are typed into the test, so DST and date changes are covered honestly.
  const cases: Array<{ tz: string; city: string; day: RegExp; nextMonth?: boolean; h24?: boolean }> = [
    { tz: 'Asia/Tokyo', city: 'Tokyo', day: /Thursday, October 15, 2026/ },
    { tz: 'Asia/Dubai', city: 'Dubai', day: /Thursday, October 15, 2026/ },
    { tz: 'Europe/London', city: 'London', day: /Monday, October 26, 2026/ }, // after the UK change
    { tz: 'America/New_York', city: 'New York', day: /Tuesday, November 3, 2026/, nextMonth: true }, // after the US change; dates differ
    { tz: 'America/New_York', city: 'New York', day: /Tuesday, November 3, 2026/, nextMonth: true, h24: true },
  ];
  for (const c of cases) {
    test(`India ↔ ${c.city}${c.h24 ? ' (24-hour)' : ''}: both people’s date and time match the booked instant`, async ({ page }) => {
      await page.goto(at(c.tz));
      await ready(page);
      if (c.nextMonth) await page.getByRole('button', { name: 'Next month' }).click();
      if (c.h24) await page.getByRole('button', { name: '24-hour clock' }).click();
      await page.getByRole('button', { name: c.day }).click();
      await page.locator('button.slot').last().click();
      const read = async (scope: string) =>
        page.locator(`${scope} .tc-block`).evaluateAll((els) =>
          els.map((e) => [e.querySelector('.tc-date')!.textContent!, e.querySelector('.tc-time')!.textContent!]),
        );
      const details = await read('.meta');
      await page.locator('#f-name').fill('Test Guest');
      await page.locator('#f-email').fill('guest@example.com');
      await page.getByRole('button', { name: 'Confirm' }).click();
      await expect(page.getByRole('heading', { name: 'This meeting is scheduled' })).toBeVisible();
      const confirmation = await read('.confirm-rows');
      expect(confirmation).toEqual(details);

      const ics = decodeURIComponent((await page.locator('a[download="meeting.ics"]').getAttribute('href'))!.split(',')[1]);
      const utc = (field: string) => {
        const m = ics.match(new RegExp(`${field}:(\\d{4})(\\d{2})(\\d{2})T(\\d{2})(\\d{2})00Z`))!;
        return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
      };
      const start = utc('DTSTART');
      const end = utc('DTEND');
      expect(end - start).toBe(15 * 60_000);
      const norm = (t: string) => t.replace(/\s+/g, ' ');
      const time = (t: number, tz: string) =>
        new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hourCycle: c.h24 ? 'h23' : 'h12' }).format(t);
      const date = (t: number, tz: string) =>
        new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' }).format(t);
      const expected = [c.tz, 'Asia/Kolkata'].map((tz) => [date(start, tz), `${time(start, tz)} – ${time(end, tz)}`]);
      expect(details.map((r) => r.map(norm))).toEqual(expected.map((r) => r.map(norm)));
    });
  }

  test('email: checked when leaving the field, never while typing; fixing it clears the error', async ({ page }) => {
    await page.goto(la);
    await ready(page);
    await page.locator('button.slot').first().click();
    const email = page.locator('#f-email');
    await email.fill('yuki@');
    await expect(page.locator('#f-email-error')).toHaveCount(0); // no error mid-typing
    await email.blur();
    await expect(page.locator('#f-email-error')).toHaveText('Enter an email address like name@example.com.');
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    await email.fill('yuki@example.com'); // fixed: the error goes as soon as it's valid
    await expect(page.locator('#f-email-error')).toHaveCount(0);
    await expect(email).toHaveAttribute('aria-invalid', 'false');
    // An empty field doesn't complain on blur; Confirm still catches it.
    await page.locator('#f-name').focus();
    await page.locator('#f-name').blur();
    await expect(page.locator('#f-name-error')).toHaveCount(0);
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.locator('#f-name-error')).toHaveText('Enter your name.');
    await page.locator('#f-name').fill('Y');
    await expect(page.locator('#f-name-error')).toHaveCount(0);
  });
});

test.describe('non-text contrast of control edges (WCAG 1.4.11), measured on screen', () => {
  // Reads computed colours, so a CSS change that bypasses the tokens is caught too.
  const ratio = (page: Page, fg: string, bg: string) =>
    page.evaluate(
      ([a, b]) => {
        const rgb = (c: string) => c.match(/[\d.]+/g)!.slice(0, 3).map(Number);
        const lum = (c: string) => {
          const [r, g, bl] = rgb(c).map((v) => {
            const x = v / 255;
            return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
        };
        const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      },
      [fg, bg],
    );
  const style = (page: Page, selector: string, prop: string) =>
    page.locator(selector).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
  const cardBg = (page: Page) => style(page, '.card', 'background-color');

  for (const scheme of ['light', 'dark'] as const) {
    test(`${scheme}: inputs, selects, switch track and the 12h/24h state reach 3:1`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(la);
      await ready(page);
      const card = await cardBg(page);
      // Switch (off) track, and its thumb against the track.
      const sw = page.getByRole('switch', { name: 'Show host’s time' });
      if ((await sw.getAttribute('aria-checked')) === 'true') await sw.click();
      const track = await style(page, '.compare-toggle .switch', 'background-color');
      expect(await ratio(page, track, card), 'switch track vs card').toBeGreaterThanOrEqual(3);
      const thumb = await style(page, '.compare-toggle .switch-thumb', 'background-color');
      expect(await ratio(page, thumb, track), 'switch thumb vs track').toBeGreaterThanOrEqual(3);
      // Selected 12h/24h option: its ring against its own fill.
      const pressedRing = (await style(page, '.segmented-item[data-pressed]', 'box-shadow')).match(/rgba?\([^)]*\)/)![0];
      const pressedFill = await style(page, '.segmented-item[data-pressed]', 'background-color');
      expect(await ratio(page, pressedRing, pressedFill), '12h/24h selected ring').toBeGreaterThanOrEqual(3);
      // Select triggers in Demo settings.
      await page.getByRole('button', { name: 'Demo settings', exact: true }).click();
      await settled(page);
      const panelBg = await style(page, '.settings-panel', 'background-color');
      for (const name of ['Guest timezone', 'Network simulation']) {
        const edge = await page.getByRole('combobox', { name }).evaluate((el) => getComputedStyle(el).borderTopColor);
        expect(await ratio(page, edge, panelBg), `${name} edge`).toBeGreaterThanOrEqual(3);
      }
      await page.keyboard.press('Escape');
      // Text inputs on the details step.
      await page.locator('button.slot').first().click();
      for (const id of ['#f-name', '#f-email', '#f-notes']) {
        const edge = await style(page, id, 'border-top-color');
        expect(await ratio(page, edge, await cardBg(page)), `${id} edge`).toBeGreaterThanOrEqual(3);
      }
    });
  }
});

test.describe('booking journey', () => {
  test('keyboard only: calendar → time → details → confirmation', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Keyboard journey runs on desktop');
    await page.goto(la);
    await ready(page);

    // Tab into the grid: exactly one tab stop, on the first available day.
    const gridDay = page.locator('table[role=grid] button[tabindex="0"]');
    await expect(gridDay).toHaveCount(1);
    await gridDay.focus();
    await expect(page.locator(':focus')).toHaveAttribute('aria-label', /Tuesday, October 13, 2026, today, \d+ times available/);

    await page.keyboard.press('ArrowRight');
    await expect(page.locator(':focus')).toHaveAttribute('aria-label', /Wednesday, October 14/);
    await page.keyboard.press('Enter');

    // Focus moves to the first time; arrows move within the list.
    await expect(page.locator(':focus')).toHaveClass(/slot/);
    await page.keyboard.press('ArrowDown');
    await expect(page.locator(':focus')).toHaveClass(/slot/);
    // End jumps to the day's last time — late evening in LA, already Thursday in India.
    await page.keyboard.press('End');
    const chosen = await page.locator(':focus').getAttribute('aria-label');
    expect(chosen).toMatch(/^11:\d{2} PM your time$/); // host time off by default, so no host details in the label
    await page.keyboard.press('Enter');

    // Details: focus starts in the first field; both times are shown.
    await expect(page.locator('#f-name')).toBeFocused();
    // The day change is explicit through written-out dates, not a badge.
    await expect(page.locator('.meta .tc-block').first()).toContainText('Wednesday, October 14');
    const host = page.locator('.meta .tc-block-host');
    await expect(host).toContainText('Arjun’s time');
    await expect(host).toContainText('Thursday, October 15');
    await expect(host).toContainText('India Standard Time');

    // Validation moves focus to the first problem.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter'); // Confirm with empty fields
    await expect(page.locator('#f-name')).toBeFocused();
    await expect(page.locator('#f-name')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#f-name-error')).toHaveText('Enter your name.');

    await page.keyboard.type('Jane Doe');
    await page.keyboard.press('Tab');
    await page.keyboard.type('jane@example.com');
    await page.keyboard.press('Enter');

    const heading = page.getByRole('heading', { name: 'This meeting is scheduled' });
    await expect(heading).toBeFocused();
    await expect(page.locator('.confirm-rows')).toContainText('Pacific Time · Los Angeles');
    await expect(page.locator('.confirm-rows .tc-block-host')).toContainText('Thursday, October 15');
    expect(chosen).toBeTruthy();
  });

  test('Enter on the automatically selected date takes keyboard users to its first time', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Keyboard behaviour');
    await page.goto(la);
    await ready(page);
    const stop = page.locator('table[role=grid] button[tabindex="0"]');
    await expect(stop).toHaveAttribute('aria-label', /^Tuesday, October 13, 2026, today/); // already selected
    await stop.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator(':focus')).toHaveClass(/slot/);
    await expect(page.locator(':focus')).toHaveAttribute('aria-label', /^9:00 PM your time/);
  });

  test('Back returns focus to the time that was chosen', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Desktop focus test');
    await page.goto(la);
    await ready(page);
    await page.locator('table[role=grid] button[tabindex="0"]').focus();
    await page.keyboard.press('Enter');
    // Focus moves to the first time on the next frame; wait for it before using the arrows.
    await expect(page.locator(':focus')).toHaveClass(/slot/);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    const label = await page.locator(':focus').getAttribute('aria-label');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.locator(':focus')).toHaveAttribute('aria-label', label!);
  });

  test('recovers when the time is taken while confirming', async ({ page }) => {
    await page.goto(la);
    await ready(page);
    await demoSetting(page, () => pick(page, 'Network simulation', 'Slot taken on confirmation'));
    await page.locator('button.day[data-available]').first().click();
    const slot = page.locator('button.slot').first();
    const taken = (await slot.getAttribute('aria-label'))!.split(',')[0].replace(' your time', '');
    await slot.click();
    await page.locator('#f-name').fill('Jane');
    await page.locator('#f-email').fill('jane@example.com');
    await page.getByRole('button', { name: 'Confirm' }).click();

    const notice = page.locator('.slots .notice');
    await expect(notice).toContainText(`${taken} was just booked by someone else`);
    await expect(notice).toBeFocused();
    await expect(page.locator('button.slot', { hasText: new RegExp(`^${taken}$`) })).toHaveCount(0);
  });

  test('shows a retryable error when availability fails to load', async ({ page }) => {
    await page.goto(la);
    await ready(page);
    await demoSetting(page, () => pick(page, 'Network simulation', 'Fail next load'));
    await page.getByRole('button', { name: 'Next month' }).click();
    await expect(page.getByRole('alert')).toContainText('Couldn’t load available times.');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('button.day[data-available]').first()).toBeVisible();
  });

  test('time-zone search finds cities, generic names and offsets', async ({ page }) => {
    await page.goto(la);
    await ready(page);
    await page.locator('.tz-trigger').click();
    const input = page.getByRole('combobox', { name: 'Search time zones' });
    await input.fill('kolkata');
    await expect(page.locator('.tz-item')).toHaveCount(1);
    await input.fill('india standard');
    await expect(page.locator('.tz-item', { hasText: 'Kolkata' })).toHaveCount(1);
    await input.fill('GMT+5:45');
    await expect(page.locator('.tz-item').first()).toContainText('Kathmandu');
    await page.keyboard.press('Enter');
    await expect(page.locator('#bridge-note')).toContainText('15 minutes behind');
  });
});

test('typing right after opening the zone picker searches instead of changing the zone', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Keyboard behaviour');
  await page.goto(la);
  await ready(page);
  await page.locator('.tz-trigger').focus();
  await page.keyboard.type('new y'); // keys land on the closed trigger
  const input = page.getByRole('combobox', { name: 'Search time zones' });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('new y');
  await expect(page.locator('.tz-trigger')).toContainText('Pacific Time'); // unchanged until chosen
  await page.keyboard.press('Enter');
  await expect(page.locator('.tz-trigger')).toContainText('Eastern Time');
  await expect(page.locator('.tz-trigger')).toBeFocused(); // focus returns to the trigger
});

test.describe('slot times on the guest’s clock', () => {
  // Every slot is the host's 9–5 India day read on the guest's clock for the chosen date.
  async function slotsFor(page: Page, tz: string, dayLabel: RegExp) {
    await page.goto(`/?tz=${tz}&now=${NOW}`);
    await ready(page);
    await page.getByRole('button', { name: dayLabel }).click();
    const sw = page.getByRole('switch', { name: 'Show host’s time' });
    if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click(); // the choice persists between loads
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    return page.locator('button.slot').evaluateAll((els) =>
      els.map((e) => ({
        time: e.querySelector('.slot-time')!.textContent!,
        host: e.querySelector('.slot-host')!.textContent!,
        icons: e.querySelectorAll('svg').length,
      })),
    );
  }

  const cases: Array<[string, RegExp, number]> = [
    ['America/Los_Angeles', /Tuesday, October 13, 2026, today, \d+ times/, 12 * 60 + 30],
    ['America/Los_Angeles', /Wednesday, October 14, 2026, \d+ times/, 12 * 60 + 30],
    ['Europe/London', /Wednesday, October 14, 2026, \d+ times/, 4 * 60 + 30],
    ['America/New_York', /Wednesday, October 14, 2026, \d+ times/, 9 * 60 + 30],
  ];
  for (const [tz, day, gap] of cases) {
    test(`every slot converts exactly in ${tz} (${day.source.split(",")[1].trim()})`, async ({ page }) => {
      const slots = await slotsFor(page, tz, day);
      expect(slots.length).toBeGreaterThan(5);
      for (const s of slots) {
        expect(s.icons, `${tz} ${s.time}`).toBe(0);
        const host = s.host.match(/\d{1,2}:\d{2}\s*(?:AM|PM)/)![0];
        const hostMin = minutesOf(host);
        expect((hostMin - minutesOf(s.time) + 1440) % 1440, `${tz} ${s.time}`).toBe(gap);
        expect(hostMin >= 9 * 60 && hostMin < 17 * 60, `${tz} host ${host}`).toBe(true);
      }
    });
  }

  test('boundary readings: 9:15 PM, 10:00 PM, 12:00 AM, 6:30 AM and 7:00 AM appear as plain times', async ({ page }) => {
    const la13 = await slotsFor(page, 'America/Los_Angeles', cases[0][1]);
    expect(la13.map((s) => s.time)).toEqual(expect.arrayContaining(['9:15 PM', '10:00 PM']));
    const la14 = await slotsFor(page, 'America/Los_Angeles', cases[1][1]);
    expect(la14.map((s) => s.time)).toContain('12:00 AM');
    const london = await slotsFor(page, 'Europe/London', cases[2][1]);
    expect(london.map((s) => s.time)).toEqual(expect.arrayContaining(['6:30 AM', '7:00 AM']));
    expect(london.find((s) => s.time === '7:00 AM')!.host).toMatch(/^11:30 AM/); // same instant, India clock
  });
});

test.describe('dates, clock changes and formatting', () => {
  test('clock-change line appears only when it affects the chosen date; detail is a keyboard disclosure', async ({ page, isMobile }) => {
    await page.goto(`/?tz=Europe/London&now=${NOW}`);
    await ready(page);
    // Oct 14 is before London's Oct 25 change: no note, even though the change is later this month.
    await page.getByRole('button', { name: /Wednesday, October 14, 2026, \d+ times available/ }).click();
    await expect(hostLine(page)).toHaveText('Arjun’s time is 4h 30m ahead');
    await expect(page.locator('.change-note')).toHaveCount(0);
    // Oct 26 is after it: the difference shown is for that date, with one short line.
    await page.getByRole('button', { name: /Monday, October 26, 2026, \d+ times available/ }).click();
    await expect(hostLine(page)).toHaveText('Arjun’s time is 5h 30m ahead');
    const summary = page.locator('#bridge-note .change-note-summary');
    await expect(summary).toHaveText('Time difference changes on Oct 25');
    await expect(page.locator('#bridge-note .change-note')).toHaveCount(1);
    const detail = page.locator('#bridge-note .change-note-detail');
    await expect(detail).toBeHidden();
    if (isMobile) await summary.click();
    else {
      await summary.focus();
      await page.keyboard.press('Enter');
    }
    await expect(detail).toHaveText('Clocks in London go back an hour on Oct 25. From then, Arjun’s time is 5h 30m ahead.');
    await expect(page.locator('#bridge-note .change-note')).toHaveAttribute('open', '');
  });

  test('Los Angeles in November: 13½ hours, derived from the date, not from today', async ({ page }) => {
    await page.goto(la);
    await ready(page);
    await page.getByRole('button', { name: 'Next month' }).click();
    await page.getByRole('button', { name: /Tuesday, November 3, 2026, \d+ times available/ }).click();
    await expect(hostLine(page)).toHaveText('Arjun’s time is 13h 30m ahead');
    await expect(page.locator('.change-note-summary')).toHaveText('Time difference changes on Nov 1');
    await page.locator('.change-note-summary').click();
    await expect(page.locator('.change-note-detail')).toHaveText(
      'Clocks in Los Angeles go back an hour on Nov 1. From then, Arjun’s time is 13h 30m ahead.',
    );
  });

  test('changing the guest zone keeps a still-valid date selected', async ({ page }) => {
    await page.goto(la);
    await ready(page);
    await page.getByRole('button', { name: /Wednesday, October 14, 2026, \d+ times available/ }).click();
    await page.locator('.compare-toggle').click();
    await page.getByRole('button', { name: '24-hour clock' }).click();
    await demoSetting(page, () => pick(page, 'Guest timezone', 'London'));
    await expect(page.locator('.slots-title')).toContainText('Wed 14');
    await expect(page.locator('button.slot').first()).toBeVisible();
    await expect(page.locator('.slot-time').first()).toHaveText(/^\d{2}:\d{2}$/);
  });

  test('a zone change that empties the shown date moves to the nearest open date and says so', async ({ page }) => {
    await page.goto(la);
    await ready(page);
    await page.locator('button.day[data-available]').first().click(); // Tue 13, evening in LA
    await demoSetting(page, () => pick(page, 'Guest timezone', 'London'));
    // Tue 13 has no open times left on a London clock; Wed 14 is the nearest date that does.
    await expect(page.locator('.slots-title')).toContainText('Wed 14');
    await expect(page.locator('button.slot').first()).toBeVisible();
    await expect(page.locator('.slots-moved')).toHaveText(
      'No open times on Tue, Oct 13 in United Kingdom Time, so showing Wed, Oct 14.',
    );
    // The calendar's single tab stop follows: on the shown, open date.
    const stop = page.locator('table[role=grid] button[tabindex="0"]');
    await expect(stop).toHaveCount(1);
    await expect(stop).toHaveAttribute('aria-label', /^Wednesday, October 14, 2026, \d+ times available$/);
    // The note is about that change only: choosing another date clears it.
    await page.getByRole('button', { name: /Thursday, October 15, 2026, \d+ times available/ }).click();
    await expect(page.locator('.slots-moved')).toHaveCount(0);
  });

  test('host date is labelled once when every host time is on another day', async ({ page }) => {
    await page.goto(la);
    await ready(page);
    await page.locator('button.day[data-available]').first().click(); // Tue 13 LA = Wed 14 India
    await page.locator('.compare-toggle').click();
    await expect(page.locator('.slot-columns')).toHaveText('Your timeHost’s time · Wed 14');
    await expect(page.locator('.slot-host-day')).toHaveCount(0);
    // Screen readers still hear the date on every slot.
    await expect(page.locator('button.slot').first()).toHaveAttribute('aria-label', /host’s time .* Wednesday, October 14/);
  });

  test('mixed days: only the rows on another date are labelled', async ({ page }) => {
    await page.goto(la);
    await ready(page);
    await page.getByRole('button', { name: /Wednesday, October 14, 2026, \d+ times available/ }).click();
    await page.locator('.compare-toggle').click();
    await expect(page.locator('.slot-columns')).toHaveText('Your timeHost’s time');
    const rows = await page.locator('button.slot').evaluateAll((els) =>
      els.map((e) => ({ t: e.querySelector('.slot-time')!.textContent!, day: e.querySelector('.slot-host-day')?.textContent ?? '' })),
    );
    // Early-morning LA slots are still Wednesday in India; evening slots are Thursday.
    for (const r of rows) expect(r.day, r.t).toBe(r.t.endsWith('PM') ? ' · Thu 15' : '');
  });

  test('24-hour clock applies to both columns of every slot', async ({ page }) => {
    await page.goto(la);
    await ready(page);
    await page.locator('button.day[data-available]').first().click();
    await page.getByRole('button', { name: '24-hour clock' }).click();
    await page.locator('.compare-toggle').click();
    const rows = await page.locator('button.slot').evaluateAll((els) =>
      els.map((e) => [e.querySelector('.slot-time')!.textContent!, e.querySelector('.slot-host')!.textContent!]),
    );
    expect(rows.length).toBeGreaterThan(5);
    for (const [g, h] of rows) {
      expect(g).toMatch(/^\d{2}:\d{2}$/);
      expect(h).toMatch(/^\d{2}:\d{2}/);
      expect(`${g} ${h}`).not.toMatch(/AM|PM/);
    }
    expect(rows.map((r) => r[0])).toContain('22:00');
  });

  test('a late Los Angeles evening is the next day in India, shown as explicit dates', async ({ page }) => {
    await page.goto(la);
    await ready(page);
    await page.locator('button.day[data-available]').first().click();
    await page.locator('button.slot').last().click();
    const blocks = page.locator('.meta .tc-block');
    await expect(blocks.nth(0)).toContainText('Tuesday, October 13');
    await expect(blocks.nth(0)).toContainText('11:45 PM – 12:00 AM');
    await expect(blocks.nth(1)).toContainText('Wednesday, October 14');
    await expect(blocks.nth(1)).toContainText('12:15 PM – 12:30 PM');
    await expect(page.locator('.day-badge')).toHaveCount(0);
  });

  test('24-hour choice is kept on the time list, details and confirmation', async ({ page }) => {
    await page.goto(la);
    await ready(page);
    await page.locator('button.day[data-available]').first().click();
    await page.getByRole('button', { name: '24-hour clock' }).click();
    await expect(page.locator('.slot-time').first()).toHaveText(/^\d{2}:\d{2}$/);
    await page.locator('button.slot').last().click();
    await expect(page.locator('.meta .tc-time').first()).toHaveText('23:45 – 00:00');
    await page.locator('#f-name').fill('Jane');
    await page.locator('#f-email').fill('jane@example.com');
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.locator('.confirm-rows .tc-time').first()).toHaveText('23:45 – 00:00');
    await expect(page.locator('.confirm-rows .tc-time').nth(1)).toHaveText('12:15 – 12:30');
  });
});

test.describe('demo settings popover', () => {
  const panelOf = (page: Page) => page.getByRole('dialog', { name: 'Demo settings' });
  const triggerOf = (page: Page) => page.getByRole('button', { name: 'Demo settings', exact: true });

  for (const width of [1440, 1280, 1024, 768]) {
    test(`anchored under its button at ${width}px, opaque, and the page does not move`, async ({ page, isMobile }) => {
      test.skip(isMobile, 'Fixed desktop and tablet widths');
      await page.setViewportSize({ width, height: 900 });
      await page.goto(la);
      await ready(page);
      await page.getByRole('button', { name: /Wednesday, October 14, 2026, \d+ times available/ }).click();
      // Position in the document (not the viewport): reaching the button may scroll the page,
      // but opening the popover must not move or resize anything.
      const cardRect = () =>
        page.locator('.card').evaluate((el) => {
          const r = el.getBoundingClientRect();
          return { top: r.top + scrollY, left: r.left + scrollX, width: r.width, height: r.height };
        });
      const cardBefore = await cardRect();
      await triggerOf(page).click();
      const panel = panelOf(page);
      await expect(panel).toBeVisible();
      await settled(page);
      const t = (await triggerOf(page).boundingBox())!;
      const p = (await panel.boundingBox())!;
      // Directly below the button (6px gap), right edges aligned, compact width, fully on screen.
      expect(p.y - (t.y + t.height)).toBeCloseTo(6, 0);
      expect(Math.abs(p.x + p.width - (t.x + t.width))).toBeLessThanOrEqual(1);
      expect(p.width).toBeGreaterThanOrEqual(320);
      expect(p.width).toBeLessThanOrEqual(360);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y + p.height).toBeLessThanOrEqual(900);
      // A popover, not a modal: the page stays put and is not made inert.
      await expect(panel).not.toHaveAttribute('aria-modal', 'true');
      expect(await page.locator('main').evaluate((m) => !!m.closest('[inert],[aria-hidden="true"]'))).toBe(false);
      // Unmoved to within 0.005px: well under Firefox's 1/60px layout unit, so any real shift fails,
      // but float noise from adding the scroll offset (72.04998779 vs 72.05000305) does not.
      const cardAfter = await cardRect();
      for (const key of ['top', 'left', 'width', 'height'] as const) {
        expect(cardAfter[key], `card ${key}`).toBeCloseTo(cardBefore[key], 2);
      }
      expect(await panel.evaluate((el) => getComputedStyle(el).backgroundColor)).toMatch(/^rgb\(/); // opaque, no alpha
    });
  }

  test('keyboard: both selects, Escape closes the innermost popup first, focus returns', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Keyboard behaviour');
    await page.goto(la);
    await ready(page);
    const trigger = triggerOf(page);
    await trigger.focus();
    await page.keyboard.press('Enter');
    const panel = panelOf(page);
    const guest = panel.getByRole('combobox', { name: 'Guest timezone' });
    await expect(guest).toBeFocused();

    // Guest timezone: open with ArrowDown, highlight starts on the current value, Enter chooses.
    await page.keyboard.press('ArrowDown');
    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible();
    await expect(page.getByRole('option', { name: 'Los Angeles' })).toHaveAttribute('data-highlighted', '');
    // The list takes keys once focus is on the highlighted option (WebKit moves it a frame later).
    await expect(page.getByRole('option', { name: 'Los Angeles' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('option', { name: 'London' })).toHaveAttribute('data-highlighted', '');
    await page.keyboard.press('Enter');
    await expect(listbox).toHaveCount(0);
    await expect(panel).toBeVisible(); // choosing inside a nested popup never dismisses the panel
    await expect(guest).toHaveText('London');
    await expect(guest).toBeFocused();
    await expect(page.locator('.tz-trigger-name')).toHaveText('United Kingdom Time');

    // Network simulation, reached by Tab (past the switch).
    await page.keyboard.press('Tab');
    await expect(panel.getByRole('switch', { name: 'Host shares local time' })).toBeFocused();
    await page.keyboard.press('Tab');
    const network = panel.getByRole('combobox', { name: 'Network simulation' });
    await expect(network).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(listbox).toBeVisible(); // wait for the list before moving through it
    await expect(page.getByRole('option', { name: 'Normal' })).toHaveAttribute('data-highlighted', '');
    await expect(page.getByRole('option', { name: 'Normal' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('option', { name: 'Slow responses' })).toHaveAttribute('data-highlighted', '');
    await page.keyboard.press('Enter');
    await expect(listbox).toHaveCount(0);
    await expect(network).toHaveText('Slow responses');
    await expect(network).toBeFocused();

    // Escape: first the open select, then the panel, then focus is back on the button.
    await page.keyboard.press('ArrowDown');
    await expect(listbox).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(listbox).toHaveCount(0);
    await expect(panel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('selection indicator: only the current option is checked and selected', async ({ page }) => {
    await page.goto(la);
    await ready(page);
    await triggerOf(page).click();
    await page.getByRole('combobox', { name: 'Network simulation' }).click();
    const options = page.getByRole('option');
    await expect(options).toHaveText(['Normal', 'Slow responses', 'Fail next load', 'Slot taken on confirmation']);
    await expect(page.getByRole('option', { name: 'Normal' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('option', { name: 'Normal' }).locator('.popup-item-check')).toBeVisible();
    await expect(page.locator('.select-popup [aria-selected="true"]')).toHaveCount(1);
    await expect(page.locator('.select-popup .popup-item-check')).toHaveCount(1);
  });

  for (const width of [1280, 768]) {
    test(`nested select popup at ${width}px: trigger width, on screen, above the page`, async ({ page, isMobile }) => {
      test.skip(isMobile, 'Fixed widths');
      await page.setViewportSize({ width, height: 900 });
      await page.goto(la);
      await ready(page);
      await triggerOf(page).click();
      const select = page.getByRole('combobox', { name: 'Guest timezone' });
      await select.click();
      const list = page.locator('.select-popup');
      await expect(list).toBeVisible();
      await popupSettled(page, '.select-popup');
      const s = (await select.boundingBox())!;
      const l = (await list.boundingBox())!;
      expect(Math.abs(l.width - s.width)).toBeLessThanOrEqual(1);
      expect(l.x).toBeGreaterThanOrEqual(0);
      expect(l.x + l.width).toBeLessThanOrEqual(width);
      expect(l.y + l.height).toBeLessThanOrEqual(900);
      // Nothing (the settings panel or the booking card) paints over it.
      const top = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.select-popup'), {
        x: l.x + l.width / 2,
        y: l.y + l.height - 8,
      });
      expect(top).toBe(true);
    });
  }

  test('outside click dismisses; clicks inside a nested popup do not', async ({ page }) => {
    await page.goto(la);
    await ready(page);
    await triggerOf(page).click();
    const panel = panelOf(page);
    await pick(page, 'Network simulation', 'Fail next load');
    await expect(panel).toBeVisible();
    // Desktop: a click on the page. Phone: a tap on the dimmed page above the sheet.
    const vp = page.viewportSize()!;
    await page.mouse.click(10, vp.width <= 520 ? 10 : vp.height - 10);
    await expect(panel).toBeHidden();
  });

  test('short viewport: the panel stays on screen and scrolls instead of overflowing', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Desktop collision check');
    await page.setViewportSize({ width: 1024, height: 300 });
    await page.goto(la);
    await ready(page);
    await triggerOf(page).click();
    const panel = panelOf(page);
    await expect(panel).toBeVisible();
    await settled(page);
    const p = (await panel.boundingBox())!;
    expect(p.y + p.height).toBeLessThanOrEqual(300);
    expect(await panel.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  });

  test('phone: modal bottom sheet with a usable nested select', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Phone layout');
    await page.goto(la);
    await ready(page);
    const panel = panelOf(page);
    await expect(panel).toHaveCount(0); // closed by default
    const trigger = triggerOf(page);
    await trigger.click();
    await expect(panel).toBeVisible();
    await settled(page);
    const p = (await panel.boundingBox())!;
    const vp = page.viewportSize()!;
    expect(p.x).toBeCloseTo(0, 0);
    expect(p.width).toBeCloseTo(vp.width, 0);
    expect(p.y + p.height).toBeCloseTo(vp.height, 0);
    await expect(panel).toHaveAttribute('aria-modal', 'true');
    expect(await page.locator('main').evaluate((m) => !!m.closest('[inert],[aria-hidden="true"]'))).toBe(true);
    await page.getByRole('combobox', { name: 'Network simulation' }).click();
    const list = page.locator('.select-popup');
    await expect(list).toBeVisible();
    const l = (await list.boundingBox())!;
    expect(l.y).toBeGreaterThanOrEqual(0);
    expect(l.y + l.height).toBeLessThanOrEqual(vp.height);
    // Don't tap an option while the popup is still moving into place.
    await popupSettled(page, '.select-popup');
    await page.getByRole('option', { name: 'Slow responses' }).click();
    await expect(panel).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Network simulation' })).toHaveText('Slow responses');
    await panel.getByRole('button', { name: 'Close demo settings' }).click();
    await expect(panel).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('select triggers: one chevron, centred and inset; matching heights', async ({ page }) => {
    await page.goto(la);
    await ready(page);
    await triggerOf(page).click();
    await settled(page);
    for (const name of ['Guest timezone', 'Network simulation']) {
      const m = await page.getByRole('combobox', { name }).evaluate((el) => {
        const box = el.getBoundingClientRect();
        const icon = el.querySelector('.select-icon')!.getBoundingClientRect();
        const value = el.querySelector('.select-value')!.getBoundingClientRect();
        return {
          icons: el.querySelectorAll('svg').length,
          height: box.height,
          centreOffset: Math.abs(icon.top + icon.height / 2 - (box.top + box.height / 2)),
          rightInset: box.right - icon.right,
          gap: icon.left - value.right,
        };
      });
      expect(m.icons, name).toBe(1);
      expect(m.height, name).toBe(40);
      expect(m.centreOffset, name).toBeLessThanOrEqual(1);
      expect(Math.abs(m.rightInset - 13), name).toBeLessThanOrEqual(1); // 12px padding + 1px border
      expect(m.gap, name).toBeGreaterThanOrEqual(8);
    }
  });

  test('theme menu: anchored under its button, on screen, Escape returns focus', async ({ page }) => {
    await page.goto(la);
    await ready(page);
    const trigger = page.getByRole('button', { name: /^Theme:/ });
    await trigger.click();
    const menu = page.locator('.menu-popup');
    await expect(menu).toBeVisible();
    await popupSettled(page, '.menu-popup');
    const t = (await trigger.boundingBox())!;
    const m = (await menu.boundingBox())!;
    const vp = page.viewportSize()!;
    expect(m.y - (t.y + t.height)).toBeCloseTo(6, 0);
    expect(m.x).toBeGreaterThanOrEqual(0);
    expect(m.x + m.width).toBeLessThanOrEqual(vp.width);
    // End-aligned with its button unless that would leave the viewport.
    if (t.x + t.width - m.width >= 12) expect(Math.abs(m.x + m.width - (t.x + t.width))).toBeLessThanOrEqual(1);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});

test.describe('summary consistency and responsive sweep', () => {
  test('the chosen slot reads the same in the list, the details summary and the confirmation', async ({ page }) => {
    await page.goto(la);
    await ready(page);
    await page.getByRole('button', { name: /Wednesday, October 14, 2026, \d+ times available/ }).click();
    const sw = page.getByRole('switch', { name: 'Show host’s time' });
    if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click();
    const slot = page.locator('button.slot').last(); // 11:30 PM Wed in LA = Thu in India
    const guest = (await slot.locator('.slot-time').textContent())!;
    const host = (await slot.locator('.slot-host').textContent())!.match(/^\d{1,2}:\d{2}\s*(?:AM|PM)/)![0];
    await slot.click();
    const check = async (scope: string) => {
      const blocks = page.locator(`${scope} .tc-block`);
      await expect(blocks.nth(0).locator('.tc-label')).toHaveText('Your time');
      await expect(blocks.nth(0).locator('.tc-date')).toHaveText('Wednesday, October 14');
      await expect(blocks.nth(0).locator('.tc-time')).toHaveText(new RegExp(`^${guest} – `));
      await expect(blocks.nth(1).locator('.tc-label')).toHaveText('Arjun’s time');
      await expect(blocks.nth(1).locator('.tc-date')).toHaveText('Thursday, October 15');
      await expect(blocks.nth(1).locator('.tc-time')).toHaveText(new RegExp(`^${host} – `));
    };
    await check('.meta');
    await page.locator('#f-name').fill('Jane Doe');
    await page.locator('#f-email').fill('jane@example.com');
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByRole('heading', { name: 'This meeting is scheduled' })).toBeVisible();
    await check('.confirm-rows');
  });

  test('no horizontal scroll at 1440, 1280, 1024, 768, 390 and 375px (booker, details, confirmation)', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Widths are set explicitly');
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    for (const width of [1440, 1280, 1024, 768, 390, 375]) {
      await page.setViewportSize({ width, height: 860 });
      await page.goto(la);
      await ready(page);
      await page.getByRole('button', { name: /Wednesday, October 14, 2026, \d+ times available/ }).click();
      expect(await overflow(), `${width} booker`).toBeLessThanOrEqual(0);
      await page.locator('button.slot').last().click();
      expect(await overflow(), `${width} details`).toBeLessThanOrEqual(0);
      await page.locator('#f-name').fill('Jane Doe');
      await page.locator('#f-email').fill('jane@example.com');
      await page.getByRole('button', { name: 'Confirm' }).click();
      await expect(page.getByRole('heading', { name: 'This meeting is scheduled' })).toBeVisible();
      expect(await overflow(), `${width} confirmation`).toBeLessThanOrEqual(0);
    }
  });
});

test.describe('site frame and controls', () => {
  test('the default view shows the product, an attribution and the disclosure, but no test controls', async ({ page }) => {
    await page.goto(la);
    await ready(page);
    await expect(page.getByRole('banner')).toContainText('TimeBridge');
    await expect(page.getByRole('banner')).toContainText('Independent booking UX concept');
    await expect(page.getByRole('contentinfo')).toHaveText(
      'Availability and bookings are simulated in your browser. TimeBridge is not affiliated with or connected to Cal.com.',
    );
    await expect(page.locator('select:visible')).toHaveCount(0);
    await expect(page.getByLabel('Network simulation')).toHaveCount(0);
  });

  test('Demo settings: keyboard opens on the first control, Escape closes and returns focus', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Keyboard behaviour');
    await page.goto(la);
    await ready(page);
    const trigger = page.getByRole('button', { name: 'Demo settings' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const panel = page.getByRole('dialog', { name: 'Demo settings' });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('combobox', { name: 'Guest timezone' })).toBeFocused();
    // Full disclosure lives in the footer; the panel carries only a short reminder.
    await expect(panel).toContainText('Simulated data. Not connected to Cal.com.');
    await expect(page.getByRole('contentinfo')).toContainText('not affiliated with or connected to Cal.com');
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('Demo settings drive the booking page', async ({ page }) => {
    await page.goto(la);
    await ready(page);
    await demoSetting(page, () => pick(page, 'Guest timezone', 'London'));
    await expect(page.locator('.tz-trigger')).toContainText('United Kingdom Time');
    await expect(hostLine(page)).toHaveText('Arjun’s time is 4h 30m ahead');
    await demoSetting(page, (panel) => panel.getByRole('switch', { name: 'Host shares local time' }).click());
    await expect(page.locator('#bridge-note')).toHaveCount(0);
  });

  test('theme menu: keyboard choice applies, persists, and returns to System', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Keyboard behaviour');
    await page.goto(la);
    await ready(page);
    const trigger = page.getByRole('button', { name: 'Theme: System' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitemradio', { name: 'System' })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('button', { name: 'Theme: Dark' })).toBeFocused();
    await page.reload();
    await ready(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: 'Theme: Dark' }).click();
    await page.getByRole('menuitemradio', { name: 'System' }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  });

  test('popups are fully opaque from their first visible frame', async ({ page }) => {
    await page.goto(la);
    await ready(page);
    const opacityNow = (selector: string) =>
      page.waitForFunction((sel) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).opacity : null;
      }, selector);
    await page.locator('.tz-trigger').click();
    expect(await (await opacityNow('.tz-popup')).jsonValue()).toBe('1');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^Theme:/ }).click();
    expect(await (await opacityNow('.menu-popup')).jsonValue()).toBe('1');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Demo settings' }).click();
    expect(await (await opacityNow('.settings-panel')).jsonValue()).toBe('1'); // popover, or sheet on phones
    await page.getByRole('combobox', { name: 'Guest timezone' }).click();
    expect(await (await opacityNow('.select-popup')).jsonValue()).toBe('1');
  });

  test('time-zone trigger: chevron centred on the zone name, 44px target', async ({ page }) => {
    await page.goto(la);
    await ready(page);
    const name = await page.locator('.tz-trigger-name').boundingBox();
    const chevron = await page.locator('.tz-trigger-chevron').boundingBox();
    const trigger = await page.locator('.tz-trigger').boundingBox();
    expect(Math.abs(name!.y + name!.height / 2 - (chevron!.y + chevron!.height / 2))).toBeLessThanOrEqual(1);
    expect(trigger!.height).toBeGreaterThanOrEqual(44);
  });
});

test.describe('accessibility and layout', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`axe: booking states (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(la);
      await ready(page);
      await axe(page, 'calendar');
      await page.getByRole('button', { name: /^Theme:/ }).click();
      await expect(page.getByRole('menu')).toBeVisible();
      await axe(page, 'theme menu');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Demo settings' }).click();
      await expect(page.getByRole('dialog', { name: 'Demo settings' })).toBeVisible();
      await axe(page, 'demo settings');
      await page.getByRole('combobox', { name: 'Network simulation' }).click();
      await expect(page.getByRole('listbox')).toBeVisible();
      await axe(page, 'demo settings with a select open');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await page.locator('button.day[data-available]').first().click();
      await page.locator('.compare-toggle').click();
      await axe(page, 'times + comparison');
      await page.locator('.tz-trigger').click();
      // Scanned immediately: popups move in but never fade, so there is no low-contrast frame to wait out.
      await expect(page.locator('.tz-popup')).toBeVisible();
      await axe(page, 'time-zone popup');
      await page.keyboard.press('Escape');
      await page.locator('button.slot').first().click();
      await page.getByRole('button', { name: 'Confirm' }).click();
      await axe(page, 'details with errors');
      await page.locator('#f-name').fill('Jane');
      await page.locator('#f-email').fill('jane@example.com');
      await page.getByRole('button', { name: 'Confirm' }).click();
      await expect(page.getByRole('heading', { name: 'This meeting is scheduled' })).toBeVisible();
      await axe(page, 'confirmation');
      await page.goto(`/?tz=Europe/London&now=${NOW}`);
      await ready(page);
      await page.getByRole('button', { name: /Monday, October 26, 2026, \d+ times available/ }).click();
      await page.locator('.compare-toggle').click();
      await page.locator('#bridge-note .change-note-summary').click();
      await expect(page.locator('#bridge-note .change-note-detail')).toBeVisible();
      await axe(page, 'London comparison + clock-change detail open');
    });
  }

  test('no horizontal scrolling and adequate target sizes', async ({ page }) => {
    await page.goto(la);
    await ready(page);
    await page.locator('button.day[data-available]').first().click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const small = await page.locator('main button:visible').evaluateAll((els) =>
      els
        .map((e) => ({ r: e.getBoundingClientRect(), name: e.getAttribute('aria-label') || e.textContent }))
        .filter(({ r }) => r.width < 24 || r.height < 24)
        .map(({ name }) => name),
    );
    expect(small).toEqual([]);
  });

  test('respects reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(la);
    await ready(page);
    const anim = await page.locator('button.day').first().evaluate((e) => getComputedStyle(e).animationName);
    expect(anim).toBe('none');
  });
});

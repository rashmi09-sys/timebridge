import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/*
 * Repeated clock times and locale-aware formatting, checked in the browser.
 *
 * Locale tests compute the expected strings with the browser's own Intl, so they check that the
 * page follows the browser's locale without hard-coding one ICU version's punctuation (engines
 * ship different CLDR data). The exact strings are pinned in the unit tests (tests/unit/locale.test.ts).
 */

async function ready(page: Page) {
  await expect(page.locator('button.day[data-available]').first()).toBeVisible();
}

const slotTimes = (page: Page) => page.locator('button.slot .slot-time');

const NOTE = 'Clocks go back on this day. Some times appear twice.';
const BEFORE = 'Before clocks change';
const AFTER = 'After clocks change';
// ?schedule=every-day: Arjun's weekday hours never reach LA's repeated hour, so the fixture opens weekends too.
const FALLBACK_URL = '/?tz=America/Los_Angeles&now=2026-10-30T15:30:00Z&schedule=every-day';

/** What each time button shows: "1:15 AM", or "1:15 AM · After clocks change" for a repeated time. */
async function shownSlots(page: Page): Promise<string[]> {
  return page.locator('button.slot').evaluateAll((buttons) =>
    buttons.map((b) => {
      const time = b.querySelector('.slot-time')!.textContent!;
      const when = b.querySelector('.slot-when')?.textContent;
      return when ? `${time} · ${when}` : time;
    }),
  );
}

/** One time button by its visible time, and by its occurrence line when the time repeats. */
function slotNamed(page: Page, time: string, when?: string) {
  const exact = (text: string) => new RegExp(`^${text}$`);
  const base = page.locator('button.slot', { has: page.locator('.slot-time', { hasText: exact(time) }) });
  return when
    ? base.filter({ has: page.locator('.slot-when', { hasText: exact(when) }) })
    : base.filter({ hasNot: page.locator('.slot-when') });
}

/** Shows November (if the page didn't open on it) and waits until its data has loaded. */
async function toNovember(page: Page) {
  if (!(await page.locator('#calendar-title').textContent())?.startsWith('November')) {
    await page.getByRole('button', { name: 'Next month' }).click();
  }
  await expect(page.locator('#calendar-title')).toHaveText('November 2026');
  await expect(page.locator('button.day[data-key="2026-11-01"][data-available]')).toBeVisible();
}

async function openDay(page: Page, key: string, url = FALLBACK_URL) {
  await page.goto(url);
  await ready(page);
  if (key.startsWith('2026-11')) await toNovember(page);
  await page.locator(`button.day[data-key="${key}"]`).click();
  await expect(page.locator('.slots-title')).toContainText(new RegExp(` ${Number(key.slice(8))},`));
  await expect(slotTimes(page).first()).toBeVisible();
}

const openNov1 = (page: Page, url = FALLBACK_URL) => openDay(page, '2026-11-01', url);

async function bookAndExport(page: Page, time: string, when?: string) {
  await slotNamed(page, time, when).click();
  await page.locator('#f-name').fill('Jane Doe');
  await page.locator('#f-email').fill('jane@example.com');
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('heading', { name: 'This meeting is scheduled' })).toBeVisible();
  const ics = decodeURIComponent((await page.locator('a[download="meeting.ics"]').getAttribute('href'))!.split(',')[1]);
  const google = new URL((await page.getByRole('link', { name: /Google Calendar/ }).getAttribute('href'))!);
  return { ics, google };
}

async function settled(page: Page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('.settings-panel');
    return !!el && el.getAnimations({ subtree: true }).length === 0 && getComputedStyle(el).transform === 'none';
  });
}

async function chooseGuestPreset(page: Page, option: string) {
  await page.getByRole('button', { name: 'Demo settings', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Demo settings' });
  await expect(panel).toBeVisible();
  await settled(page);
  await page.getByRole('combobox', { name: 'Guest timezone' }).click();
  // Settled means the entry motion has finished, not just "no running animations" (WebKit reports none the frame before it starts).
  await page.waitForFunction(() => {
    const el = document.querySelector('.select-popup');
    return !!el && !el.hasAttribute('data-starting-style') && el.getAnimations().length === 0 && getComputedStyle(el).transform === 'none';
  });
  await page.getByRole('option', { name: option, exact: true }).click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
}

test.describe('repeated times when clocks go back (Los Angeles, Sun 1 Nov 2026)', () => {
  test('the repeated hour is listed twice, in time order, with plain times and an occurrence line', async ({ page }) => {
    await openNov1(page);
    const shown = await shownSlots(page);
    // Every button reads differently once its occurrence line is counted.
    expect(new Set(shown).size, shown.join(' | ')).toBe(shown.length);
    // Some times are pre-booked in the simulation; 1:00 and 1:15 are open in both occurrences.
    for (const t of ['1:00 AM', '1:15 AM']) {
      expect(shown).toContain(`${t} · ${BEFORE}`);
      expect(shown).toContain(`${t} · ${AFTER}`);
    }
    // Every "before" time comes before every "after" time.
    const lastBefore = Math.max(...shown.map((l, i) => (l.endsWith(BEFORE) ? i : -1)));
    const firstAfter = shown.findIndex((l) => l.endsWith(AFTER));
    expect(lastBefore).toBeGreaterThanOrEqual(0);
    expect(firstAfter).toBeGreaterThan(lastBefore);
    // Occurrence lines only inside 1:00–1:59; no abbreviations anywhere on the buttons.
    for (const l of shown) expect(l.includes('clocks change'), l).toBe(/^1:\d\d AM/.test(l));
    expect(await page.locator('button.slot').allTextContents()).not.toContainEqual(expect.stringMatching(/P[DS]T|GMT/));
    // Times either side of the repeated hour are left alone.
    expect(shown).toContain('12:45 AM');
    expect(shown).toContain('2:00 AM');
  });

  test('screen readers hear which occurrence and its UTC offset', async ({ page }) => {
    await openNov1(page);
    await expect(slotNamed(page, '1:15 AM', BEFORE)).toHaveAttribute('aria-label', '1:15 AM your time, before clocks change, UTC minus 7');
    await expect(slotNamed(page, '1:15 AM', AFTER)).toHaveAttribute('aria-label', '1:15 AM your time, after clocks change, UTC minus 8');
    await expect(slotNamed(page, '2:00 AM')).toHaveAttribute('aria-label', '2:00 AM your time');
  });

  test('repeated buttons keep the list’s height and rhythm; the second line fits inside', async ({ page }) => {
    await openNov1(page);
    const ordinary = (await slotNamed(page, '2:00 AM').boundingBox())!;
    const repeated = slotNamed(page, '1:15 AM', AFTER);
    const box = (await repeated.boundingBox())!;
    expect(box.height).toBeCloseTo(ordinary.height, 0);
    expect(box.width).toBeCloseTo(ordinary.width, 0);
    const fits = await repeated.evaluate((b) => {
      const label = b.querySelector('.slot-label')!.getBoundingClientRect();
      const r = b.getBoundingClientRect();
      return label.top >= r.top && label.bottom <= r.bottom;
    });
    expect(fits).toBe(true);
    // The occurrence line is smaller and muted, like the host time.
    const style = await repeated.locator('.slot-when').evaluate((el) => {
      const t = getComputedStyle(el.parentElement!.querySelector('.slot-time')!);
      const w = getComputedStyle(el);
      return { whenSize: parseFloat(w.fontSize), timeSize: parseFloat(t.fontSize) };
    });
    expect(style.whenSize).toBeLessThan(style.timeSize);
  });

  for (const [when, utcStart, utcEnd, india] of [
    [BEFORE, '20261101T081500Z', '20261101T083000Z', '1:45 PM – 2:00 PM'],
    [AFTER, '20261101T091500Z', '20261101T093000Z', '2:45 PM – 3:00 PM'],
  ] as const) {
    test(`booking 1:15 AM (${when.toLowerCase()}): details, confirmation and both exports carry its own instant`, async ({ page }) => {
      await openNov1(page);
      await slotNamed(page, '1:15 AM', when).click();
      const details = page.locator('.tc-block');
      await expect(details.nth(0).locator('.tc-time')).toHaveText('1:15 AM – 1:30 AM');
      await expect(details.nth(0).locator('.tc-when')).toContainText(when);
      // India has no repeated time, so its block has no occurrence line.
      await expect(details.nth(1).locator('.tc-time')).toHaveText(india);
      await expect(details.nth(1).locator('.tc-when')).toHaveCount(0);

      await page.getByRole('button', { name: 'Back' }).click();
      const { ics, google } = await bookAndExport(page, '1:15 AM', when);
      const rows = page.locator('.confirm-rows .tc-block');
      await expect(rows.nth(0).locator('.tc-date')).toHaveText('Sunday, November 1');
      await expect(rows.nth(0).locator('.tc-time')).toHaveText('1:15 AM – 1:30 AM');
      await expect(rows.nth(0).locator('.tc-when')).toHaveText(`${when}, UTC minus ${when === BEFORE ? 7 : 8}`);
      await expect(rows.nth(0).locator('.tc-zone')).toHaveText('Pacific Time · Los Angeles');
      await expect(rows.nth(1).locator('.tc-time')).toHaveText(india);
      await expect(page.locator('.confirm-rows')).not.toContainText(/P[DS]T/);
      expect(ics).toContain(`\r\nDTSTART:${utcStart}\r\nDTEND:${utcEnd}\r\n`);
      expect(google.searchParams.get('dates')).toBe(`${utcStart}/${utcEnd}`);
    });
  }

  test('24-hour display: same plain times, same occurrence lines, same order', async ({ page }) => {
    await openNov1(page);
    await page.getByRole('button', { name: '24-hour clock' }).click();
    const shown = await shownSlots(page);
    expect(new Set(shown).size).toBe(shown.length);
    expect(shown).toContain(`01:15 · ${BEFORE}`);
    expect(shown).toContain(`01:15 · ${AFTER}`);
    expect(shown.indexOf(`01:15 · ${BEFORE}`)).toBeLessThan(shown.indexOf(`01:15 · ${AFTER}`));
    await expect(slotNamed(page, '01:15', AFTER)).toHaveAttribute('aria-label', '01:15 your time, after clocks change, UTC minus 8');
    await expect(page.locator('.slots-note')).toHaveText(NOTE);
  });

  test('an ordinary date shows no occurrence lines, no note and no abbreviations', async ({ page }) => {
    await openDay(page, '2026-10-31');
    const shown = await shownSlots(page);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.filter((l) => /clocks change|P[DS]T|GMT/.test(l))).toEqual([]);
    await expect(page.locator('.slot-when')).toHaveCount(0);
    await expect(page.locator('.slots-note')).toHaveCount(0);
  });
});

test.describe('repeated times: explanation, keyboard and zone changes', () => {
  test('one quiet explanation above the list, only on the date with repeated times', async ({ page }) => {
    await openNov1(page);
    const note = page.locator('.slots-note');
    await expect(note).toHaveText(NOTE);
    await expect(note).toHaveCount(1);
    // Above the list, inside the time column, not a live region or alert, and not repeated per button.
    expect(await note.evaluate((el) => el.nextElementSibling?.classList.contains('slot-list'))).toBe(true);
    await expect(note).not.toHaveAttribute('role', /.+/);
    await expect(note).not.toHaveAttribute('aria-live', /.+/);
    await expect(page.locator('.slot-list')).toHaveAttribute('aria-describedby', (await note.getAttribute('id'))!);
    await expect(page.locator('button.slot').filter({ hasText: NOTE })).toHaveCount(0);
    const style = await note.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { border: cs.borderStyle, bg: cs.backgroundColor, svgs: el.querySelectorAll('svg').length };
    });
    expect(style).toEqual({ border: 'none', bg: 'rgba(0, 0, 0, 0)', svgs: 0 });

    // Neighbouring dates have no repeated times, so no note.
    await page.locator('button.day[data-key="2026-11-02"]').click();
    await expect(page.locator('.slots-title')).toContainText(/ 2,/);
    await expect(note).toHaveCount(0);
  });

  test('a clock-change day with no repeated open times shows no explanation (Arjun’s weekday hours)', async ({ page }) => {
    await openNov1(page, '/?tz=America/Los_Angeles&now=2026-10-30T15:30:00Z');
    const shown = await shownSlots(page);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.filter((l) => /clocks change|P[DS]T|GMT/.test(l))).toEqual([]);
    await expect(page.locator('.slots-note')).toHaveCount(0);
  });

  test('choosing the date announces the explanation once, with the count', async ({ page }) => {
    await page.goto(FALLBACK_URL);
    await ready(page);
    await toNovember(page);
    await page.locator('button.day[data-key="2026-11-02"]').click();
    await page.locator('button.day[data-key="2026-11-01"]').click();
    const live = page.locator('.sr-only[role="status"]');
    await expect(live).toHaveText(new RegExp(`^Sunday, November 1, 2026: \\d+ times available\\. ${NOTE.replace(/\./g, '\\.')}$`));
    // An ordinary date's announcement doesn't mention it.
    await page.locator('button.day[data-key="2026-11-02"]').click();
    await expect(live).toHaveText(/^Monday, November 2, 2026: \d+ times available\.$/);
  });

  test('keyboard: arrows move through both occurrences in time order; focus is visible; Back restores the chosen one', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Keyboard behaviour');
    await page.goto(FALLBACK_URL);
    await ready(page);
    await toNovember(page);
    await page.locator('button.day[data-key="2026-11-01"]').focus();
    await page.keyboard.press('Enter');
    const focused = page.locator(':focus');
    await expect(focused).toHaveClass(/slot/);

    // Walk the list with ArrowDown and record each focused button's spoken name.
    const count = await page.locator('button.slot').count();
    const names: string[] = [];
    for (let i = 0; i < count; i++) {
      names.push((await focused.getAttribute('aria-label'))!);
      if (i < count - 1) await page.keyboard.press('ArrowDown');
    }
    expect(names).toEqual(await page.locator('button.slot').evaluateAll((b) => b.map((x) => x.getAttribute('aria-label'))));
    const before = names.indexOf('1:15 AM your time, before clocks change, UTC minus 7');
    const after = names.indexOf('1:15 AM your time, after clocks change, UTC minus 8');
    expect(before).toBeGreaterThanOrEqual(0);
    expect(after).toBeGreaterThan(before);

    // Focus the second 1:15 AM by keyboard and check the ring is drawn.
    await page.keyboard.press('Home');
    for (let i = 0; i < after; i++) await page.keyboard.press('ArrowDown');
    await expect(focused).toHaveAttribute('aria-label', names[after]);
    expect(await focused.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');

    await page.keyboard.press('Enter');
    await expect(page.locator('#f-name')).toBeFocused();
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(focused).toHaveAttribute('aria-label', names[after]);
    await expect(focused).toHaveAttribute('aria-current', 'true');
    await expect(slotNamed(page, '1:15 AM', BEFORE)).not.toHaveAttribute('aria-current', /.+/);
  });

  test('changing the guest zone keeps the chosen instant (second 1:15 AM → 6:15 PM in Tokyo) and drops the note', async ({ page }) => {
    await openNov1(page);
    await slotNamed(page, '1:15 AM', AFTER).click();
    await page.getByRole('button', { name: 'Back' }).click();
    await chooseGuestPreset(page, 'Tokyo');
    // 09:15 UTC is 6:15 PM on Sun 1 Nov in Tokyo.
    await expect(page.locator('button.slot[aria-current="true"] .slot-time')).toHaveText('6:15 PM');
    await expect(page.locator('.slots-note')).toHaveCount(0);
    await expect(page.locator('.slot-when')).toHaveCount(0);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`axe: no violations with the explanation and occurrence lines shown (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openNov1(page);
      await expect(page.locator('.slots-note')).toBeVisible();
      await expect(page.locator('.slot-when').first()).toBeVisible();
      const results = await new AxeBuilder({ page } as unknown as ConstructorParameters<typeof AxeBuilder>[0])
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    });
  }
});

/** Expected strings from the page's own Intl, for the page's own locale. */
async function intl(page: Page) {
  return page.evaluate(() => {
    const locale = new Intl.DateTimeFormat().resolvedOptions().locale;
    const utcNoon = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12));
    const f = (o: Intl.DateTimeFormatOptions, d: Date) =>
      new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...o }).format(d).replace(/[\u202f\u2009]/g, ' ');
    return {
      locale,
      monthTitle: f({ month: 'long', year: 'numeric' }, utcNoon(2026, 10, 1)),
      year: new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'long', year: 'numeric' })
        .formatToParts(utcNoon(2026, 10, 1))
        .find((p) => p.type === 'year')!.value,
      sunday: f({ weekday: 'short' }, utcNoon(2026, 1, 4)).toLocaleUpperCase(locale),
      heading13: `${f({ weekday: 'short' }, utcNoon(2026, 10, 13))} ${f({ day: 'numeric' }, utcNoon(2026, 10, 13))}`,
      // First listed time for an LA guest on Tue 13 Oct: 9:00 PM PDT (04:00 UTC Wed), Arjun's 9:30 AM.
      first12: new Intl.DateTimeFormat(locale, { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit', hourCycle: 'h12' })
        .format(new Date('2026-10-14T04:00:00Z'))
        .replace(/[\u202f\u2009]/g, ' '),
      first24: new Intl.DateTimeFormat(locale, { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' })
        .format(new Date('2026-10-14T04:00:00Z'))
        .replace(/[\u202f\u2009]/g, ' '),
    };
  });
}

const LA_URL = '/?tz=America/Los_Angeles&now=2026-10-13T15:30:00Z';

for (const { locale, defaultCycle } of [
  { locale: 'en-US', defaultCycle: '12h' },
  { locale: 'en-GB', defaultCycle: '24h' },
  { locale: 'ja-JP', defaultCycle: '24h' },
] as const) {
  test.describe(`locale ${locale}`, () => {
    test.use({ locale });

    test('month title, weekday headers, time-list heading and times follow the browser locale', async ({ page }) => {
      await page.goto(LA_URL);
      await ready(page);
      const want = await intl(page);
      expect(want.locale).toBe(locale);

      await expect(page.locator('#calendar-title')).toHaveText(want.monthTitle);
      // The year is muted wherever the locale puts it.
      await expect(page.locator('#calendar-title .muted')).toHaveText(want.year);
      await expect(page.locator('.calendar-grid thead th').first()).toHaveText(want.sunday);
      await expect(page.locator('.slots-title')).toContainText(want.heading13);

      // The locale's own hour cycle is the default: 12h in the US, 24h in the UK and Japan.
      await expect(page.getByRole('button', { name: defaultCycle === '12h' ? '12-hour clock' : '24-hour clock' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(slotTimes(page).first()).toHaveText(defaultCycle === '12h' ? want.first12 : want.first24);
    });

    test('a chosen hour cycle is kept across reloads and still uses the locale’s format', async ({ page }) => {
      await page.goto(LA_URL);
      await ready(page);
      const want = await intl(page);
      const other = defaultCycle === '12h' ? '24h' : '12h';
      await page.getByRole('button', { name: other === '12h' ? '12-hour clock' : '24-hour clock' }).click();
      await expect(slotTimes(page).first()).toHaveText(other === '12h' ? want.first12 : want.first24);

      await page.reload();
      await ready(page);
      await expect(slotTimes(page).first()).toHaveText(other === '12h' ? want.first12 : want.first24);
    });
  });
}

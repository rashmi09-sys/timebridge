import { expect, test, type Page } from '@playwright/test';

/*
 * The time list scrolls inside the booking card on wide screens (a fixed-height card, like
 * Cal.com's booker) and flows with the page on narrow ones. These tests check that the
 * scrolling is intentional: nothing is clipped, keyboard focus is always scrolled into view,
 * and phones never get a nested scroll area.
 */
const LA = '/?tz=America/Los_Angeles&now=2026-10-13T15:30:00Z';

async function ready(page: Page) {
  await expect(page.locator('button.day[data-available]').first()).toBeVisible();
  await expect(page.locator('button.slot').first()).toBeVisible();
}

function within(inner: DOMRect, outer: DOMRect) {
  return inner.top >= outer.top - 0.5 && inner.bottom <= outer.bottom + 0.5;
}

test('desktop: the time list scrolls inside the card; keyboard focus is always visible and the last time is reachable', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Desktop layout');
  await page.goto(LA);
  await ready(page);
  const scroller = page.locator('.slots-scroll');
  const { overflowY, scrolls } = await scroller.evaluate((el) => ({
    overflowY: getComputedStyle(el).overflowY,
    scrolls: el.scrollHeight > el.clientHeight,
  }));
  expect(overflowY).toBe('auto');
  expect(scrolls).toBe(true); // this date has more times than fit, so the case is real

  // Keyboard: End, then Home; the focused time is fully inside the visible list each time.
  await page.locator('button.slot').first().focus();
  const slots = page.locator('button.slot');
  for (const key of ['End', 'Home', 'End']) {
    await page.keyboard.press(key);
    await expect(key === 'End' ? slots.last() : slots.first()).toBeFocused();
    // WebKit can scroll focus into view on the next rendering update rather than within the key
    // press, so wait for it; a time that never comes into view still fails.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const el = document.activeElement as HTMLElement;
            const box = document.querySelector('.slots-scroll')!.getBoundingClientRect();
            const r = el.getBoundingClientRect();
            return r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5;
          }),
        { message: `focused time visible after ${key}`, timeout: 2_000 },
      )
      .toBe(true);
  }

  // Scrolled to the end, the last time sits fully inside the card, with room below it.
  await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight));
  const [last, box, card] = await Promise.all([
    page.locator('button.slot').last().evaluate((el) => el.getBoundingClientRect().toJSON() as DOMRect),
    scroller.evaluate((el) => el.getBoundingClientRect().toJSON() as DOMRect),
    page.locator('.card-booker').evaluate((el) => el.getBoundingClientRect().toJSON() as DOMRect),
  ]);
  expect(within(last, box)).toBe(true);
  expect(within(box, card)).toBe(true);

  // A mouse wheel over the list scrolls the list, not the page.
  await scroller.evaluate((el) => (el.scrollTop = 0));
  const pageY = await page.evaluate(() => window.scrollY);
  const b = (await scroller.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.wheel(0, 300);
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(pageY);
});

test('phones and narrow windows: no nested scroll area; the list flows with the page and every time can be reached', async ({ page, isMobile }) => {
  if (!isMobile) await page.setViewportSize({ width: 640, height: 800 }); // 1280px at 200% zoom
  await page.goto(LA);
  await ready(page);
  const scroller = page.locator('.slots-scroll');
  expect(await scroller.evaluate((el) => getComputedStyle(el).overflowY)).toBe('visible');
  const last = page.locator('button.slot').last();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  // The last time isn't covered by anything (hit-testing at its centre finds the button).
  const hit = await last.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!at && el.contains(at);
  });
  expect(hit).toBe(true);
});

test('a complete booking produces no console errors or warnings', async ({ page }) => {
  const messages: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') messages.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => messages.push(`pageerror: ${e.message}`));
  await page.goto(LA);
  await ready(page);
  await page.locator('button.slot').first().click();
  await page.locator('#f-name').fill('Jane Doe');
  await page.locator('#f-email').fill('jane@example.com');
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('heading', { name: 'This meeting is scheduled' })).toBeVisible();
  await page.getByRole('button', { name: 'Book another time' }).click();
  await ready(page);
  expect(messages).toEqual([]);
});

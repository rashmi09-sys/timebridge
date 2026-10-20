import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const URL = '/?tz=America/Los_Angeles&now=2026-10-13T15:30:00Z&share=off';

async function ready(page: Page) {
  await expect(page.locator('button.day[data-available]').first()).toBeVisible();
}

/** Makes date formatting throw, then re-renders the calendar by choosing another date. */
async function crash(page: Page) {
  await page.evaluate(() => {
    const proto = Intl.DateTimeFormat.prototype as unknown as Record<string, unknown>;
    (window as unknown as Record<string, unknown>).__realFormatToParts = proto.formatToParts;
    proto.formatToParts = () => {
      throw new Error('Simulated rendering failure');
    };
  });
  await page.locator('button.day[data-available]').nth(1).click();
}

async function restore(page: Page) {
  await page.evaluate(() => {
    const proto = Intl.DateTimeFormat.prototype as unknown as Record<string, unknown>;
    proto.formatToParts = (window as unknown as Record<string, unknown>).__realFormatToParts;
  });
}

test.describe('error boundary', () => {
  test('a rendering error shows a recovery message with focus on it, and Try again recovers', async ({ page }) => {
    await page.goto(URL);
    await ready(page);
    await crash(page);

    const heading = page.getByRole('heading', { level: 1, name: 'Something went wrong' });
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    await expect(page.getByText('Nothing was booked.', { exact: false })).toBeVisible();
    const axe = await new AxeBuilder({ page } as unknown as ConstructorParameters<typeof AxeBuilder>[0])
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);

    await restore(page);
    await page.getByRole('button', { name: 'Try again' }).click();
    await ready(page);
    await expect(heading).toHaveCount(0);
  });

  test('Start over reloads a fresh booking page, keeping only the zone and demo clock', async ({ page }) => {
    await page.goto(URL);
    await ready(page);
    await crash(page);
    await page.getByRole('button', { name: 'Start over' }).click();
    await page.waitForURL((u) => !u.search.includes('share'));
    const url = new globalThis.URL(page.url());
    expect(url.searchParams.get('tz')).toBe('America/Los_Angeles');
    expect(url.searchParams.get('now')).toBe('2026-10-13T15:30:00Z');
    expect(url.searchParams.get('share')).toBeNull();
    await ready(page);
  });
});

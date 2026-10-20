import { defineConfig, devices } from '@playwright/test';

/**
 * Five projects: Chromium, Firefox and WebKit on desktop, plus Chromium (Pixel 7) and WebKit
 * (iPhone 13) on phones. CI runs all five. Locally, `npm run test:e2e:chromium` runs the two
 * Chromium projects when only Chromium is installed.
 */
const desktop = { viewport: { width: 1280, height: 860 } };

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  expect: { timeout: 10_000 },
  reporter: process.env.GITHUB_ACTIONS ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    // The visitor's browser lives in India; the guest zone under test comes from ?tz=.
    timezoneId: 'Asia/Kolkata',
    // Existing tests read US English formats; locale tests override this per test.
    locale: 'en-US',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], ...desktop } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'desktop-firefox', use: { ...devices['Desktop Firefox'], ...desktop } },
    { name: 'desktop-webkit', use: { ...devices['Desktop Safari'], ...desktop } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'npx vite build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});

/** Run real browser journeys against the production build, or an explicitly supplied deployment. */
import { defineConfig, devices } from '@playwright/test';

const origin = 'http://127.0.0.1:4173';
const serve = 'npm run preview -- --port 4173 --strictPort';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 3,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? origin,
    trace: 'retain-on-failure',
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  ...(process.env.E2E_BASE_URL
    ? {}
    : {
        webServer: {
          // CI has already built (`npm run verify` runs first), so it only serves that build.
          command: process.env.CI ? serve : `npm run build && ${serve}`,
          url: origin,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      }),
});

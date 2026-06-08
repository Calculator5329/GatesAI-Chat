import { defineConfig, devices } from '@playwright/test';

// Two browser surfaces are exercised:
//   desktop-mocked — the default Vite build (runtime mode "desktop"), so the
//     bridge poller runs. Specs mock http://127.0.0.1:7331 so the bridge comes
//     "online" and attachment / image-job / workspace flows are testable.
//   web-lite       — the `firebase` mode build (VITE_GATESAI_WEB=1) where the
//     bridge is intentionally absent; specs assert the degraded/notice states.
// Uncommon ports so we never collide with (or accidentally reuse) another
// Vite app a developer may already have on the default 5173/5174.
const DESKTOP_PORT = 5273;
const WEB_LITE_PORT = 5274;
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: isCI ? 'line' : 'list',
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'desktop-mocked',
      testIgnore: '**/web-lite.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${DESKTOP_PORT}` },
    },
    {
      name: 'web-lite',
      testMatch: '**/web-lite.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${WEB_LITE_PORT}` },
    },
  ],
  webServer: [
    {
      command: `npm run dev -- --port ${DESKTOP_PORT} --strictPort`,
      url: `http://localhost:${DESKTOP_PORT}`,
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
    {
      command: `npm run dev -- --mode firebase --port ${WEB_LITE_PORT} --strictPort`,
      url: `http://localhost:${WEB_LITE_PORT}`,
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
  ],
});

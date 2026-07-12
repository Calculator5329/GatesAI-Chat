import { defineConfig, devices } from '@playwright/test';

// Two browser surfaces are exercised:
//   desktop-mocked — the default Vite build (runtime mode "desktop"), so the
//     bridge poller runs. Specs mock http://127.0.0.1:7331 so the bridge comes
//     "online" and attachment / image-job / workspace flows are testable.
//   web-lite       — the `firebase` mode build (VITE_GATESAI_WEB=1) where the
//     bridge is intentionally absent; specs assert the degraded/notice states.
// Ports live in tests/e2e/ports.ts (shared with globalSetup, env-overridable);
// globalSetup verifies whatever answers on them is actually this app.
import { DESKTOP_PORT, WEB_LITE_PORT } from './tests/e2e/ports';
const isCI = !!process.env.CI;
const workerCount = isCI ? 1 : process.platform === 'win32' ? 4 : undefined;
const screensTourEnabled = process.env.SCREENS_TOUR === '1';
const screensTourSpec = '**/screensTour.spec.ts';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: workerCount,
  reporter: isCI ? 'line' : 'list',
  globalSetup: './tests/e2e/globalSetup.ts',
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'desktop-mocked',
      testIgnore: [
        '**/web-lite.spec.ts',
        ...(screensTourEnabled ? [] : [screensTourSpec]),
      ],
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${DESKTOP_PORT}` },
    },
    {
      name: 'web-lite',
      testMatch: screensTourEnabled ? ['**/web-lite.spec.ts', screensTourSpec] : '**/web-lite.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${WEB_LITE_PORT}` },
    },
  ],
});

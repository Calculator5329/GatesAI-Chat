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
  // The app mounts after the load event (src/main.tsx imports bootstrap
  // dynamically), so a first expect right after goto can take longer than the
  // 5 s default when several workers boot at once.
  expect: { timeout: 10_000 },
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
      // Journeys named web-lite-* and mobile-* belong to the projects below.
      grepInvert: /\.spec\.ts (web-lite|mobile)-/,
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${DESKTOP_PORT}` },
    },
    {
      name: 'web-lite',
      testMatch: screensTourEnabled ? ['**/web-lite.spec.ts', screensTourSpec] : '**/web-lite.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${WEB_LITE_PORT}` },
    },
    {
      // Journeys named mobile-* replay the desktop build in a phone-sized
      // viewport, where the sidebar becomes the mobile shell (<= 640px).
      name: 'mobile-journeys',
      testMatch: '**/journeys.generated.spec.ts',
      grep: /\.spec\.ts mobile-/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, baseURL: `http://localhost:${DESKTOP_PORT}` },
    },
    {
      // Compiled agent-handles journeys (journeys/manifest.json) whose name
      // starts with web-lite- replay against the browser build.
      name: 'web-lite-journeys',
      testMatch: '**/journeys.generated.spec.ts',
      grep: /\.spec\.ts web-lite-/,
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${WEB_LITE_PORT}` },
    },
  ],
});

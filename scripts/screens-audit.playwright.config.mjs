import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  testDir: '.',
  testMatch: 'screens-local-first-audit.spec.mjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  globalSetup: fileURLToPath(new URL('../tests/e2e/globalSetup.ts', import.meta.url)),
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:5273',
    trace: 'retain-on-failure',
  },
});

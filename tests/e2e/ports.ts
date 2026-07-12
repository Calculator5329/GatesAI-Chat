// Single source for the e2e dev-server ports, shared by playwright.config.ts
// and globalSetup.ts so they can never disagree. Env overrides exist because
// multiple agent sessions run suites on this machine concurrently — any fixed
// port can be squatted by an unrelated dev server.
function portFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : fallback;
}

export const DESKTOP_PORT = portFromEnv('GATESAI_E2E_DESKTOP_PORT', 5273);
export const WEB_LITE_PORT = portFromEnv('GATESAI_E2E_WEB_LITE_PORT', 5274);

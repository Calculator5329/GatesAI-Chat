// Entry point. In development a scenario named in the URL (`?scenario=`) is
// installed before any store module evaluates, so seeded storage and mocked
// providers are in place when the app boots. The scenario layer is imported
// dynamically behind import.meta.env.DEV; production bundles never contain it
// (scripts/check-dev-bundle.mjs proves that on every build).
async function start(): Promise<void> {
  if (import.meta.env.DEV) {
    const { installDevScenario } = await import('./dev/scenarios');
    const scenario = installDevScenario();
    await import('./bootstrap');
    if (scenario && 'afterBoot' in scenario) await scenario.afterBoot();
    return;
  }
  await import('./bootstrap');
}

void start();

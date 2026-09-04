// Entry point. In development a scenario named in the URL (`?scenario=`) is
// installed before any store module evaluates, so seeded storage and mocked
// providers are in place when the app boots. The scenario layer is imported
// dynamically behind import.meta.env.DEV; production bundles never contain it
// (scripts/check-dev-bundle.mjs proves that on every build). The one other
// build that keeps it is the hosted showcase (vite mode `showcase`, built by
// scripts/build-showcase.mjs), which defines VITE_GATESAI_SHOWCASE as '1'.
// Every other mode defines it as '0', so the branch folds away statically.
async function start(): Promise<void> {
  if (import.meta.env.DEV || import.meta.env.VITE_GATESAI_SHOWCASE === '1') {
    const { installDevScenario } = await import('./dev/scenarios');
    const scenario = installDevScenario();
    await import('./bootstrap');
    if (scenario && 'afterBoot' in scenario) await scenario.afterBoot();
    return;
  }
  await import('./bootstrap');
}

void start();

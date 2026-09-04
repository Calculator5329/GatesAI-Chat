// Dev-only scenario installer. Runs before the stores boot when the page URL
// carries `?scenario=<name>`: clears and seeds localStorage, then replaces
// window.fetch and window.WebSocket with scenario-aware versions. Add
// `&persist=1` to keep whatever the previous page load stored (for journeys
// that reload to prove persistence).
import { findScenario, SCENARIOS } from './catalog';
import { braveRoutes } from './mocks/brave';
import { BridgeFileTable, bridgeRoutes, createWebSocketPatch } from './mocks/bridge';
import { createFetchMock } from './mocks/http';
import { ollamaRoutes } from './mocks/ollama';
import { openRouterRoutes } from './mocks/openrouter';
import { workspaceFiles } from './seeds';
import { DEV_SCENARIO_SENTINEL, type AfterBootStore, type MockRoute, type RecordedCall, type ScenarioDefinition } from './types';

export { SCENARIOS, findScenario } from './catalog';
export type { ScenarioDefinition } from './types';

export interface ScenarioHandle {
  name: string;
  title: string;
  seeded: boolean;
  calls: RecordedCall[];
  /** Call once the app has booted; resolves after the scenario's post-boot step. */
  afterBoot: () => Promise<void>;
  /** True once afterBoot has completed, so a journey can wait on it. */
  ready: boolean;
  bridgeFiles: () => Array<{ path: string; kind: string }>;
  sentinel: typeof DEV_SCENARIO_SENTINEL;
}

export interface ScenarioError {
  error: string;
  available: string[];
}

interface ScenarioWindow {
  location: { search: string };
  localStorage: Storage;
  fetch: typeof fetch;
  WebSocket: typeof WebSocket;
  __gatesaiScenario?: ScenarioHandle | ScenarioError;
  __gatesai?: { store?: AfterBootStore };
}

export const SCENARIO_QUERY_PARAM = 'scenario';
export const PERSIST_QUERY_PARAM = 'persist';

export function readScenarioName(search: string): string | null {
  const value = new URLSearchParams(search).get(SCENARIO_QUERY_PARAM);
  return value && value.trim() ? value.trim() : null;
}

/** Build the route table for a scenario; exported so tests can drive it without a window. */
export function routesFor(scenario: ScenarioDefinition): MockRoute[] {
  return [
    ...openRouterRoutes(scenario.network.openrouter, scenario.network.image),
    ...ollamaRoutes(scenario.network.ollama),
    ...bridgeRoutes(scenario.network.bridge),
    ...braveRoutes(scenario.network.brave),
  ];
}

export function seedStorage(storage: Storage, seed: Record<string, unknown>): void {
  storage.clear();
  for (const [key, value] of Object.entries(seed)) {
    storage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
}

/**
 * Install the scenario named in the URL. Returns null when no scenario is
 * requested so the app boots exactly as it would without this layer.
 */
export function installDevScenario(win: ScenarioWindow = window as unknown as ScenarioWindow): ScenarioHandle | ScenarioError | null {
  const name = readScenarioName(win.location.search);
  if (!name) return null;
  const scenario = findScenario(name);
  if (!scenario) {
    const failure: ScenarioError = { error: `Unknown scenario "${name}"`, available: SCENARIOS.map(entry => entry.name) };
    win.__gatesaiScenario = failure;
    return failure;
  }

  const persist = new URLSearchParams(win.location.search).get(PERSIST_QUERY_PARAM) === '1';
  if (!persist) seedStorage(win.localStorage, scenario.seed());

  const bridgePlan = scenario.network.bridge;
  const table = new BridgeFileTable(bridgePlan && bridgePlan !== 'offline' ? bridgePlan.files : workspaceFiles());
  const realFetch = win.fetch.bind(win);
  const mock = createFetchMock(routesFor(scenario), realFetch);
  win.fetch = mock.fetch;
  if (bridgePlan) {
    win.WebSocket = createWebSocketPatch(win.WebSocket, table, bridgePlan !== 'offline');
  }

  const handle: ScenarioHandle = {
    name: scenario.name,
    title: scenario.title,
    seeded: !persist,
    calls: mock.calls,
    ready: false,
    afterBoot: async () => {
      const store = win.__gatesai?.store;
      if (store && scenario.afterBoot) await scenario.afterBoot(store);
      handle.ready = true;
    },
    bridgeFiles: () => table.list().map(file => ({ path: file.path, kind: file.kind })),
    sentinel: DEV_SCENARIO_SENTINEL,
  };
  win.__gatesaiScenario = handle;
  return handle;
}

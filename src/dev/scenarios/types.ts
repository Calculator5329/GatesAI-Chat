// Dev-only scenario contracts. A scenario is a named, deterministic starting
// state for the running app: what localStorage holds before the stores boot,
// and how every network seam (OpenRouter, Ollama, the bridge, Brave, image
// generation) answers while the page lives. Journeys in journeys/manifest.json
// pick one through the `?scenario=<name>` query parameter.
//
// Nothing in src/dev/ reaches a production bundle: src/main.tsx only imports
// it behind `import.meta.env.DEV`, and scripts/check-dev-bundle.mjs fails the
// build if the sentinel below ever lands in dist/.

export const DEV_SCENARIO_SENTINEL = 'GATESAI_DEV_SCENARIO_LAYER';

export type OpenRouterTurn =
  | { kind: 'text'; text: string; usage?: OpenRouterUsageFrame }
  | { kind: 'tool_call'; name: string; args: Record<string, unknown>; id?: string }
  | { kind: 'error'; status: number; message: string };

export interface OpenRouterUsageFrame {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens?: number;
  cost?: number;
}

export interface OpenRouterPlan {
  /** Consumed in order, one per chat-completions request; the last text turn repeats. */
  turns: OpenRouterTurn[];
  /** Pause between streamed frames so streaming UI is observable. */
  chunkDelayMs?: number;
  /** Characters per streamed content delta. */
  chunkSize?: number;
  /** Raw catalog rows for GET /api/v1/models; empty by default. */
  catalog?: Array<Record<string, unknown>>;
}

export interface OllamaPlan {
  models: string[];
  reply: string;
  version?: string;
}

export interface BridgeFile {
  path: string;
  name: string;
  kind: 'file' | 'dir';
  content?: string;
  mime?: string;
  size?: number;
}

export interface BridgePlan {
  files: BridgeFile[];
  workspaceRoot?: string;
  allowlist?: string[];
}

export interface BraveResult {
  title: string;
  url: string;
  text: string;
}

export interface BravePlan {
  results: BraveResult[];
}

export interface ImagePlan {
  /** Base64 payload returned as a data URL inside the OpenRouter image reply. */
  base64: string;
  mime: string;
  costUsd?: number;
}

export interface NetworkPlan {
  openrouter?: OpenRouterPlan | 'offline';
  ollama?: OllamaPlan | 'offline';
  bridge?: BridgePlan | 'offline';
  brave?: BravePlan;
  image?: ImagePlan | 'error';
}

/**
 * The slice of the dev store hook (window.__gatesai.store) a scenario may
 * touch after boot. Only what the browser build cannot learn on its own:
 * local runtime status comes from a Tauri command, so outside the desktop
 * shell a scenario states it directly, exactly as the screenshot tour does.
 */
export interface AfterBootStore {
  localRuntime?: {
    runtimes: {
      ollama: { status: string; installPath: string; lastError?: string; lastErrorKind?: string };
      comfyui: { status: string };
    };
  };
  ollama?: { refresh: () => Promise<void> };
}

export interface ScenarioDefinition {
  name: string;
  title: string;
  description: string;
  /** localStorage contents before boot: key to value (objects are JSON encoded). */
  seed: () => Record<string, unknown>;
  network: NetworkPlan;
  /** Runs once the root store has booted, with the dev store hook. */
  afterBoot?: (store: AfterBootStore) => Promise<void>;
}

export interface RecordedCall {
  route: string;
  method: string;
  url: string;
  at: number;
  body: string | null;
}

export interface MockRequest {
  url: URL;
  method: string;
  headers: Headers;
  body: string | null;
}

export interface MockRoute {
  name: string;
  matches: (req: MockRequest) => boolean;
  respond: (req: MockRequest) => Response | Promise<Response>;
}

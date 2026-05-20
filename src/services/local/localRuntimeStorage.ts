// Manages local-runtime discovery, process control, or persistence for localRuntimeStorage.
// Called by LocalRuntimeStore and menu controls; depends on bridge/system APIs and runtime ids.
// Invariant: runtime state is stored separately from detection/probe side effects.
import { DEFAULT_OLLAMA_BASE_URL } from '../llm/ollama';
import { createJsonPersistenceProvider } from '../storage/persistenceProvider';

export const DEFAULT_COMFY_BASE_URL = 'http://127.0.0.1:8188';

const KEY = 'gatesai.local.v1';

export interface RuntimePersistedState {
  installPath: string;
  managed: boolean;
  baseUrl: string;
}

export interface LocalRuntimePersistedConfig {
  ollama: RuntimePersistedState;
  comfyui: RuntimePersistedState;
  visionModel?: string;
  autoDetectComplete: boolean;
  /** Epoch ms of the last successful Auto-detect run; undefined = never. */
  autoDetectAt?: number;
}

export const DEFAULT_LOCAL_RUNTIME_CONFIG: LocalRuntimePersistedConfig = {
  ollama: { installPath: '', managed: true, baseUrl: DEFAULT_OLLAMA_BASE_URL },
  comfyui: { installPath: '', managed: true, baseUrl: DEFAULT_COMFY_BASE_URL },
  visionModel: undefined,
  autoDetectComplete: false,
  autoDetectAt: undefined,
};

export const localRuntimePersistence = createJsonPersistenceProvider<LocalRuntimePersistedConfig>({
  key: KEY,
  parse: raw => {
    const defaults = structuredCloneSafe(DEFAULT_LOCAL_RUNTIME_CONFIG);
    const parsed = raw && typeof raw === 'object' ? raw as Partial<LocalRuntimePersistedConfig> : {};
    return mergeConfig(defaults, parsed);
  },
});

export function loadLocalRuntimeConfig(): LocalRuntimePersistedConfig {
  return localRuntimePersistence.load();
}

export function saveLocalRuntimeConfig(config: LocalRuntimePersistedConfig): void {
  localRuntimePersistence.save(config);
}

function mergeConfig(base: LocalRuntimePersistedConfig, parsed: Partial<LocalRuntimePersistedConfig>): LocalRuntimePersistedConfig {
  return {
    ollama: { ...base.ollama, ...(parsed.ollama && typeof parsed.ollama === 'object' ? parsed.ollama : {}) },
    comfyui: { ...base.comfyui, ...(parsed.comfyui && typeof parsed.comfyui === 'object' ? parsed.comfyui : {}) },
    visionModel: typeof parsed.visionModel === 'string' ? parsed.visionModel : base.visionModel,
    autoDetectComplete: typeof parsed.autoDetectComplete === 'boolean' ? parsed.autoDetectComplete : base.autoDetectComplete,
    autoDetectAt: typeof parsed.autoDetectAt === 'number' && Number.isFinite(parsed.autoDetectAt) ? parsed.autoDetectAt : base.autoDetectAt,
  };
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

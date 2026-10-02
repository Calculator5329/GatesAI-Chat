// Persists LocalRuntimeStore settings: server addresses, the vision helper model and the prefer-local setting.
// Called by LocalRuntimeStore; depends on core/localUrls for address normalization.
// Invariant: reachability is never persisted; every launch probes again.
import { isRecord } from '../../core/guards';
import {
  DEFAULT_COMFY_BASE_URL,
  DEFAULT_OLLAMA_BASE_URL,
  normalizeComfyBaseUrl,
  normalizeOllamaBaseUrl,
} from '../../core/localUrls';
import { createJsonPersistenceProvider } from '../storage/persistenceProvider';

const KEY = 'gatesai.local.v1';

export interface RuntimePersistedState {
  baseUrl: string;
}

export interface LocalRuntimePersistedConfig {
  ollama: RuntimePersistedState;
  comfyui: RuntimePersistedState;
  visionModel?: string;
  /** New chats start on a local model when one is available. Configs saved before this setting existed read as on. */
  preferLocalModels: boolean;
}

export const DEFAULT_LOCAL_RUNTIME_CONFIG: LocalRuntimePersistedConfig = {
  ollama: { baseUrl: DEFAULT_OLLAMA_BASE_URL },
  comfyui: { baseUrl: DEFAULT_COMFY_BASE_URL },
  visionModel: undefined,
  preferLocalModels: true,
};

/**
 * Reads any earlier shape of `gatesai.local.v1`. Fields from the retired
 * process-manager era (installPath, managed, autoDetect*) are dropped on the
 * next save.
 */
export function parseLocalRuntimeConfig(raw: unknown): LocalRuntimePersistedConfig {
  const parsed = isRecord(raw) ? raw : {};
  return {
    ollama: { baseUrl: normalizeOllamaBaseUrl(persistedBaseUrl(parsed.ollama)) },
    comfyui: { baseUrl: normalizeComfyBaseUrl(persistedBaseUrl(parsed.comfyui)) },
    visionModel: typeof parsed.visionModel === 'string' && parsed.visionModel ? parsed.visionModel : undefined,
    preferLocalModels: typeof parsed.preferLocalModels === 'boolean'
      ? parsed.preferLocalModels
      : DEFAULT_LOCAL_RUNTIME_CONFIG.preferLocalModels,
  };
}

export const localRuntimePersistence = createJsonPersistenceProvider<LocalRuntimePersistedConfig>({
  key: KEY,
  parse: parseLocalRuntimeConfig,
});

export function loadLocalRuntimeConfig(): LocalRuntimePersistedConfig {
  return localRuntimePersistence.load();
}

export function saveLocalRuntimeConfig(config: LocalRuntimePersistedConfig): void {
  localRuntimePersistence.save(config);
}

function persistedBaseUrl(runtime: unknown): string {
  return isRecord(runtime) && typeof runtime.baseUrl === 'string' ? runtime.baseUrl : '';
}

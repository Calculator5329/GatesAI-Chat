import type { LlmProvider, ProviderConfigs, ProviderId } from '../../core/llm';
import type { Model } from '../../core/types';
import { OpenRouterProvider } from './openrouter';
import { OllamaProvider, DEFAULT_OLLAMA_BASE_URL } from './ollama';
import { LocalImageProvider } from './localImage';

/**
 * Thrown by `LlmRouter.resolve` when no provider is ready to handle the
 * requested model and no OpenRouter fallback is configured. Callers (notably
 * `ChatStore.runTurn`) catch this and surface it via `lastError`, which the
 * UI renders as the API-key banner.
 */
export class NoProviderConfiguredError extends Error {
  constructor() {
    super('No API provider configured. Add an API key in Settings → API.');
    this.name = 'NoProviderConfiguredError';
  }
}

/**
 * Builds a provider instance from the user's configs.
 */
export function buildProviders(configs: ProviderConfigs): Record<ProviderId, LlmProvider> {
  return {
    openrouter: new OpenRouterProvider(configs.openrouter?.apiKey),
    ollama:     new OllamaProvider({
      baseUrl: configs.ollama?.baseUrl ?? DEFAULT_OLLAMA_BASE_URL,
      apiKey: configs.ollama?.apiKey,
      toolsEnabled: configs.ollama?.toolsEnabled !== false,
    }),
    'local-image': new LocalImageProvider(),
  };
}

export interface ModelCatalog {
  readonly all: Model[];
  findById(id: string): Model | undefined;
}

export class LlmRouter {
  private providers: Record<ProviderId, LlmProvider>;
  private readonly registry: ModelCatalog;

  constructor(registry: ModelCatalog, configs: ProviderConfigs = {}) {
    this.registry = registry;
    this.providers = buildProviders(configs);
  }

  /** Hot-swap configs (e.g. when the user pastes a new key). */
  updateConfigs(configs: ProviderConfigs): void {
    this.providers = buildProviders(configs);
  }

  setDefaultProvider(_value: 'direct' | 'openrouter'): void {
    // Kept as a no-op so old store wiring and persisted routing settings do
    // not matter in the simplified OpenRouter-first foundation.
  }

  /**
   * Whether any provider is configured by the user. OpenRouter counts when it
   * has an API key; Ollama counts only after a catalog refresh proves at least
   * one local model is reachable.
   *
   * When false, the UI must prevent sending — there's nothing real to route to.
   */
  canRoute(): boolean {
    for (const [id, provider] of Object.entries(this.providers)) {
      if (id === 'ollama') {
        // Ollama is "configured" only when at least one model is in the
        // registry — which proves the user has reached the server and
        // refreshed the catalog. Just having a default baseUrl isn't enough.
        if (this.registry.all.some(m => m.providerId === 'ollama')) return true;
        continue;
      }
      if (provider.ready()) return true;
    }
    return false;
  }

  /**
   * Throws `NoProviderConfiguredError` if neither path is available.
   */
  resolve(modelId: string): { provider: LlmProvider; providerModelId: string } {
    const model = this.registry.findById(modelId);
    if (!model) {
      throw new NoProviderConfiguredError();
    }

    const direct = this.providers[model.providerId];
    if (direct.ready()) {
      return { provider: direct, providerModelId: model.providerModelId };
    }

    throw new NoProviderConfiguredError();
  }

  get(providerId: ProviderId): LlmProvider {
    return this.providers[providerId];
  }

  /**
   * Direct-provider fallback is retired in the foundation build.
   */
  resolveOpenRouterFallback(_modelId: string): { provider: LlmProvider; providerModelId: string } | null {
    return null;
  }
}

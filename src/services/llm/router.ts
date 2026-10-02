// Implements LLM provider plumbing for router.
// Called by RouterStore/ChatStore through the LlmProvider interface; depends on core LLM messages, SSE/JSON parsing, and provider configs.
// Invariant: providers stream normalized LlmChunk events and do not mutate chat state.
import type { LlmProvider, ProviderConfigs, ProviderId } from '../../core/llm';
import type { Model } from '../../core/types';
import { missingLocalModelMessage, OLLAMA_MODEL_ID_PREFIX } from '../../core/localModelMeta';
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
    super('No API provider configured. Add an OpenRouter key in Models.');
    this.name = 'NoProviderConfiguredError';
  }
}

/**
 * Thrown by `LlmRouter.resolve` for an Ollama model the configured Ollama
 * cannot serve: it is down, or no longer lists the model. Its message names
 * the model and the address, so a regenerate or scheduled task explains
 * itself instead of asking for an OpenRouter key.
 */
export class LocalModelUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalModelUnavailableError';
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
      available: configs.ollama?.available,
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
  private ollamaBaseUrl: string;
  private readonly registry: ModelCatalog;

  constructor(registry: ModelCatalog, configs: ProviderConfigs = {}) {
    this.registry = registry;
    this.providers = buildProviders(configs);
    this.ollamaBaseUrl = configs.ollama?.baseUrl ?? DEFAULT_OLLAMA_BASE_URL;
  }

  /** Hot-swap configs (e.g. when the user pastes a new key). */
  updateConfigs(configs: ProviderConfigs): void {
    this.providers = buildProviders(configs);
    this.ollamaBaseUrl = configs.ollama?.baseUrl ?? DEFAULT_OLLAMA_BASE_URL;
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
        if (provider.ready() && this.registry.all.some(m => m.providerId === 'ollama')) return true;
        continue;
      }
      if (provider.ready()) return true;
    }
    return false;
  }

  /**
   * Throws `LocalModelUnavailableError` for an Ollama model that cannot run
   * right now, and `NoProviderConfiguredError` for anything else unroutable.
   */
  resolve(modelId: string): { provider: LlmProvider; providerModelId: string } {
    const model = this.registry.findById(modelId);
    if (!model) {
      if (modelId.startsWith(OLLAMA_MODEL_ID_PREFIX)) throw this.localModelUnavailable(modelId.slice(OLLAMA_MODEL_ID_PREFIX.length));
      throw new NoProviderConfiguredError();
    }

    const direct = this.providers[model.providerId];
    if (direct.ready()) {
      return { provider: direct, providerModelId: model.providerModelId };
    }

    if (model.providerId === 'ollama') throw this.localModelUnavailable(model.providerModelId);
    throw new NoProviderConfiguredError();
  }

  private localModelUnavailable(tag: string): LocalModelUnavailableError {
    return new LocalModelUnavailableError(this.providers.ollama.ready()
      ? missingLocalModelMessage(tag, this.ollamaBaseUrl)
      : `The Ollama at ${this.ollamaBaseUrl} is not answering, so ${tag} cannot run. Start Ollama, or pick another model for this chat.`);
  }

  get(providerId: ProviderId): LlmProvider {
    return this.providers[providerId];
  }
}

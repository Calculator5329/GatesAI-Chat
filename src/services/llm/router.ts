import type { LlmProvider, ProviderConfigs, ProviderId } from '../../core/llm';
import type { Model } from '../../core/types';
import { OpenAiProvider } from './openai';
import { GroqProvider } from './groq';
import { OpenRouterProvider } from './openrouter';
import { LocalProvider } from './local';
import { AnthropicProvider } from './anthropic';
import { GeminiProvider } from './gemini';
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
    openai:     new OpenAiProvider(configs.openai?.apiKey),
    anthropic:  new AnthropicProvider(configs.anthropic?.apiKey),
    gemini:     new GeminiProvider(configs.gemini?.apiKey),
    groq:       new GroqProvider(configs.groq?.apiKey),
    local:      new LocalProvider(configs.local?.baseUrl, configs.local?.apiKey),
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
  private configs: ProviderConfigs;
  private readonly registry: ModelCatalog;

  constructor(registry: ModelCatalog, configs: ProviderConfigs = {}) {
    this.registry = registry;
    this.configs = configs;
    this.providers = buildProviders(configs);
  }

  /** Hot-swap configs (e.g. when the user pastes a new key). */
  updateConfigs(configs: ProviderConfigs): void {
    this.configs = configs;
    this.providers = buildProviders(configs);
  }

  /**
   * Whether any provider is configured by the user. This does NOT
   * just check `provider.ready()` — `LocalProvider` is "ready" with a default
   * baseUrl baked in, but we treat local as configured only when the user has
   * explicitly set their own baseUrl. Other providers count as configured iff
   * they have an API key.
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
      if (id === 'local') {
        if (this.configs[id]?.baseUrl) return true;
        continue;
      }
      if (provider.ready()) return true;
    }
    return false;
  }

  /**
   * Resolve the right provider for a model id. The chain is:
   *   1. Direct provider for the model, if it has a key.
   *   2. OpenRouter, if the user has an OR key and we can map this model to
   *      an OR slug (covers the BYOK-only-OpenRouter case — they pick Claude
   *      direct, we transparently route through OR).
   *
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

    if (model.providerId !== 'openrouter' && model.providerId !== 'local' && model.providerId !== 'ollama') {
      const orSlug = this.findOpenRouterSlugFor(model.providerId, model.providerModelId);
      const or = this.providers.openrouter;
      if (orSlug && or.ready()) {
        return { provider: or, providerModelId: orSlug };
      }
    }

    throw new NoProviderConfiguredError();
  }

  /**
   * Look up an OpenRouter slug that points at the same underlying model. The
   * resolution order is:
   *
   *   1. Exact registry match on `<vendor>/<providerModelId>` — picked up
   *      from either a curated `or-*` entry or a dynamic catalog hit, so
   *      live pricing / context follow when available.
   *   2. Tail-normalized registry match (handles `.` ↔ `-` and `:beta`
   *      variants — e.g. `claude-sonnet-4.6` ↔ `claude-sonnet-4-6`).
   *   3. Constructed slug `<vendor>/<providerModelId>` as a best-effort
   *      fallback. This covers the cold-cache case where the user has
   *      never refreshed the OpenRouter catalog and there's no curated
   *      entry — OR may still accept the slug, and if it doesn't, the
   *      error surfaces normally. Constructing rather than skipping keeps
   *      every direct-provider model fallback-eligible.
   */
  private findOpenRouterSlugFor(providerId: ProviderId, providerModelId: string): string | null {
    const expectedPrefix = OR_VENDOR_PREFIX[providerId];
    if (!expectedPrefix) return null;
    const wanted = `${expectedPrefix}/${providerModelId}`;
    const wantedNormalized = providerModelId.replace(/\./g, '-');
    for (const m of this.registry.all) {
      if (m.providerId !== 'openrouter') continue;
      if (m.providerModelId === wanted) return m.providerModelId;
      if (m.providerModelId.startsWith(`${expectedPrefix}/`)
          && m.providerModelId.split('/')[1].split(':')[0].replace(/\./g, '-') === wantedNormalized) {
        return m.providerModelId;
      }
    }
    return wanted;
  }

  get(providerId: ProviderId): LlmProvider {
    return this.providers[providerId];
  }

  /**
   * Resolve an OpenRouter fallback for the given model id, even when the
   * direct provider has a key. Returns null if there is no OR slug or the
   * OR provider isn't configured. Used by `ChatStore` for runtime retry
   * when a direct call errors out before producing any text.
   */
  resolveOpenRouterFallback(modelId: string): { provider: LlmProvider; providerModelId: string } | null {
    const model = this.registry.findById(modelId);
    if (!model) return null;
    if (model.providerId === 'openrouter' || model.providerId === 'local' || model.providerId === 'ollama') return null;
    const or = this.providers.openrouter;
    if (!or.ready()) return null;
    const slug = this.findOpenRouterSlugFor(model.providerId, model.providerModelId);
    if (!slug) return null;
    return { provider: or, providerModelId: slug };
  }
}

/** Direct provider id → OpenRouter vendor prefix used in `<vendor>/<model>`. */
const OR_VENDOR_PREFIX: Partial<Record<ProviderId, string>> = {
  anthropic: 'anthropic',
  openai: 'openai',
  gemini: 'google',
  groq: 'groq',
};

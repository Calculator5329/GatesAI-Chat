import type { LlmProvider, ProviderConfigs, ProviderId } from '../../core/llm';
import type { Model } from '../../core/types';
import { FakeProvider } from './fake';
import { OpenAiProvider } from './openai';
import { GroqProvider } from './groq';
import { OpenRouterProvider } from './openrouter';
import { LocalProvider } from './local';
import { AnthropicProvider } from './anthropic';
import { GeminiProvider } from './gemini';

/**
 * Builds a provider instance from the user's configs. The fake provider is
 * always created (used for offline dev and as a "no key set" fallback).
 */
export function buildProviders(configs: ProviderConfigs): Record<ProviderId, LlmProvider> {
  return {
    fake:       new FakeProvider(),
    openrouter: new OpenRouterProvider(configs.openrouter?.apiKey),
    openai:     new OpenAiProvider(configs.openai?.apiKey),
    anthropic:  new AnthropicProvider(configs.anthropic?.apiKey),
    gemini:     new GeminiProvider(configs.gemini?.apiKey),
    groq:       new GroqProvider(configs.groq?.apiKey),
    local:      new LocalProvider(configs.local?.baseUrl, configs.local?.apiKey),
  };
}

export interface RouterOptions {
  /** When true, fall back to the fake provider if the model's provider isn't ready. */
  fallbackToFake?: boolean;
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
   * Whether any non-fake provider is configured by the user. This does NOT
   * just check `provider.ready()` — `LocalProvider` is "ready" with a default
   * baseUrl baked in, but we treat local as configured only when the user has
   * explicitly set their own baseUrl. Other providers count as configured iff
   * they have an API key.
   *
   * When false, the UI must prevent sending — there's nothing real to route
   * to and we no longer fall back to the fake provider.
   */
  canRoute(): boolean {
    for (const [id, provider] of Object.entries(this.providers)) {
      if (id === 'fake') continue;
      if (id === 'local') {
        if (this.configs.local?.baseUrl) return true;
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
   *   3. Fake provider with a friendly canned response (offline mode).
   */
  resolve(modelId: string, opts: RouterOptions = {}): { provider: LlmProvider; providerModelId: string } {
    const { fallbackToFake = true } = opts;
    const model = this.registry.findById(modelId);
    if (!model) {
      return { provider: this.providers.fake, providerModelId: modelId };
    }

    const direct = this.providers[model.providerId];
    if (direct.ready()) {
      return { provider: direct, providerModelId: model.providerModelId };
    }

    if (model.providerId !== 'openrouter' && model.providerId !== 'local' && model.providerId !== 'fake') {
      const orSlug = this.findOpenRouterSlugFor(model.providerId, model.providerModelId);
      const or = this.providers.openrouter;
      if (orSlug && or.ready()) {
        return { provider: or, providerModelId: orSlug };
      }
    }

    if (fallbackToFake) {
      return { provider: this.providers.fake, providerModelId: model.providerModelId };
    }
    return { provider: direct, providerModelId: model.providerModelId };
  }

  /**
   * Look up an OpenRouter slug that points at the same underlying model. We
   * prefer a dynamic catalog hit (`<vendor>/<id>`) so live pricing/context
   * follow, then fall back to a curated `or-*` entry.
   */
  private findOpenRouterSlugFor(providerId: ProviderId, providerModelId: string): string | null {
    const expectedPrefix = OR_VENDOR_PREFIX[providerId];
    if (!expectedPrefix) return null;
    const wanted = `${expectedPrefix}/${providerModelId}`;
    for (const m of this.registry.all) {
      if (m.providerId !== 'openrouter') continue;
      if (m.providerModelId === wanted) return m.providerModelId;
      // OpenRouter sometimes uses normalized ids (e.g. `claude-sonnet-4.6` →
      // `claude-sonnet-4-6` or `claude-sonnet-4.6:beta`). Match on the tail.
      if (m.providerModelId.startsWith(`${expectedPrefix}/`)
          && m.providerModelId.split('/')[1].split(':')[0].replace(/\./g, '-') === providerModelId.replace(/\./g, '-')) {
        return m.providerModelId;
      }
    }
    return null;
  }

  get(providerId: ProviderId): LlmProvider {
    return this.providers[providerId];
  }
}

/** Direct provider id → OpenRouter vendor prefix used in `<vendor>/<model>`. */
const OR_VENDOR_PREFIX: Partial<Record<ProviderId, string>> = {
  anthropic: 'anthropic',
  openai: 'openai',
  gemini: 'google',
  groq: 'groq',
};

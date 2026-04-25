import { autorun, makeAutoObservable, toJS } from 'mobx';
import type { ProviderConfig, ProviderConfigs, ProviderId } from '../core/llm';
import { LlmRouter } from '../services/llm';
import { loadProviderConfigs, saveProviderConfigs } from '../services/providerStorage';
import type { ModelRegistry } from './ModelRegistry';

/**
 * Owns provider credentials (API keys, base URLs) and the LLM router that
 * dispatches requests. Persisted under `gatesai.providers.v1` separately
 * from chat data — keys are sensitive and shouldn't leak into exports.
 */
export class ProviderStore {
  configs: ProviderConfigs = {};
  readonly router: LlmRouter;

  constructor(registry: ModelRegistry) {
    this.configs = loadProviderConfigs();
    this.router = new LlmRouter(registry, this.configs);
    makeAutoObservable<this, 'router'>(this, { router: false });

    autorun(() => {
      const snap = toJS(this.configs);
      saveProviderConfigs(snap);
      this.router.updateConfigs(snap);
    });
  }

  getConfig(id: ProviderId): ProviderConfig {
    return this.configs[id] ?? {};
  }

  setKey(id: ProviderId, apiKey: string): void {
    const trimmed = apiKey.trim();
    const current = this.configs[id] ?? {};
    if (!trimmed) {
      const { apiKey: _, ...rest } = current;
      if (Object.keys(rest).length === 0) delete this.configs[id];
      else this.configs[id] = rest;
    } else {
      this.configs[id] = { ...current, apiKey: trimmed };
    }
  }

  setBaseUrl(id: ProviderId, baseUrl: string): void {
    const trimmed = baseUrl.trim();
    const current = this.configs[id] ?? {};
    if (!trimmed) {
      const { baseUrl: _, ...rest } = current;
      if (Object.keys(rest).length === 0) delete this.configs[id];
      else this.configs[id] = rest;
    } else {
      this.configs[id] = { ...current, baseUrl: trimmed };
    }
  }

  remove(id: ProviderId): void {
    delete this.configs[id];
  }

  isConnected(id: ProviderId): boolean {
    return this.router.get(id).ready();
  }

  /**
   * True iff at least one real provider is configured (has a key, or for
   * local, an explicit baseUrl). Backed by `LlmRouter.canRoute()`. The UI
   * uses this to gate sending — when false, there's no real backend to talk
   * to.
   */
  get hasUsableProvider(): boolean {
    // Touch configs and its keys so MobX tracks this getter as depending on
    // mutations to configs. The canonical authority is router.canRoute(), but
    // the router's mirror of configs is plain (non-observable) — kept in
    // sync by the autorun in this constructor. Reading just `this.configs`
    // would only subscribe to reassignment of the configs property itself;
    // we add/remove inner keys (`configs[id] = …`), so we must also subscribe
    // to the key set of the inner object. Without this, observer components
    // subscribed to hasUsableProvider would not re-render when the user adds
    // a key. The `void` reads are intentional — JS evaluators don't elide
    // side-effecting Proxy access — and they document the why.
    void this.configs;
    void Object.keys(this.configs).length;
    return this.router.canRoute();
  }
}

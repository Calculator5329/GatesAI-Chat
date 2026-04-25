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
}

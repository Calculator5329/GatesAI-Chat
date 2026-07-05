import { makeAutoObservable, runInAction } from 'mobx';
import type { Model } from '../core/types';
import {
  DEFAULT_OPENAI_COMPAT_LABEL,
  fetchOpenAiCompatModels,
  isBlockedHttpRemoteEndpoint,
  normalizeOpenAiCompatBaseUrl,
} from '../services/llm/openaiCompatCatalog';
import { logger } from '../services/diagnostics/logger';
import type { ModelRegistry } from './ModelRegistry';
import type { ProviderStore } from './ProviderStore';

const PROVIDER_ID = 'openai-compat' as const;

export class OpenAiCompatEndpointStore {
  fetching = false;
  lastProbeAt: number | null = null;
  lastError: string | null = null;

  private readonly registry: ModelRegistry;
  private readonly providers: ProviderStore;
  private inflight: AbortController | null = null;

  constructor(registry: ModelRegistry, providers: ProviderStore) {
    this.registry = registry;
    this.providers = providers;
    makeAutoObservable<this, 'registry' | 'providers' | 'inflight'>(this, {
      registry: false,
      providers: false,
      inflight: false,
    });
  }

  get baseUrl(): string {
    return this.providers.getConfig(PROVIDER_ID).baseUrl ?? '';
  }

  get apiKey(): string {
    return this.providers.getConfig(PROVIDER_ID).apiKey ?? '';
  }

  get label(): string {
    return this.providers.getConfig(PROVIDER_ID).label ?? DEFAULT_OPENAI_COMPAT_LABEL;
  }

  get available(): boolean {
    return this.providers.getConfig(PROVIDER_ID).available === true;
  }

  get models(): Model[] {
    return this.registry.dynamicForProvider(PROVIDER_ID);
  }

  get count(): number {
    return this.models.length;
  }

  setBaseUrl(raw: string): void {
    this.providers.setBaseUrl(PROVIDER_ID, raw);
    this.markUnprobed();
  }

  setKey(key: string): void {
    this.providers.setKey(PROVIDER_ID, key);
    this.markUnprobed();
  }

  setLabel(label: string): void {
    this.providers.setLabel(PROVIDER_ID, label);
    if (this.models.length) {
      this.registry.setDynamicForProvider(PROVIDER_ID, this.models.map(model => ({
        ...model,
        vendor: this.label,
      })));
    }
  }

  async test(): Promise<boolean> {
    if (this.inflight) this.inflight.abort();
    const baseUrl = normalizeOpenAiCompatBaseUrl(this.baseUrl);
    if (!baseUrl) {
      this.markProbeFailed('Enter a base URL first.');
      return false;
    }
    if (isBlockedHttpRemoteEndpoint(baseUrl)) {
      this.markProbeFailed('http endpoints must be localhost; use https for remote');
      return false;
    }

    this.providers.setBaseUrl(PROVIDER_ID, baseUrl);
    const controller = new AbortController();
    this.inflight = controller;
    runInAction(() => {
      this.fetching = true;
      this.lastError = null;
    });

    try {
      const models = await fetchOpenAiCompatModels({
        baseUrl,
        apiKey: this.apiKey,
        label: this.label,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return false;
      runInAction(() => {
        this.registry.setDynamicForProvider(PROVIDER_ID, models);
        this.providers.setAvailable(PROVIDER_ID, true);
        this.lastProbeAt = Date.now();
        this.lastError = null;
        this.fetching = false;
      });
      return true;
    } catch (err) {
      if (controller.signal.aborted) return false;
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('models', 'Custom OpenAI-compatible catalog fetch failed', { err });
      runInAction(() => {
        this.markProbeFailed(message);
      });
      return false;
    } finally {
      if (this.inflight === controller) this.inflight = null;
    }
  }

  clear(): void {
    if (this.inflight) {
      this.inflight.abort();
      this.inflight = null;
    }
    this.registry.clearDynamicForProvider(PROVIDER_ID);
    this.providers.remove(PROVIDER_ID);
    this.fetching = false;
    this.lastError = null;
    this.lastProbeAt = null;
  }

  private markUnprobed(): void {
    this.providers.setAvailable(PROVIDER_ID, false);
    this.registry.clearDynamicForProvider(PROVIDER_ID);
    this.lastProbeAt = null;
    this.lastError = null;
  }

  private markProbeFailed(message: string): void {
    this.providers.setAvailable(PROVIDER_ID, false);
    this.registry.clearDynamicForProvider(PROVIDER_ID);
    this.fetching = false;
    this.lastError = message;
    this.lastProbeAt = Date.now();
  }
}

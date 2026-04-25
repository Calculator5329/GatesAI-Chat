import { makeAutoObservable, runInAction } from 'mobx';
import type { Model } from '../core/types';
import { fetchOpenRouterModels } from '../services/llm/openrouterCatalog';
import {
  clearOpenRouterCache,
  loadOpenRouterCache,
  saveOpenRouterCache,
} from '../services/openrouterCache';
import type { ModelRegistry } from './ModelRegistry';

/**
 * Owns the live OpenRouter catalog: hydration from cache on boot, manual
 * `refresh()` (no auto TTL — user-initiated only), and registry sync.
 *
 * Errors surface via `fetchError` so the UI can show them inline. We never
 * throw out of `refresh()` — the caller (a button click) doesn't want to
 * deal with promise rejection.
 */
export class OpenRouterStore {
  models: Model[] = [];
  fetchedAt: number | null = null;
  fetching = false;
  fetchError: string | null = null;

  private readonly registry: ModelRegistry;
  private inflight: AbortController | null = null;

  constructor(registry: ModelRegistry) {
    this.registry = registry;
    const cached = loadOpenRouterCache();
    if (cached) {
      this.models = cached.models;
      this.fetchedAt = cached.fetchedAt;
      this.registry.setDynamicForProvider('openrouter', cached.models);
    }
    makeAutoObservable<this, 'registry' | 'inflight'>(this, {
      registry: false,
      inflight: false,
    });
  }

  get count(): number {
    return this.models.length;
  }

  async refresh(): Promise<void> {
    if (this.inflight) this.inflight.abort();
    const controller = new AbortController();
    this.inflight = controller;
    runInAction(() => {
      this.fetching = true;
      this.fetchError = null;
    });
    try {
      const models = await fetchOpenRouterModels(controller.signal);
      if (controller.signal.aborted) return;
      const fetchedAt = Date.now();
      runInAction(() => {
        this.models = models;
        this.fetchedAt = fetchedAt;
        this.fetching = false;
        this.registry.setDynamicForProvider('openrouter', models);
      });
      saveOpenRouterCache({ fetchedAt, models });
    } catch (err) {
      if (controller.signal.aborted) return;
      runInAction(() => {
        this.fetching = false;
        this.fetchError = err instanceof Error ? err.message : String(err);
      });
    } finally {
      if (this.inflight === controller) this.inflight = null;
    }
  }

  clearCache(): void {
    if (this.inflight) {
      this.inflight.abort();
      this.inflight = null;
    }
    this.models = [];
    this.fetchedAt = null;
    this.fetchError = null;
    this.fetching = false;
    this.registry.clearDynamicForProvider('openrouter');
    clearOpenRouterCache();
  }
}

import { autorun, makeAutoObservable, runInAction, toJS } from 'mobx';
import type { Model } from '../core/types';
import { mapOllamaTagsToModels } from '../services/llm/ollamaCatalog';
import {
  loadOllamaConfig,
  saveOllamaConfig,
  type OllamaPersistedConfig,
} from '../services/ollamaStorage';
import type { ModelRegistry } from './ModelRegistry';
import type { LocalRuntimeStore } from './LocalRuntimeStore';

/**
 * Owns Ollama auth, tool-call settings, and the locally pulled model catalog.
 * LocalRuntimeStore owns the server URL; this store reads that facade at
 * request time so the URL has one source of truth.
 */
export class OllamaStore {
  config: { apiKey: string | undefined; toolsEnabled: boolean };
  catalog: Model[] = [];
  lastRefreshAt: number | null = null;
  fetching = false;
  lastError: string | undefined;

  private readonly registry: ModelRegistry;
  private readonly localRuntime: LocalRuntimeStore;
  private inflight: AbortController | null = null;

  constructor(registry: ModelRegistry, localRuntime: LocalRuntimeStore) {
    this.registry = registry;
    this.localRuntime = localRuntime;
    const persisted = loadOllamaConfig();
    this.config = {
      apiKey: persisted.apiKey,
      toolsEnabled: persisted.toolsEnabled,
    };
    this.catalog = persisted.catalog;
    this.lastRefreshAt = persisted.lastRefreshAt;
    if (this.catalog.length) registry.setDynamicForProvider('ollama', this.catalog);

    makeAutoObservable<this, 'registry' | 'localRuntime' | 'inflight'>(this, {
      registry: false,
      localRuntime: false,
      inflight: false,
    });

    autorun(() => {
      const snap: OllamaPersistedConfig = {
        apiKey: this.config.apiKey,
        toolsEnabled: this.config.toolsEnabled,
        catalog: toJS(this.catalog),
        lastRefreshAt: this.lastRefreshAt,
      };
      saveOllamaConfig(snap);
    });
  }

  get count(): number { return this.catalog.length; }

  setKey(key: string): void {
    const trimmed = key.trim();
    this.config = { ...this.config, apiKey: trimmed || undefined };
  }

  setToolsEnabled(v: boolean): void {
    this.config = { ...this.config, toolsEnabled: v };
  }

  async refresh(): Promise<void> {
    if (this.inflight) this.inflight.abort();
    const ctrl = new AbortController();
    this.inflight = ctrl;
    runInAction(() => { this.fetching = true; this.lastError = undefined; });

    try {
      const headers: Record<string, string> = {};
      if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;
      const resp = await fetch(`${this.localRuntime.ollamaBaseUrl}/api/tags`, { headers, signal: ctrl.signal });
      if (!resp.ok) throw new Error(`Ollama ${resp.status}`);
      const json = await resp.json() as unknown;
      if (ctrl.signal.aborted) return;
      const models = mapOllamaTagsToModels(json);
      runInAction(() => {
        this.catalog = models;
        this.lastRefreshAt = Date.now();
        this.fetching = false;
        this.registry.setDynamicForProvider('ollama', models);
      });
    } catch (err) {
      if (ctrl.signal.aborted) return;
      runInAction(() => {
        this.lastError = err instanceof Error ? err.message : String(err);
        this.fetching = false;
      });
    } finally {
      if (this.inflight === ctrl) this.inflight = null;
    }
  }

  clearCatalog(): void {
    if (this.inflight) { this.inflight.abort(); this.inflight = null; }
    this.catalog = [];
    this.lastRefreshAt = null;
    this.lastError = undefined;
    this.fetching = false;
    this.registry.clearDynamicForProvider('ollama');
  }
}

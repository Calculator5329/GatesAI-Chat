import { autorun, makeAutoObservable, runInAction, toJS } from 'mobx';
import type { Model } from '../core/types';
import { mapOllamaTagsToModels } from '../services/llm/ollamaCatalog';
import { DEFAULT_OLLAMA_BASE_URL } from '../services/llm/ollama';
import {
  loadOllamaConfig,
  saveOllamaConfig,
  type OllamaPersistedConfig,
} from '../services/ollamaStorage';
import type { ModelRegistry } from './ModelRegistry';

export type OllamaState = 'unknown' | 'online' | 'offline';

/**
 * Owns the Ollama base URL, optional auth, status state, and the locally-
 * pulled model catalog (fed into ModelRegistry under providerId 'ollama').
 *
 * Status polling is driven externally — the OllamaCard mounts a hook that
 * calls startStatusPoll on mount and stopStatusPoll on unmount. We don't
 * poll from the constructor because the user might not be on the API
 * panel and we don't want to spam a (possibly off) local server.
 */
export class OllamaStore {
  config: { baseUrl: string; apiKey: string | undefined; toolsEnabled: boolean };
  catalog: Model[] = [];
  lastRefreshAt: number | null = null;
  fetching = false;
  state: OllamaState = 'unknown';
  lastError: string | undefined;

  private readonly registry: ModelRegistry;
  private inflight: AbortController | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private subscribers = 0;

  constructor(registry: ModelRegistry) {
    this.registry = registry;
    const persisted = loadOllamaConfig();
    this.config = {
      baseUrl: persisted.baseUrl,
      apiKey: persisted.apiKey,
      toolsEnabled: persisted.toolsEnabled,
    };
    this.catalog = persisted.catalog;
    this.lastRefreshAt = persisted.lastRefreshAt;
    if (this.catalog.length) registry.setDynamicForProvider('ollama', this.catalog);

    makeAutoObservable<this, 'registry' | 'inflight' | 'pollTimer' | 'subscribers'>(this, {
      registry: false, inflight: false, pollTimer: false, subscribers: false,
    });

    autorun(() => {
      const snap: OllamaPersistedConfig = {
        baseUrl: this.config.baseUrl,
        apiKey: this.config.apiKey,
        toolsEnabled: this.config.toolsEnabled,
        catalog: toJS(this.catalog),
        lastRefreshAt: this.lastRefreshAt,
      };
      saveOllamaConfig(snap);
    });
  }

  get count(): number { return this.catalog.length; }

  setBaseUrl(url: string): void {
    const trimmed = url.trim().replace(/\/+$/, '');
    this.config = { ...this.config, baseUrl: trimmed || DEFAULT_OLLAMA_BASE_URL };
  }

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
      const resp = await fetch(`${this.config.baseUrl}/api/tags`, { headers, signal: ctrl.signal });
      if (!resp.ok) throw new Error(`Ollama ${resp.status}`);
      const json = await resp.json() as unknown;
      if (ctrl.signal.aborted) return;
      const models = mapOllamaTagsToModels(json);
      runInAction(() => {
        this.catalog = models;
        this.lastRefreshAt = Date.now();
        this.state = 'online';
        this.fetching = false;
        this.registry.setDynamicForProvider('ollama', models);
      });
    } catch (err) {
      if (ctrl.signal.aborted) return;
      runInAction(() => {
        this.state = 'offline';
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

  /** Ref-counted status poll. Caller pairs each start with one stop. */
  startStatusPoll(intervalMs = 30_000): void {
    this.subscribers++;
    if (this.pollTimer) return;
    void this.refresh();
    this.pollTimer = setInterval(() => { void this.refresh(); }, intervalMs);
  }

  stopStatusPoll(): void {
    if (this.subscribers > 0) {
      this.subscribers--;
    } else {
      console.warn('[OllamaStore] stopStatusPoll called without a matching start — likely an effect-cleanup mismatch');
    }
    if (this.subscribers === 0 && this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}

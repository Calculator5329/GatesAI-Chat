// Owns observable OllamaStore state and actions for the app runtime.
// Called by RootStore, React context hooks, and service callbacks; depends on services/core contracts.
// Invariant: mutations happen through store actions so UI derivations stay consistent.
import { autorun, makeAutoObservable, reaction, runInAction, toJS } from 'mobx';
import type { Model } from '../core/types';
import { mapOllamaTagsToModels } from '../services/llm/ollamaCatalog';
import {
  loadOllamaConfig,
  saveOllamaConfig,
  type OllamaPersistedConfig,
} from '../services/ollamaStorage';
import type { ModelRegistry } from './ModelRegistry';
import type { LocalRuntimeStore } from './LocalRuntimeStore';
import { logger } from '../services/diagnostics/logger';
import { deleteSecret, SECRET_NAMES, setSecret, usesTauriSecretBackend } from '../services/secretStorage';

interface OllamaStoreOptions {
  autoPersist?: boolean;
  useKeychainSecrets?: boolean;
}

/**
 * Owns Ollama auth, tool-call settings, and the locally pulled model catalog.
 * LocalRuntimeStore owns the server URL; this store reads that facade at
 * request time so the URL has one source of truth.
 */
export class OllamaStore {
  config: { apiKey: string | undefined; toolsEnabled: boolean };
  lastRefreshAt: number | null = null;
  fetching = false;
  lastError: string | undefined;

  private readonly registry: ModelRegistry;
  private readonly localRuntime: LocalRuntimeStore;
  private readonly useKeychainSecrets: boolean;
  private inflight: AbortController | null = null;
  private configPersistenceDisposer: (() => void) | null = null;
  private secretPersistenceDisposer: (() => void) | null = null;

  constructor(registry: ModelRegistry, localRuntime: LocalRuntimeStore, options: OllamaStoreOptions = {}) {
    this.registry = registry;
    this.localRuntime = localRuntime;
    this.useKeychainSecrets = options.useKeychainSecrets ?? usesTauriSecretBackend();
    const persisted = loadOllamaConfig();
    this.config = {
      apiKey: persisted.apiKey,
      toolsEnabled: persisted.toolsEnabled,
    };
    this.lastRefreshAt = persisted.lastRefreshAt;
    if (persisted.catalog.length) registry.setDynamicForProvider('ollama', persisted.catalog);

    makeAutoObservable<this,
      'registry'
      | 'localRuntime'
      | 'useKeychainSecrets'
      | 'inflight'
      | 'configPersistenceDisposer'
      | 'secretPersistenceDisposer'
    >(this, {
      registry: false,
      localRuntime: false,
      useKeychainSecrets: false,
      inflight: false,
      configPersistenceDisposer: false,
      secretPersistenceDisposer: false,
    });

    if (options.autoPersist ?? true) this.startPersistence();
  }

  startPersistence(): void {
    if (this.configPersistenceDisposer || this.secretPersistenceDisposer) return;
    this.configPersistenceDisposer = autorun(() => {
      const snap: OllamaPersistedConfig = {
        apiKey: this.config.apiKey,
        toolsEnabled: this.config.toolsEnabled,
        catalog: toJS(this.catalog),
        lastRefreshAt: this.lastRefreshAt,
      };
      saveOllamaConfig(ollamaConfigForLocalPersistence(snap, this.useKeychainSecrets));
    });
    this.secretPersistenceDisposer = reaction(
      () => this.config.apiKey ?? '',
      apiKey => persistSecretValue(SECRET_NAMES.ollamaApiKey, apiKey, 'Ollama API key'),
      { fireImmediately: false },
    );
  }

  dispose(): void {
    this.secretPersistenceDisposer?.();
    this.configPersistenceDisposer?.();
    this.secretPersistenceDisposer = null;
    this.configPersistenceDisposer = null;
  }

  hydrateApiKey(apiKey: string | null | undefined): void {
    this.setKey(apiKey ?? '');
  }

  get count(): number { return this.catalog.length; }
  get online(): boolean { return this.localRuntime.runtimes.ollama.status === 'online'; }
  get catalog(): Model[] {
    return this.registry.dynamicForProvider('ollama');
  }

  set catalog(models: Model[]) {
    this.registry.setDynamicForProvider('ollama', models);
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
      const json = await this.localRuntime.fetchOllamaTags(this.config.apiKey);
      if (ctrl.signal.aborted) return;
      const models = mapOllamaTagsToModels(json);
      runInAction(() => {
        this.catalog = models;
        this.lastRefreshAt = Date.now();
        this.fetching = false;
      });
    } catch (err) {
      if (ctrl.signal.aborted) return;
      logger.warn('models', 'Ollama catalog fetch failed', { err });
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
    this.catalog = [];
  }
}

function ollamaConfigForLocalPersistence(
  config: OllamaPersistedConfig,
  stripSecrets: boolean,
): OllamaPersistedConfig {
  if (!stripSecrets) return config;
  return { ...config, apiKey: undefined };
}

function persistSecretValue(name: string, value: string, label: string): void {
  const op = value ? setSecret(name, value) : deleteSecret(name);
  void op.catch(err => logger.warn('persistence', `${label} persistence failed`, { err }));
}

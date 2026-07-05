// Owns observable OllamaStore state and actions for the app runtime.
// Called by RootStore, React context hooks, and service callbacks; depends on services/core contracts.
// Invariant: mutations happen through store actions so UI derivations stay consistent.
import { autorun, makeAutoObservable, reaction, runInAction, toJS } from 'mobx';
import type { Model } from '../core/types';
import { extractOllamaTagNames, mapOllamaTagsToModels } from '../services/llm/ollamaCatalog';
import {
  loadOllamaConfig,
  saveOllamaConfig,
  type OllamaPersistedConfig,
} from '../services/ollamaStorage';
import type { ModelRegistry } from './ModelRegistry';
import type { LocalRuntimeStore } from './LocalRuntimeStore';
import { logger } from '../services/diagnostics/logger';
import { deleteSecret, SECRET_NAMES, setSecret, usesTauriSecretBackend } from '../services/secretStorage';
import { deleteModel, pullModel } from '../services/llm/ollamaPull';

interface OllamaStoreOptions {
  autoPersist?: boolean;
  useKeychainSecrets?: boolean;
}

export interface OllamaPullState {
  percent: number;
  phase: string;
  error?: string;
}

/**
 * Owns Ollama auth, tool-call settings, and the locally pulled model catalog.
 * LocalRuntimeStore owns the server URL; this store reads that facade at
 * request time so the URL has one source of truth.
 */
export class OllamaStore {
  config: { apiKey: string | undefined; toolsEnabled: boolean };
  tagNames: string[] = [];
  lastRefreshAt: number | null = null;
  fetching = false;
  lastError: string | undefined;
  pulls = new Map<string, OllamaPullState>();

  private readonly registry: ModelRegistry;
  private readonly localRuntime: LocalRuntimeStore;
  private readonly useKeychainSecrets: boolean;
  private inflight: AbortController | null = null;
  private activePull: { model: string; controller: AbortController } | null = null;
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
    this.tagNames = persisted.tagNames;
    this.lastRefreshAt = persisted.lastRefreshAt;
    if (persisted.catalog.length) registry.setDynamicForProvider('ollama', persisted.catalog);

    makeAutoObservable<this,
      'registry'
      | 'localRuntime'
      | 'useKeychainSecrets'
      | 'inflight'
      | 'activePull'
      | 'configPersistenceDisposer'
      | 'secretPersistenceDisposer'
    >(this, {
      registry: false,
      localRuntime: false,
      useKeychainSecrets: false,
      inflight: false,
      activePull: false,
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
        tagNames: toJS(this.tagNames),
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
  get activePullModel(): string | null { return this.activePull?.model ?? null; }
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

  hasTagStartingWith(prefix: string): boolean {
    const p = prefix.trim();
    if (!p) return false;
    return this.tagNames.some(name => name.startsWith(p));
  }

  hasModelTag(model: string): boolean {
    const name = model.trim();
    if (!name) return false;
    return this.tagNames.some(tag => tag === name || (!name.includes(':') && tag.startsWith(`${name}:`)));
  }

  isPulling(model: string): boolean {
    return this.activePull?.model === model.trim();
  }

  async startPull(model: string): Promise<boolean> {
    const name = model.trim();
    if (!name) return false;
    const guard = this.pullGuardMessage(name);
    if (guard) {
      this.pulls.set(name, { percent: this.pulls.get(name)?.percent ?? 0, phase: 'Not started', error: guard });
      return false;
    }

    const controller = new AbortController();
    this.activePull = { model: name, controller };
    this.pulls.set(name, { percent: 0, phase: 'Starting pull' });

    try {
      await pullModel(name, {
        baseUrl: this.localRuntime.ollamaBaseUrl,
        apiKey: this.config.apiKey,
        onProgress: progress => {
          runInAction(() => {
            const existing = this.pulls.get(name);
            this.pulls.set(name, {
              percent: Math.max(existing?.percent ?? 0, progress.percent),
              phase: progress.phase,
            });
          });
        },
      }, controller.signal);
      if (controller.signal.aborted) {
        runInAction(() => {
          const existing = this.pulls.get(name);
          this.pulls.set(name, { percent: existing?.percent ?? 0, phase: 'Cancelled', error: 'Pull cancelled.' });
        });
        return false;
      }
      runInAction(() => {
        this.pulls.set(name, { percent: 100, phase: 'Installed' });
      });
      await this.refresh();
      return true;
    } catch (err) {
      const aborted = controller.signal.aborted || (err instanceof Error && err.name === 'AbortError');
      const message = aborted ? 'Pull cancelled.' : err instanceof Error ? err.message : String(err);
      logger.warn('models', 'Ollama pull failed', { model: name, err });
      runInAction(() => {
        const existing = this.pulls.get(name);
        this.pulls.set(name, {
          percent: existing?.percent ?? 0,
          phase: aborted ? 'Cancelled' : 'Failed',
          error: message,
        });
      });
      return false;
    } finally {
      if (this.activePull?.controller === controller) this.activePull = null;
    }
  }

  cancelPull(model?: string): void {
    const target = model?.trim();
    if (!this.activePull) return;
    if (target && this.activePull.model !== target) return;
    this.activePull.controller.abort();
  }

  async deleteModel(model: string): Promise<boolean> {
    const name = model.trim();
    if (!name) return false;
    try {
      await deleteModel(name, {
        baseUrl: this.localRuntime.ollamaBaseUrl,
        apiKey: this.config.apiKey,
      });
      this.pulls.delete(name);
      await this.refresh();
      return true;
    } catch (err) {
      logger.warn('models', 'Ollama delete failed', { model: name, err });
      this.pulls.set(name, {
        percent: this.pulls.get(name)?.percent ?? 0,
        phase: 'Delete failed',
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  async refresh(): Promise<void> {
    if (this.inflight) this.inflight.abort();
    const ctrl = new AbortController();
    this.inflight = ctrl;
    runInAction(() => { this.fetching = true; this.lastError = undefined; });

    try {
      const json = await this.localRuntime.fetchOllamaTags(this.config.apiKey);
      if (ctrl.signal.aborted) return;
      const tagNames = extractOllamaTagNames(json);
      const models = mapOllamaTagsToModels(json);
      runInAction(() => {
        this.tagNames = tagNames;
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
    if (this.activePull) { this.activePull.controller.abort(); this.activePull = null; }
    this.catalog = [];
    this.tagNames = [];
    this.lastRefreshAt = null;
    this.lastError = undefined;
    this.fetching = false;
    this.catalog = [];
  }

  private pullGuardMessage(model: string): string | null {
    if (!this.online) return 'Start Ollama first.';
    if (this.hasModelTag(model)) return `${model} is already installed.`;
    if (this.activePull?.model === model) return `${model} is already pulling.`;
    if (this.activePull) return `Finish or cancel ${this.activePull.model} before pulling another model.`;
    return null;
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

// Owns observable OllamaStore state and actions for the app runtime.
// Called by RootStore, React context hooks, and service callbacks; depends on services/core contracts.
// Invariant: mutations happen through store actions so UI derivations stay consistent.
import { autorun, comparer, makeAutoObservable, reaction, runInAction, toJS } from 'mobx';
import type { Model } from '../core/types';
import { extractOllamaTagDigests, extractOllamaTagNames, mapOllamaTagsToModels, parseOllamaRunningWindows } from '../services/llm/ollamaCatalog';
import { isOllamaCloudModel, ollamaCloudContextLength, type OllamaCatalogModel } from '../core/localModelMeta';
import { resolveModelFormatProfile } from '../services/llm/modelFormatProfiles';
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
 * LocalRuntimeStore owns the server URL and the reachability probe; each
 * successful probe hands the /api/tags body to applyTags, so the model list
 * and the online status always come from the same answer.
 */
export class OllamaStore {
  config: { apiKey: string | undefined; toolsEnabled: boolean };
  tagNames: string[] = [];
  lastRefreshAt: number | null = null;
  pulls = new Map<string, OllamaPullState>();

  private readonly registry: ModelRegistry;
  private readonly localRuntime: LocalRuntimeStore;
  private readonly useKeychainSecrets: boolean;
  private activePull: { model: string; controller: AbortController } | null = null;
  private configPersistenceDisposer: (() => void) | null = null;
  private secretPersistenceDisposer: (() => void) | null = null;
  /** `tag@digest` keys with a POST /api/show in flight. */
  private readonly windowLookups = new Set<string>();
  /**
   * `tag@digest` keys whose /api/show failed this session against the current
   * server. Not retried by the periodic probe until the digest changes, so a
   * server that rejects it is asked once per tag, not on every 60 s probe. A
   * base URL change or an explicit refresh forgets them.
   */
  private readonly failedWindowLookups = new Set<string>();
  /** Bumped when the server changes, so a lookup started against the old one is not remembered as failed. */
  private windowLookupGeneration = 0;

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
    // Entries carry their window facts (digest, Modelfile num_ctx, observed
    // window), so a restart neither re-asks /api/show nor forgets /api/ps.
    if (persisted.catalog.length) registry.setDynamicForProvider('ollama', persisted.catalog);

    makeAutoObservable<this,
      'registry'
      | 'localRuntime'
      | 'useKeychainSecrets'
      | 'activePull'
      | 'configPersistenceDisposer'
      | 'secretPersistenceDisposer'
      | 'windowLookups'
      | 'failedWindowLookups'
      | 'windowLookupGeneration'
    >(this, {
      registry: false,
      localRuntime: false,
      useKeychainSecrets: false,
      activePull: false,
      configPersistenceDisposer: false,
      secretPersistenceDisposer: false,
      windowLookups: false,
      failedWindowLookups: false,
      windowLookupGeneration: false,
    });

    localRuntime.attachOllamaCatalog({
      apiKey: () => this.config.apiKey,
      applyTags: raw => this.applyTags(raw),
      applyRunning: raw => this.applyRunning(raw),
      hostChanged: () => this.forgetHostWindowFacts(),
      catalog: () => this.catalog,
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
  /** A reachability probe (which also refreshes the catalog) is in flight. */
  get fetching(): boolean { return this.localRuntime.runtimes.ollama.checking; }
  /** Why the last probe failed; undefined after a successful one. */
  get lastError(): string | undefined { return this.localRuntime.runtimes.ollama.lastError; }
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

  /** Probes Ollama now; a successful answer refreshes the catalog through applyTags. */
  refresh(): Promise<void> {
    return this.localRuntime.probe('ollama', { fresh: true });
  }

  /**
   * Called by LocalRuntimeStore with the body of a successful GET /api/tags.
   * An answer that maps to the same tags and models changes nothing, so the
   * periodic probe does not re-render registry observers or rewrite storage.
   * Each entry keeps the window facts of the previous entry for its tag while
   * the digest is unchanged; `contextLength` is derived from them (see
   * `loadedWindowFor`). Tags not yet read for their digest get one /api/show.
   */
  applyTags(raw: unknown): void {
    const tagNames = extractOllamaTagNames(raw);
    const digests = extractOllamaTagDigests(raw);
    const previous = new Map(this.catalog.map(model => [model.providerModelId, model as OllamaCatalogModel]));
    const catalog = mapOllamaTagsToModels(raw).map(model => withLoadedWindow(
      carryWindowFacts(model, digests.get(model.providerModelId), previous.get(model.providerModelId)),
    ));
    if (!comparer.structural(tagNames, this.tagNames) || !comparer.structural(catalog, this.catalog)) {
      this.tagNames = tagNames;
      this.catalog = catalog;
      this.lastRefreshAt = Date.now();
    }
    this.lookUpModelfileWindows();
  }

  /**
   * Called by LocalRuntimeStore with the GET /api/ps body of the same probe.
   * Records each loaded model's `context_length` as its observed window. A
   * model that is not loaded keeps the last value seen; a new digest
   * (`carryWindowFacts`) or a new server (`forgetHostWindowFacts`) drops it.
   * It decides the window only when the Modelfile sets no `num_ctx`
   * (`loadedWindowFor`).
   */
  applyRunning(raw: unknown): void {
    const running = parseOllamaRunningWindows(raw);
    if (running.length === 0) return;
    this.updateCatalog(model => {
      if (isOllamaCloudModel(model)) return model;
      const seen = running.find(item => item.tag === model.providerModelId && sameDigest(item.digest, model.digest));
      return seen ? { ...model, observedContextLength: seen.contextLength } : model;
    });
  }

  /**
   * Called by LocalRuntimeStore when the Ollama base URL changes. What another
   * server loaded a tag with, and which /api/show calls failed there, say
   * nothing about the new one, so both go. The Modelfile facts stay: they are
   * kept per digest, and the same digest is the same manifest (parameters
   * included) on any server.
   */
  forgetHostWindowFacts(): void {
    this.windowLookupGeneration += 1;
    this.failedWindowLookups.clear();
    this.updateCatalog(model => {
      if (model.observedContextLength === undefined) return model;
      const next: OllamaCatalogModel = { ...model };
      delete next.observedContextLength;
      return next;
    });
  }

  private updateCatalog(update: (model: OllamaCatalogModel) => OllamaCatalogModel): void {
    const catalog = this.catalog.map(model => withLoadedWindow(update(model as OllamaCatalogModel)));
    if (!comparer.structural(catalog, this.catalog)) this.catalog = catalog;
  }

  /**
   * POST /api/show for each local tag whose Modelfile was not read for its
   * current digest. A failed lookup is not retried this session for that
   * digest. Never loads a model.
   */
  private lookUpModelfileWindows(): void {
    for (const model of this.catalog as OllamaCatalogModel[]) {
      const tag = model.providerModelId;
      if (isOllamaCloudModel(model) || resolveModelFormatProfile(tag).ollama?.numCtx) continue;
      const digest = model.digest ?? '';
      if (model.modelfileCheckedDigest === digest) continue;
      const key = `${tag}@${digest}`;
      if (this.windowLookups.has(key) || this.failedWindowLookups.has(key)) continue;
      this.windowLookups.add(key);
      const generation = this.windowLookupGeneration;
      void this.localRuntime.fetchOllamaNumCtx(tag).then(numCtx => {
        this.windowLookups.delete(key);
        if (numCtx === null) {
          if (generation === this.windowLookupGeneration) this.failedWindowLookups.add(key);
          return;
        }
        runInAction(() => this.updateCatalog(entry => {
          if (entry.providerModelId !== tag || (entry.digest ?? '') !== digest) return entry;
          const next: OllamaCatalogModel = { ...entry, modelfileCheckedDigest: digest };
          if (numCtx) next.modelfileNumCtx = numCtx;
          else delete next.modelfileNumCtx;
          return next;
        }));
      });
    }
  }

  clearCatalog(): void {
    if (this.activePull) { this.activePull.controller.abort(); this.activePull = null; }
    this.catalog = [];
    this.tagNames = [];
    this.lastRefreshAt = null;
  }

  private pullGuardMessage(model: string): string | null {
    if (!this.online) return 'Ollama is not answering yet. Start it, then try again.';
    if (this.hasModelTag(model)) return `${model} is already installed.`;
    if (this.activePull?.model === model) return `${model} is already pulling.`;
    if (this.activePull) return `Finish or cancel ${this.activePull.model} before pulling another model.`;
    return null;
  }
}

/**
 * A fresh /api/tags entry plus the window facts of the previous entry for the
 * same tag, kept only while the digest is unchanged: a re-created tag may
 * have a different Modelfile, so its facts start over.
 */
function carryWindowFacts(model: Model, digest: string | undefined, previous: OllamaCatalogModel | undefined): OllamaCatalogModel {
  const next: OllamaCatalogModel = { ...model };
  if (digest) next.digest = digest;
  if (!previous || previous.digest !== next.digest) return next;
  if (previous.modelfileCheckedDigest !== undefined) next.modelfileCheckedDigest = previous.modelfileCheckedDigest;
  if (previous.modelfileNumCtx !== undefined) next.modelfileNumCtx = previous.modelfileNumCtx;
  if (previous.observedContextLength !== undefined) next.observedContextLength = previous.observedContextLength;
  return next;
}

/**
 * The window a tag runs with, most authoritative first: a cloud model's
 * reported maximum (never the local 4096 fallback); the `num_ctx` GatesAI
 * sends for its format profile; the Modelfile `num_ctx` read for the current
 * digest; the window /api/ps last observed, only while no Modelfile `num_ctx`
 * is known. GatesAI sends no `num_ctx` for a plain tag, so Ollama loads it at
 * the Modelfile window (reloading a runner another client loaded with a
 * different one); /api/ps only tells us about a tag whose Modelfile sets
 * none. Undefined leaves budgeting on Ollama's own default (core/tokens).
 */
function loadedWindowFor(model: OllamaCatalogModel): number | undefined {
  if (isOllamaCloudModel(model)) return ollamaCloudContextLength(model);
  const sent = resolveModelFormatProfile(model.providerModelId).ollama?.numCtx;
  if (sent) return sent;
  const modelfile = model.modelfileCheckedDigest === (model.digest ?? '') ? model.modelfileNumCtx : undefined;
  return modelfile ?? model.observedContextLength;
}

function withLoadedWindow(model: OllamaCatalogModel): OllamaCatalogModel {
  const window = loadedWindowFor(model);
  if (window === model.contextLength) return model;
  const next: OllamaCatalogModel = { ...model };
  if (window) next.contextLength = window;
  else delete next.contextLength;
  return next;
}

/**
 * /api/ps and /api/tags digests are compared loosely (either may be absent,
 * or one a prefix of the other); a clear mismatch means a stale runner of a
 * re-created tag.
 */
function sameDigest(running: string | undefined, listed: string | undefined): boolean {
  if (!running || !listed) return true;
  return running.startsWith(listed) || listed.startsWith(running);
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

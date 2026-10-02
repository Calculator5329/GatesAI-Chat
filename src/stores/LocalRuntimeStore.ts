// Tracks whether Ollama and ComfyUI answer at their addresses and keeps the Ollama model list in step.
// Called by RootStore (startMonitoring on desktop, once keychain secrets have loaded), OllamaStore (attachOllamaCatalog, probe), image tools and the UI;
// depends on localRuntimeService.fetchOllamaTags and comfyDiscovery.findComfy.
// Invariant: status means "answered the last probe", never "GatesAI started it"; at most one probe per runtime is in flight.
import { autorun, makeAutoObservable, observable, reaction, runInAction } from 'mobx';
import type { Model } from '../core/types';
import { modelSupportsVision } from '../core/modelCapabilities';
import { normalizeComfyBaseUrl, normalizeOllamaBaseUrl, suggestOllamaPortUrl } from '../core/localUrls';
import { isWebLite } from '../core/runtime';
import { findComfy, type ComfyDiscovery } from '../services/image/comfyDiscovery';
import { isOllamaTagsPayload } from '../services/llm/ollamaCatalog';
import {
  localRuntimeService,
  type LocalRuntimeId,
  type LocalRuntimeService,
} from '../services/local/localRuntimeService';
import { loadLocalRuntimeConfig, saveLocalRuntimeConfig } from '../services/local/localRuntimeStorage';
import { logger } from '../services/diagnostics/logger';

export type { LocalRuntimeId };

/** `unknown` until the first probe for the current address answers or fails. */
export type RuntimeReachability = 'unknown' | 'online' | 'offline';

export interface RuntimeState {
  /** Normalized server address. For ComfyUI, the last address discovery found it on. */
  baseUrl: string;
  status: RuntimeReachability;
  /** A probe is in flight. */
  checking: boolean;
  lastCheckedAt?: number;
  /** Why the last probe failed, written for the person reading it. */
  lastError?: string;
}

/** What the Ollama probe needs from OllamaStore, which owns the key and the model list. */
export interface OllamaCatalogLink {
  apiKey(): string | undefined;
  applyTags(raw: unknown): void;
  catalog(): readonly Model[];
}

export interface LocalRuntimeStoreDeps {
  service?: Pick<LocalRuntimeService, 'fetchOllamaTags'>;
  findComfy?: (preferredUrl: string | undefined) => Promise<ComfyDiscovery>;
  /** Calls onWake when the window regains focus or becomes visible; returns an unsubscribe. */
  subscribeToWake?: (onWake: () => void) => () => void;
  /** False in Web Lite, where local runtimes stay off. */
  probesEnabled?: boolean;
}

/** Wait after the 1st, 2nd, 3rd, then every later unanswered probe in a row. */
export const PROBE_BACKOFF_OFFLINE_MS = [10_000, 30_000, 60_000, 300_000] as const;
export const PROBE_INTERVAL_ONLINE_MS = 60_000;

const WEB_LITE_LOCAL_ERROR = 'Local models need the GatesAI desktop app.';

type OllamaCheck = { ok: true; tags: unknown } | { ok: false; error: string };

export class LocalRuntimeStore {
  runtimes: Record<LocalRuntimeId, RuntimeState>;
  /** Latest ComfyUI discovery: installed models and the workflow preset the app will use. */
  comfyDiscovery: ComfyDiscovery | null = null;
  visionModel: string | undefined;
  /** New chats start on a local model when one is available. */
  preferLocalModels: boolean;

  private ollamaLink: OllamaCatalogLink | null = null;
  private readonly service: Pick<LocalRuntimeService, 'fetchOllamaTags'>;
  private readonly findComfy: (preferredUrl: string | undefined) => Promise<ComfyDiscovery>;
  private readonly subscribeToWake: (onWake: () => void) => () => void;
  private readonly probesEnabled: boolean;
  private readonly inflight = new Map<LocalRuntimeId, Promise<void>>();
  private readonly timers = new Map<LocalRuntimeId, ReturnType<typeof setTimeout>>();
  /** Unanswered probes in a row since the runtime last answered or its target changed. */
  private readonly offlineStreak = new Map<LocalRuntimeId, number>();
  private monitoring = false;
  private disposed = false;
  private readonly stopMonitoringHooks: Array<() => void> = [];
  private readonly stopPersistence: () => void;

  constructor(deps: LocalRuntimeStoreDeps = {}) {
    const persisted = loadLocalRuntimeConfig();
    this.service = deps.service ?? localRuntimeService;
    this.findComfy = deps.findComfy ?? (preferredUrl => findComfy(preferredUrl));
    this.subscribeToWake = deps.subscribeToWake ?? subscribeToWindowWake;
    this.probesEnabled = deps.probesEnabled ?? !isWebLite();
    this.runtimes = {
      ollama: this.initialRuntime(persisted.ollama.baseUrl),
      comfyui: this.initialRuntime(persisted.comfyui.baseUrl),
    };
    this.visionModel = persisted.visionModel;
    this.preferLocalModels = persisted.preferLocalModels;

    makeAutoObservable<this,
      | 'ollamaLink'
      | 'service'
      | 'findComfy'
      | 'subscribeToWake'
      | 'probesEnabled'
      | 'inflight'
      | 'timers'
      | 'offlineStreak'
      | 'monitoring'
      | 'disposed'
      | 'stopMonitoringHooks'
      | 'stopPersistence'
    >(this, {
      ollamaLink: observable.ref,
      service: false,
      findComfy: false,
      subscribeToWake: false,
      probesEnabled: false,
      inflight: false,
      timers: false,
      offlineStreak: false,
      monitoring: false,
      disposed: false,
      stopMonitoringHooks: false,
      stopPersistence: false,
    });

    this.stopPersistence = autorun(() => {
      const catalog = this.ollamaLink?.catalog() ?? [];
      if (this.visionModel && catalog.length > 0
          && !this.visionModels.some(model => model.providerModelId === this.visionModel)) {
        this.visionModel = undefined;
      }
      saveLocalRuntimeConfig({
        ollama: { baseUrl: this.runtimes.ollama.baseUrl },
        comfyui: { baseUrl: this.runtimes.comfyui.baseUrl },
        visionModel: this.visionModel,
        preferLocalModels: this.preferLocalModels,
      });
    });
  }

  get ollamaBaseUrl(): string {
    return this.runtimes.ollama.baseUrl;
  }

  get comfyBaseUrl(): string {
    return this.runtimes.comfyui.baseUrl;
  }

  /** ComfyUI answered and has a model one of the built-in workflows can use. */
  get comfyReady(): boolean {
    return this.comfyDiscovery?.online === true && this.comfyDiscovery.preset !== null;
  }

  get visionModels(): Model[] {
    return (this.ollamaLink?.catalog() ?? []).filter(modelSupportsVision);
  }

  /** OllamaStore registers here so each successful probe refreshes its model list. */
  attachOllamaCatalog(link: OllamaCatalogLink): void {
    this.ollamaLink = link;
  }

  /**
   * Probes both runtimes now, then keeps probing: every 60 s while a runtime
   * answers; while it does not, after 10 s, 30 s, 60 s, then every 5 min. The
   * window regaining focus or becoming visible probes both at once. An
   * address or Ollama key change, or a fresh probe, probes right away and
   * starts the backoff over. RootStore calls this on desktop only.
   */
  startMonitoring(): void {
    if (this.monitoring || this.disposed || !this.probesEnabled) return;
    this.monitoring = true;
    this.stopMonitoringHooks.push(
      this.subscribeToWake(() => { void this.probeAll(); }),
      reaction(() => this.ollamaLink?.apiKey(), () => {
        this.offlineStreak.delete('ollama');
        void this.probe('ollama');
      }),
    );
    void this.probeAll();
  }

  dispose(): void {
    this.disposed = true;
    this.monitoring = false;
    this.timers.forEach(timer => clearTimeout(timer));
    this.timers.clear();
    while (this.stopMonitoringHooks.length > 0) this.stopMonitoringHooks.pop()?.();
    this.stopPersistence();
  }

  probeAll(): Promise<void> {
    return Promise.all([this.probe('ollama'), this.probe('comfyui')]).then(() => undefined);
  }

  /**
   * Checks one runtime now. A call while a probe is in flight joins it; if
   * the address or key changed meanwhile, that probe re-runs against the new
   * target before settling, so a stale answer is never applied. `fresh`
   * waits out an in-flight probe and starts another with the backoff reset,
   * for "Check again" and callers that just changed what the server holds
   * (a finished pull or delete). Does nothing after dispose.
   */
  probe(id: LocalRuntimeId, options: { fresh?: boolean } = {}): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (!this.probesEnabled) {
      this.runtimes[id].lastError = WEB_LITE_LOCAL_ERROR;
      return Promise.resolve();
    }
    const existing = this.inflight.get(id);
    if (options.fresh) {
      const restart = (): Promise<void> => {
        this.offlineStreak.delete(id);
        return this.probe(id);
      };
      return existing ? existing.then(restart) : restart();
    }
    if (existing) return existing;
    this.runtimes[id].checking = true;
    const run = (id === 'ollama' ? this.probeOllama() : this.probeComfy()).finally(() => {
      this.inflight.delete(id);
      runInAction(() => { this.runtimes[id].checking = false; });
      this.scheduleNext(id);
    });
    this.inflight.set(id, run);
    return run;
  }

  setBaseUrl(id: LocalRuntimeId, url: string): void {
    const next = id === 'ollama' ? normalizeOllamaBaseUrl(url) : normalizeComfyBaseUrl(url);
    const runtime = this.runtimes[id];
    if (next === runtime.baseUrl) return;
    runtime.baseUrl = next;
    this.offlineStreak.delete(id);
    if (!this.monitoring) return;
    runtime.status = 'unknown';
    runtime.lastError = undefined;
    void this.probe(id);
  }

  setPreferLocalModels(prefer: boolean): void {
    this.preferLocalModels = prefer;
  }

  setVisionModel(model: string | undefined): void {
    const trimmed = model?.trim();
    this.visionModel = trimmed || undefined;
  }

  private initialRuntime(baseUrl: string): RuntimeState {
    return { baseUrl, status: this.probesEnabled ? 'unknown' : 'offline', checking: false };
  }

  private async probeOllama(): Promise<void> {
    for (;;) {
      const baseUrl = this.ollamaBaseUrl;
      const apiKey = this.ollamaLink?.apiKey();
      const check = await this.checkOllama(baseUrl, apiKey);
      if (this.disposed) return;
      if (baseUrl !== this.ollamaBaseUrl || apiKey !== this.ollamaLink?.apiKey()) continue;
      runInAction(() => {
        if (check.ok) this.ollamaLink?.applyTags(check.tags);
        this.settle('ollama', check.ok, check.ok ? undefined : check.error);
      });
      return;
    }
  }

  private async checkOllama(baseUrl: string, apiKey: string | undefined): Promise<OllamaCheck> {
    try {
      const tags = await this.service.fetchOllamaTags(baseUrl, apiKey);
      if (!isOllamaTagsPayload(tags)) return { ok: false, error: notOllamaError(baseUrl) };
      return { ok: true, tags };
    } catch (err) {
      return { ok: false, error: ollamaProbeError(baseUrl, err) };
    }
  }

  private async probeComfy(): Promise<void> {
    for (;;) {
      const preferred = this.comfyBaseUrl;
      const discovery = await this.discoverComfy(preferred);
      if (this.disposed) return;
      if (preferred !== this.comfyBaseUrl) continue;
      runInAction(() => {
        this.comfyDiscovery = discovery;
        if (discovery.online) this.runtimes.comfyui.baseUrl = discovery.baseUrl;
        this.settle('comfyui', discovery.online, discovery.online && !discovery.preset
          ? `ComfyUI is running at ${discovery.baseUrl}, but it has no image model GatesAI can use.`
          : discovery.error);
      });
      return;
    }
  }

  private async discoverComfy(preferred: string): Promise<ComfyDiscovery> {
    try {
      return await this.findComfy(preferred);
    } catch (err) {
      logger.warn('local-runtime', 'ComfyUI discovery threw', { err });
      return {
        baseUrl: preferred,
        online: false,
        error: `Nothing is answering at ${preferred}.`,
        checkpoints: [],
        diffusionModels: [],
        preset: null,
      };
    }
  }

  private settle(id: LocalRuntimeId, online: boolean, error: string | undefined): void {
    const runtime = this.runtimes[id];
    const status = online ? 'online' : 'offline';
    if (runtime.status !== status) {
      logger.info('local-runtime', `${id} is ${status}`, { baseUrl: runtime.baseUrl, error });
    }
    runtime.status = status;
    runtime.lastError = error;
    runtime.lastCheckedAt = Date.now();
  }

  private scheduleNext(id: LocalRuntimeId): void {
    if (!this.monitoring || this.disposed) return;
    const pending = this.timers.get(id);
    if (pending) clearTimeout(pending);
    this.timers.set(id, setTimeout(() => {
      this.timers.delete(id);
      void this.probe(id);
    }, this.nextProbeDelay(id)));
  }

  /** Counts the probe that just settled toward the backoff, or clears it when the runtime answered. */
  private nextProbeDelay(id: LocalRuntimeId): number {
    if (this.runtimes[id].status === 'online') {
      this.offlineStreak.delete(id);
      return PROBE_INTERVAL_ONLINE_MS;
    }
    const streak = this.offlineStreak.get(id) ?? 0;
    this.offlineStreak.set(id, streak + 1);
    return PROBE_BACKOFF_OFFLINE_MS[Math.min(streak, PROBE_BACKOFF_OFFLINE_MS.length - 1)];
  }
}

/** One short sentence for a failed tags request; statuses arrive as "HTTP 401" or "Ollama 401". */
function ollamaProbeError(baseUrl: string, err: unknown): string {
  // Response.json() throws SyntaxError when a 200 body is not JSON, such as a web page.
  if (err instanceof SyntaxError) return notOllamaError(baseUrl);
  const message = err instanceof Error ? err.message : String(err);
  const status = /\b(?:HTTP|Ollama)\s+(\d{3})\b/i.exec(message)?.[1];
  if (status === '401' || status === '403') {
    return `${baseUrl} turned the request away (HTTP ${status}). Check the Ollama API key in Settings > Models.`;
  }
  if (status) return `${baseUrl} answered with HTTP ${status}.`;
  return `Nothing is answering at ${baseUrl}.`;
}

/** Something answered with a body that is not an Ollama model list; on port 80 or 443 that is usually another web server. */
function notOllamaError(baseUrl: string): string {
  const suggestion = suggestOllamaPortUrl(baseUrl);
  const hint = suggestion ? ` Ollama usually listens on port 11434, for example ${suggestion}.` : '';
  return `${baseUrl} answered, but it isn't Ollama.${hint}`;
}

function subscribeToWindowWake(onWake: () => void): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') onWake();
  };
  window.addEventListener('focus', onWake);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    window.removeEventListener('focus', onWake);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

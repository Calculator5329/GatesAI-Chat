// Owns observable LocalRuntimeStore state and actions for the app runtime.
// Called by RootStore, React context hooks, and service callbacks; depends on services/core contracts.
// Invariant: mutations happen through store actions so UI derivations stay consistent.
import { autorun, makeAutoObservable, runInAction, toJS } from 'mobx';
import type { Model } from '../core/types';
import { modelSupportsVision } from '../core/modelCapabilities';
import { detectLocalRuntimes, type LocalRuntimeDetection } from '../services/local/autoDetect';
import {
  DEFAULT_COMFY_BASE_URL,
  DEFAULT_LOCAL_RUNTIME_CONFIG,
  loadLocalRuntimeConfig,
  saveLocalRuntimeConfig,
  type LocalRuntimePersistedConfig,
} from '../services/local/localRuntimeStorage';
import { logger } from '../services/diagnostics/logger';
import {
  localRuntimeService,
  type LocalRuntimeId,
  type LocalRuntimeService,
  type LocalRuntimeStatus,
} from '../services/local/localRuntimeService';
import { DEFAULT_OLLAMA_BASE_URL } from '../services/llm/ollama';

export type { LocalRuntimeId, LocalRuntimeService, LocalRuntimeStatus };

export interface RuntimeState {
  installPath: string;
  managed: boolean;
  baseUrl: string;
  status: LocalRuntimeStatus;
  pid?: number;
  uptimeMs?: number;
  lastError?: string;
  logs: string[];
}

export interface LocalRuntimeStoreDeps {
  service?: LocalRuntimeService;
  autoDetect?: () => Promise<LocalRuntimeDetection>;
  getOllamaCatalog?: () => Model[];
}

/**
 * If `status === 'starting'` for longer than this, we assume the spawn
 * succeeded but the health check never came online (port collision, model
 * load wedged, etc.) and flip the row into a 'crashed' state so the UI
 * surfaces an actionable error instead of an indefinite spinner.
 */
export const STARTING_WATCHDOG_MS = 45_000;

export class LocalRuntimeStore {
  runtimes: Record<LocalRuntimeId, RuntimeState>;
  visionModel: string | undefined;
  autoDetectComplete: boolean;
  autoDetectAt: number | undefined;
  autoDetecting = false;

  private readonly service: LocalRuntimeService;
  private readonly detect: () => Promise<LocalRuntimeDetection>;
  private readonly getOllamaCatalog: () => Model[];
  private readonly statusRefreshes = new Map<LocalRuntimeId, Promise<void>>();
  private readonly watchdogs = new Map<LocalRuntimeId, ReturnType<typeof setTimeout>>();

  constructor(deps: LocalRuntimeStoreDeps = {}) {
    const persisted = loadLocalRuntimeConfig();
    this.runtimes = {
      ollama: toRuntimeState(persisted.ollama),
      comfyui: toRuntimeState(persisted.comfyui),
    };
    this.visionModel = persisted.visionModel;
    this.autoDetectComplete = persisted.autoDetectComplete;
    this.autoDetectAt = persisted.autoDetectAt;
    this.service = deps.service ?? localRuntimeService;
    this.detect = deps.autoDetect ?? detectLocalRuntimes;
    this.getOllamaCatalog = deps.getOllamaCatalog ?? (() => []);

    makeAutoObservable<this, 'service' | 'detect' | 'getOllamaCatalog' | 'statusRefreshes' | 'watchdogs'>(this, {
      service: false,
      detect: false,
      getOllamaCatalog: false,
      statusRefreshes: false,
      watchdogs: false,
    });

    autorun(() => {
      if (this.visionModel && this.getOllamaCatalog().length > 0
          && !this.visionModels.some(model => model.providerModelId === this.visionModel)) {
        this.visionModel = undefined;
      }
      const snap: LocalRuntimePersistedConfig = {
        ollama: persistedStateFromRuntime(this.runtimes.ollama),
        comfyui: persistedStateFromRuntime(this.runtimes.comfyui),
        visionModel: this.visionModel,
        autoDetectComplete: this.autoDetectComplete,
        autoDetectAt: this.autoDetectAt,
      };
      saveLocalRuntimeConfig(snap);
    });
  }

  get ollamaBaseUrl(): string {
    return this.runtimes.ollama.baseUrl || DEFAULT_OLLAMA_BASE_URL;
  }

  get comfyBaseUrl(): string {
    return this.runtimes.comfyui.baseUrl || DEFAULT_COMFY_BASE_URL;
  }

  get comfyReady(): boolean {
    const runtime = this.runtimes.comfyui;
    return runtime.managed && runtime.status === 'online';
  }

  get visionModels(): Model[] {
    return this.getOllamaCatalog().filter(modelSupportsVision);
  }

  async init(): Promise<void> {
    if (this.autoDetectComplete) return;
    await this.autoDetect();
  }

  setInstallPath(id: LocalRuntimeId, path: string): void {
    this.runtimes[id].installPath = path.trim();
  }

  setBaseUrl(id: LocalRuntimeId, url: string): void {
    const fallback = id === 'ollama' ? DEFAULT_OLLAMA_BASE_URL : DEFAULT_COMFY_BASE_URL;
    this.runtimes[id].baseUrl = url.trim().replace(/\/+$/, '') || fallback;
  }

  setManaged(id: LocalRuntimeId, managed: boolean): void {
    this.runtimes[id].managed = managed;
  }

  setVisionModel(model: string | undefined): void {
    const trimmed = model?.trim();
    this.visionModel = trimmed || undefined;
  }

  async autoDetect(): Promise<void> {
    this.autoDetecting = true;
    try {
      const detected = await this.detect();
      runInAction(() => {
        if (detected.ollama?.installPath) {
          this.runtimes.ollama.installPath = detected.ollama.installPath;
          this.runtimes.ollama.lastError = undefined;
        } else if (!this.runtimes.ollama.installPath) {
          this.runtimes.ollama.lastError = 'Auto-detect could not find ollama.exe — use Browse… to point at it.';
        }
        if (detected.comfyui?.installPath) {
          this.runtimes.comfyui.installPath = detected.comfyui.installPath;
          this.runtimes.comfyui.lastError = undefined;
        } else if (!this.runtimes.comfyui.installPath) {
          this.runtimes.comfyui.lastError = 'Auto-detect could not find a ComfyUI portable root — use Browse… to point at it.';
        }
        this.autoDetectComplete = true;
        this.autoDetectAt = Date.now();
        this.autoDetecting = false;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('local-runtime', 'Auto-detect failed', { err });
      runInAction(() => {
        this.runtimes.ollama.lastError = `Auto-detect failed: ${message}`;
        this.runtimes.comfyui.lastError = `Auto-detect failed: ${message}`;
        this.autoDetecting = false;
      });
    }
  }

  async browseFor(id: LocalRuntimeId): Promise<void> {
    const path = id === 'ollama'
      ? await this.service.pickFile()
      : await this.service.pickDirectory();
    if (path) this.setInstallPath(id, path);
  }

  async start(id: LocalRuntimeId): Promise<void> {
    const runtime = this.runtimes[id];
    if (!runtime.managed) {
      runtime.lastError = 'Enable "Manage this process from GatesAI" before starting it here.';
      return;
    }
    if (!runtime.installPath) {
      runtime.lastError = `Choose a ${id === 'ollama' ? 'Ollama executable' : 'ComfyUI portable folder'} first.`;
      return;
    }

    runtime.status = 'starting';
    runtime.lastError = undefined;
    this.armWatchdog(id);
    try {
      await this.service.startRuntime(id, {
        installPath: runtime.installPath,
      });
      await this.refreshStatus(id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isAddressInUseError(message) || isAlreadyRunningOutsideGatesAI(message)) {
        const probe = await this.testConnection(id);
        if (probe.ok) {
          this.clearWatchdog(id);
          runInAction(() => {
            runtime.status = 'online';
            runtime.pid = undefined;
            runtime.uptimeMs = undefined;
            runtime.lastError = `${runtimeLabel(id)} is already running on ${id === 'ollama' ? this.ollamaBaseUrl : this.comfyBaseUrl}; GatesAI will use that existing server.`;
          });
          return;
        }
      }
      this.clearWatchdog(id);
      logger.error('local-runtime', 'Failed to start runtime', { id, message });
      runInAction(() => {
        runtime.status = 'crashed';
        runtime.lastError = message;
      });
    }
  }

  async stop(id: LocalRuntimeId): Promise<void> {
    this.clearWatchdog(id);
    await this.service.stopRuntime(id);
    runInAction(() => {
      this.runtimes[id].status = 'stopped';
      this.runtimes[id].pid = undefined;
      this.runtimes[id].uptimeMs = undefined;
    });
  }

  /**
   * Probe the runtime's base URL once and report whether it answered.
   * Used by the Test button next to Base URL inputs so the user gets
   * immediate feedback after editing rather than waiting on the next
   * poll tick. Does NOT mutate runtime state — pure probe.
   */
  async testConnection(id: LocalRuntimeId): Promise<{ ok: true } | { ok: false; error: string }> {
    const baseUrl = id === 'ollama' ? this.ollamaBaseUrl : this.comfyBaseUrl;
    const probeUrl = id === 'ollama' ? `${baseUrl}/api/version` : `${baseUrl}/system_stats`;
    try {
      await this.service.probeHttp(probeUrl);
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg.includes('aborted') ? `No response from ${probeUrl} (timeout)` : `${msg} (${probeUrl})` };
    }
  }

  fetchOllamaTags(apiKey?: string): Promise<unknown> {
    return this.service.fetchOllamaTags(this.ollamaBaseUrl, apiKey);
  }

  private armWatchdog(id: LocalRuntimeId): void {
    this.clearWatchdog(id);
    const timer = setTimeout(() => {
      runInAction(() => {
        const runtime = this.runtimes[id];
        if (runtime.status !== 'starting') return;
        runtime.status = 'crashed';
        runtime.lastError = `${id === 'ollama' ? 'Ollama' : 'ComfyUI'} did not become healthy within ${Math.round(STARTING_WATCHDOG_MS / 1000)}s. Open Logs to see why.`;
      });
    }, STARTING_WATCHDOG_MS);
    this.watchdogs.set(id, timer);
  }

  private clearWatchdog(id: LocalRuntimeId): void {
    const t = this.watchdogs.get(id);
    if (t) {
      clearTimeout(t);
      this.watchdogs.delete(id);
    }
  }

  async refreshStatus(id: LocalRuntimeId): Promise<void> {
    const existing = this.statusRefreshes.get(id);
    if (existing) return existing;
    const refresh = this.doRefreshStatus(id).finally(() => {
      this.statusRefreshes.delete(id);
    });
    this.statusRefreshes.set(id, refresh);
    return refresh;
  }

  private async doRefreshStatus(id: LocalRuntimeId): Promise<void> {
    const snapshot = await this.service.getRuntimeStatus(id);
    runInAction(() => {
      const runtime = this.runtimes[id];
      // Sticky-starting: while the user-initiated start watchdog is still
      // armed, the host reports 'offline' for the entire boot window
      // (process spawned but health endpoint not yet answering — totally
      // normal for ComfyUI's 30–90s CUDA + model-load startup). Without
      // this gate, the pill would flick straight to "Offline" and the
      // Start button would re-appear, making it look like nothing happened.
      // Only let 'online' (success) or 'crashed' (real failure) break out
      // of the starting state. The watchdog itself still fires at the
      // STARTING_WATCHDOG_MS timeout to flip stuck-starting → crashed.
      const inStartWindow = this.watchdogs.has(id);
      const reportedStatus = snapshot.status;
      const effectiveStatus =
        inStartWindow && (reportedStatus === 'offline' || reportedStatus === 'stopped')
          ? 'starting'
          : reportedStatus;

      runtime.status = effectiveStatus;
      runtime.pid = snapshot.pid;
      runtime.uptimeMs = snapshot.uptimeMs;
      runtime.logs = snapshot.logs;
      // Don't clobber the lastError we set ourselves on disabled-toggle /
      // missing-path / spawn-failure paths with a stale `last_error`
      // string from the host while we're still booting.
      if (!(inStartWindow && (reportedStatus === 'offline' || reportedStatus === 'stopped'))) {
        runtime.lastError = snapshot.lastError;
      }
    });
    if (snapshot.status === 'online' || snapshot.status === 'crashed') {
      this.clearWatchdog(id);
    }
  }

  /**
   * Eagerly refresh both runtimes. Called by the panel on mount so the
   * first paint reflects current state instead of the persisted snapshot.
   */
  refreshAll(): void {
    void this.refreshStatus('ollama');
    void this.refreshStatus('comfyui');
  }

  resetConfig(): void {
    this.watchdogs.forEach(timer => clearTimeout(timer));
    this.watchdogs.clear();
    this.runtimes = {
      ollama: toRuntimeState(DEFAULT_LOCAL_RUNTIME_CONFIG.ollama),
      comfyui: toRuntimeState(DEFAULT_LOCAL_RUNTIME_CONFIG.comfyui),
    };
    this.visionModel = DEFAULT_LOCAL_RUNTIME_CONFIG.visionModel;
    this.autoDetectComplete = DEFAULT_LOCAL_RUNTIME_CONFIG.autoDetectComplete;
    this.autoDetectAt = DEFAULT_LOCAL_RUNTIME_CONFIG.autoDetectAt;
  }

  selectDefaultVisionModel(): void {
    if (this.visionModel) return;
    const first = this.visionModels[0];
    if (first) this.visionModel = first.providerModelId;
  }
}

function toRuntimeState(persisted: LocalRuntimePersistedConfig['ollama']): RuntimeState {
  return {
    installPath: persisted.installPath,
    managed: persisted.managed,
    baseUrl: persisted.baseUrl,
    status: 'stopped',
    logs: [],
  };
}

function persistedStateFromRuntime(runtime: RuntimeState): LocalRuntimePersistedConfig['ollama'] {
  const { installPath, managed, baseUrl } = toJS(runtime);
  return { installPath, managed, baseUrl };
}

function isAddressInUseError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('address already in use')
    || lower.includes('only one usage of each socket address')
    || lower.includes('cannot assign requested address')
    || lower.includes('bind:')
    || lower.includes('eaddrinuse');
}

function isAlreadyRunningOutsideGatesAI(message: string): boolean {
  return message.toLowerCase().includes('already running outside gatesai');
}

function runtimeLabel(id: LocalRuntimeId): string {
  return id === 'ollama' ? 'Ollama' : 'ComfyUI';
}

export function localRuntimeDefaults(): LocalRuntimePersistedConfig {
  return JSON.parse(JSON.stringify(DEFAULT_LOCAL_RUNTIME_CONFIG)) as LocalRuntimePersistedConfig;
}

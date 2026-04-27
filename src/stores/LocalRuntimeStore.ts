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

export class LocalRuntimeStore {
  runtimes: Record<LocalRuntimeId, RuntimeState>;
  visionModel: string | undefined;
  autoDetectComplete: boolean;
  autoDetecting = false;

  private readonly service: LocalRuntimeService;
  private readonly detect: () => Promise<LocalRuntimeDetection>;
  private readonly getOllamaCatalog: () => Model[];
  private readonly statusRefreshes = new Map<LocalRuntimeId, Promise<void>>();

  constructor(deps: LocalRuntimeStoreDeps = {}) {
    const persisted = loadLocalRuntimeConfig();
    this.runtimes = {
      ollama: toRuntimeState(persisted.ollama),
      comfyui: toRuntimeState(persisted.comfyui),
    };
    this.visionModel = persisted.visionModel;
    this.autoDetectComplete = persisted.autoDetectComplete;
    this.service = deps.service ?? localRuntimeService;
    this.detect = deps.autoDetect ?? detectLocalRuntimes;
    this.getOllamaCatalog = deps.getOllamaCatalog ?? (() => []);

    makeAutoObservable<this, 'service' | 'detect' | 'getOllamaCatalog' | 'statusRefreshes'>(this, {
      service: false,
      detect: false,
      getOllamaCatalog: false,
      statusRefreshes: false,
    });

    autorun(() => {
      const snap: LocalRuntimePersistedConfig = {
        ollama: persistedStateFromRuntime(this.runtimes.ollama),
        comfyui: persistedStateFromRuntime(this.runtimes.comfyui),
        visionModel: this.visionModel,
        autoDetectComplete: this.autoDetectComplete,
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
        this.autoDetecting = false;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
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
    try {
      await this.service.startRuntime(id, {
        installPath: runtime.installPath,
      });
      await this.refreshStatus(id);
    } catch (err) {
      runInAction(() => {
        runtime.status = 'crashed';
        runtime.lastError = err instanceof Error ? err.message : String(err);
      });
    }
  }

  async stop(id: LocalRuntimeId): Promise<void> {
    await this.service.stopRuntime(id);
    runInAction(() => {
      this.runtimes[id].status = 'stopped';
      this.runtimes[id].pid = undefined;
      this.runtimes[id].uptimeMs = undefined;
    });
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
      runtime.status = snapshot.status;
      runtime.pid = snapshot.pid;
      runtime.uptimeMs = snapshot.uptimeMs;
      runtime.logs = snapshot.logs;
      runtime.lastError = snapshot.lastError;
    });
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

export function localRuntimeDefaults(): LocalRuntimePersistedConfig {
  return JSON.parse(JSON.stringify(DEFAULT_LOCAL_RUNTIME_CONFIG)) as LocalRuntimePersistedConfig;
}

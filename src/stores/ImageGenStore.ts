// Owns observable ImageGenStore state and actions for the app runtime.
// Called by RootStore, React context hooks, and service callbacks; depends on services/core contracts.
// Invariant: mutations happen through store actions so UI derivations stay consistent.
import { autorun, makeAutoObservable, toJS } from 'mobx';
import type { ImageBackendConfig } from '../services/image/imageBackend';
import type { ComfyDiscovery } from '../services/image/comfyDiscovery';
import type { ImageBackendId } from '../services/image/types';
import {
  DEFAULT_IMAGE_GEN_CONFIG,
  loadImageGenConfig,
  saveImageGenConfig,
  type ImageBackendChoice,
  type ImageGenConfig,
} from '../services/imageGenStorage';

/** What image generation reads from LocalRuntimeStore. */
export interface ImageGenLocalRuntime {
  readonly comfyBaseUrl: string;
  /** ComfyUI answered and has a model the app can use. */
  readonly comfyReady: boolean;
  readonly comfyDiscovery: ComfyDiscovery | null;
}

/**
 * Owns image-generation credentials + backend selection. Kept separate
 * from {@link ProviderStore} because image-gen isn't quite "another LLM
 * provider" — it has its own config shape (backend switcher, per-vendor
 * keys, workflow settings) and different credentials per backend.
 *
 * UI asks {@link getCredential} for backend readiness; the `image_generate`
 * tool asks {@link toBackendConfig} to get a plain config snapshot for the
 * dispatcher.
 *
 * Local first: until the user picks a backend, a running ComfyUI wins when it
 * has a built-in workflow's model or the user set a custom workflow, and
 * OpenRouter covers the time it does not.
 */
export class ImageGenStore {
  config: ImageGenConfig;
  private readonly localRuntime?: ImageGenLocalRuntime;
  private readonly getOpenRouterKey: () => string | undefined;

  constructor(localRuntime?: ImageGenLocalRuntime, getOpenRouterKey: () => string | undefined = () => undefined) {
    this.localRuntime = localRuntime;
    this.getOpenRouterKey = getOpenRouterKey;
    this.config = loadImageGenConfig();
    makeAutoObservable<this, 'localRuntime' | 'getOpenRouterKey'>(this, {
      localRuntime: false,
      getOpenRouterKey: false,
    });

    autorun(() => {
      saveImageGenConfig(toJS(this.config));
    });
  }

  /** What the user asked for: `auto` or an explicit backend. */
  get backendChoice(): ImageBackendChoice {
    return this.config.backendChoice;
  }

  /** The backend image generation uses right now. */
  get backend(): ImageBackendId {
    return this.resolveEffectiveBackend();
  }

  get comfyWorkflowPath(): string | undefined {
    return this.config.comfyWorkflowPath;
  }

  /** Records an explicit pick; `auto` hands the choice back to the app. */
  setBackend(backendChoice: ImageBackendChoice): void {
    this.config = { ...this.config, backendChoice };
  }

  setComfyWorkflowPath(path: string): void {
    const trimmed = path.trim();
    this.config = { ...this.config, comfyWorkflowPath: trimmed || undefined };
  }

  setComfyQualityPreset(preset: ImageGenConfig['comfyQualityPreset']): void {
    this.config = { ...this.config, comfyQualityPreset: preset };
  }

  setComfyUpscaleFactor(factor: ImageGenConfig['comfyUpscaleFactor']): void {
    this.config = { ...this.config, comfyUpscaleFactor: factor };
  }

  setComfyQualitySteps(steps: number): void {
    this.config = { ...this.config, comfyQualitySteps: clampSteps(steps, 12) };
  }

  setComfyDraftSteps(steps: number): void {
    this.config = { ...this.config, comfyDraftSteps: clampSteps(steps, 8) };
  }

  setComfyCfg(cfg: number): void {
    const value = Number.isFinite(cfg) ? Math.min(20, Math.max(0.1, Math.round(cfg * 10) / 10)) : 1;
    this.config = { ...this.config, comfyCfg: value };
  }

  reset(): void {
    this.config = { ...DEFAULT_IMAGE_GEN_CONFIG };
  }

  /**
   * Resolve the credential / base URL for a given backend. Used by
   * Settings UI to decide whether to render "connected" state; the
   * actual dispatcher reads the full config via {@link toBackendConfig}.
   */
  getCredential(backend: ImageBackendId = this.backend): string | null {
    switch (backend) {
      case 'local-comfy': return this.comfyBaseUrl ?? null;
      case 'openrouter-image': return this.getOpenRouterKey() ?? null;
    }
  }

  /**
   * Flatten the observable config into a plain config object the
   * dispatcher can consume. Intentionally excludes `comfyWorkflowPath`
   * — the tool resolves that through the bridge before calling the
   * dispatcher (path → JSON).
   */
  toBackendConfig(): Omit<ImageBackendConfig, 'comfyWorkflowTemplate' | 'fetch'> {
    const discovery = this.localRuntime?.comfyDiscovery;
    return {
      primary: this.resolveEffectiveBackend(),
      comfyBaseUrl: this.comfyBaseUrl,
      comfyDiscovery: discovery ? toJS(discovery) : undefined,
      comfyQualityPreset: this.config.comfyQualityPreset ?? 'full',
      comfyUpscaleFactor: this.config.comfyUpscaleFactor ?? 1,
      comfyQualitySteps: this.config.comfyQualitySteps ?? 12,
      comfyDraftSteps: this.config.comfyDraftSteps ?? 8,
      comfyCfg: this.config.comfyCfg ?? 1,
      openRouterApiKey: this.getOpenRouterKey(),
    };
  }

  /** The server discovery found, else the configured address. */
  private get comfyBaseUrl(): string | undefined {
    const discovery = this.localRuntime?.comfyDiscovery;
    return discovery?.online ? discovery.baseUrl : this.localRuntime?.comfyBaseUrl;
  }

  private resolveEffectiveBackend(): ImageBackendId {
    const choice = this.config.backendChoice;
    const openRouterReady = !!this.getOpenRouterKey()?.trim();
    const comfyOnline = this.localRuntime?.comfyDiscovery?.online ?? false;
    // A custom workflow brings its own model choice, so it needs no preset.
    const comfyUsable = (this.localRuntime?.comfyReady ?? false) || (comfyOnline && !!this.config.comfyWorkflowPath);

    if (choice === 'auto') {
      // A running ComfyUI without a model beats a missing key: its error says which folder to fill.
      return comfyUsable || (comfyOnline && !openRouterReady) ? 'local-comfy' : 'openrouter-image';
    }
    if (choice === 'local-comfy' && !comfyUsable && openRouterReady) {
      return 'openrouter-image';
    }
    if (choice === 'openrouter-image' && !openRouterReady && comfyUsable) {
      return 'local-comfy';
    }
    return choice;
  }
}

function clampSteps(steps: number, fallback: number): number {
  return Number.isFinite(steps) ? Math.min(50, Math.max(6, Math.round(steps))) : fallback;
}

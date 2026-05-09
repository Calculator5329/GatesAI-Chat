import { autorun, makeAutoObservable, toJS } from 'mobx';
import type { ImageBackendConfig } from '../services/image/imageBackend';
import type { ImageBackendId } from '../services/image/types';
import type { LocalRuntimeStore } from './LocalRuntimeStore';
import {
  DEFAULT_IMAGE_GEN_CONFIG,
  loadImageGenConfig,
  saveImageGenConfig,
  type ImageGenConfig,
} from '../services/imageGenStorage';

/**
 * Owns image-generation credentials + backend selection. Kept separate
 * from {@link ProviderStore} because image-gen isn't quite "another LLM
 * provider" — it has its own config shape (backend switcher, per-vendor
 * keys, workflow settings) and different credentials per backend.
 *
 * UI asks {@link getCredential} for backend readiness; the `image_generate`
 * tool asks {@link toBackendConfig} to get a plain config snapshot for the
 * dispatcher.
 */
export class ImageGenStore {
  config: ImageGenConfig;
  private readonly localRuntime?: LocalRuntimeStore;

  constructor(localRuntime?: LocalRuntimeStore) {
    this.localRuntime = localRuntime;
    this.config = loadImageGenConfig();
    makeAutoObservable<this, 'localRuntime'>(this, {
      localRuntime: false,
    });

    autorun(() => {
      saveImageGenConfig(toJS(this.config));
    });
  }

  get backend(): ImageBackendId {
    return this.config.backend;
  }

  get comfyWorkflowPath(): string | undefined {
    return this.config.comfyWorkflowPath;
  }

  setBackend(backend: ImageBackendId): void {
    this.config = { ...this.config, backend };
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
      case 'local-comfy': return this.localRuntime?.comfyBaseUrl ?? null;
    }
  }

  /**
   * Flatten the observable config into a plain config object the
   * dispatcher can consume. Intentionally excludes `comfyWorkflowPath`
   * — the tool resolves that through the bridge before calling the
   * dispatcher (path → JSON).
   */
  toBackendConfig(): Omit<ImageBackendConfig, 'comfyWorkflowTemplate' | 'fetch'> {
    return {
      primary: this.config.backend,
      comfyBaseUrl: this.localRuntime?.comfyBaseUrl,
      comfyQualityPreset: this.config.comfyQualityPreset ?? 'full',
      comfyUpscaleFactor: this.config.comfyUpscaleFactor ?? 1,
    };
  }
}

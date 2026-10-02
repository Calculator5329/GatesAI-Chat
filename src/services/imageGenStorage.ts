/**
 * Persistence for image-generation credentials and backend selection.
 * Separate localStorage key from `gatesai.providers.v1` so image-gen
 * backends can evolve — add BFL direct, Together, Replicate, etc.
 * without churning the LLM-provider shape.
 */

import type {
  ImageBackendId,
  ComfyQualityPreset,
  UpscaleFactor,
} from './image/types';
import { isImageBackendId, VALID_UPSCALE_FACTORS } from './image/types';
import { createJsonPersistenceProvider } from './storage/persistenceProvider';

export type { ImageBackendId, ComfyQualityPreset, UpscaleFactor };

/**
 * `auto` (the default) picks ComfyUI when it is running with a model a
 * built-in workflow can use or with a custom workflow set, else OpenRouter
 * when there is a key. With no key, a running ComfyUI still wins so its error
 * names the missing model; with neither, the OpenRouter no-key error points
 * at both fixes. A backend id is an explicit pick that wins while it can run;
 * the other backend covers for it while it cannot.
 */
export type ImageBackendChoice = 'auto' | ImageBackendId;

export interface ImageGenConfig {
  backendChoice: ImageBackendChoice;

  /**
   * Optional path inside `/workspace/` to a custom ComfyUI workflow
   * JSON template. `{{PROMPT}}`, `{{WIDTH}}`, `{{HEIGHT}}`, `{{SEED}}`
   * get substituted before submission. Used for `full` renders outside
   * direct image mode. Empty = the built-in workflow discovery picks.
   */
  comfyWorkflowPath?: string;

  /**
   * Built-in ComfyUI workflow preset; what it runs depends on discovery.
   * With FLUX.2 Klein installed, `full` runs Klein (optional hires-fix) and
   * `quick` runs SDXL Lightning when its checkpoint is there too, else Klein
   * at draft steps. With only SDXL Lightning or a generic checkpoint, both
   * run that model.
   */
  comfyQualityPreset?: ComfyQualityPreset;

  /**
   * Hires-fix multiplier for the FLUX.2 Klein workflow in `full` mode. `1`
   * (default) renders at the workflow's native resolution and skips the
   * second pass entirely. Larger values pixel-upscale the decoded image and
   * run a low-denoise refinement pass at the new resolution.
   */
  comfyUpscaleFactor?: UpscaleFactor;

  /** Sampling controls for the Klein and Lightning workflows (the generic
   * checkpoint workflow sets its own). Study-backed defaults: quality 12
   * steps, draft 8 steps, CFG 1.0. */
  comfyQualitySteps?: number;
  comfyDraftSteps?: number;
  comfyCfg?: number;

}

export const DEFAULT_IMAGE_GEN_CONFIG: ImageGenConfig = {
  backendChoice: 'auto',
  comfyQualityPreset: 'full',
  comfyUpscaleFactor: 1,
  comfyQualitySteps: 12,
  comfyDraftSteps: 8,
  comfyCfg: 1,
};

const KEY = 'gatesai.imagegen.v1';

export const imageGenPersistence = createJsonPersistenceProvider<ImageGenConfig>({
  key: KEY,
  parse: raw => {
    const parsed = raw && typeof raw === 'object' ? raw as Partial<ImageGenConfig> : {};
    return normalizeImageGenConfig({
      ...DEFAULT_IMAGE_GEN_CONFIG,
      ...parsed,
    });
  },
});

export function loadImageGenConfig(): ImageGenConfig {
  return imageGenPersistence.load();
}

export function saveImageGenConfig(config: ImageGenConfig): void {
  imageGenPersistence.save(config);
}

function normalizeImageGenConfig(config: ImageGenConfig): ImageGenConfig {
  const next = { ...config };
  if (next.comfyWorkflowPath === 'notes/flux2-workflow.json') {
    delete next.comfyWorkflowPath;
  }
  if (next.backendChoice !== 'auto' && !isImageBackendId(next.backendChoice)) {
    next.backendChoice = 'auto';
  }
  // The old `backend` field was saved on every write, so a default and a pick
  // look the same, and no UI has set it since the July 2026 settings slim-down.
  // Treat it as `auto`.
  delete (next as Partial<ImageGenConfig> & { backend?: unknown }).backend;
  delete (next as Partial<ImageGenConfig> & { promptEnhancement?: unknown }).promptEnhancement;
  delete (next as Partial<ImageGenConfig> & { promptEnhancementOptIn?: unknown }).promptEnhancementOptIn;
  delete (next as Partial<ImageGenConfig> & { promptStylePreset?: unknown }).promptStylePreset;
  delete (next as Partial<ImageGenConfig> & { a1111BaseUrl?: unknown }).a1111BaseUrl;
  delete (next as Partial<ImageGenConfig> & { a1111ApiKey?: unknown }).a1111ApiKey;
  delete (next as Partial<ImageGenConfig> & { openRouterImageModelId?: unknown }).openRouterImageModelId;
  delete (next as Partial<ImageGenConfig> & { openAiImageModelId?: unknown }).openAiImageModelId;
  delete (next as Partial<ImageGenConfig> & { geminiImageModelId?: unknown }).geminiImageModelId;
  delete (next as Partial<ImageGenConfig> & { openAiImageQuality?: unknown }).openAiImageQuality;
  // Migrate legacy/default preset names into the current normal default.
  // Direct-image Draft is now selected from the model picker instead of
  // being the stored Local default.
  const preset: unknown = next.comfyQualityPreset;
  if (preset === 'final') next.comfyQualityPreset = 'full';
  else if (preset === 'draft' || preset === 'quick') {
    next.comfyQualityPreset = 'full';
    next.comfyUpscaleFactor = 1;
  }
  else if (preset !== 'full' && preset !== 'quick') {
    next.comfyQualityPreset = DEFAULT_IMAGE_GEN_CONFIG.comfyQualityPreset;
  }
  // Validate upscale factor — accept only the discrete enum values.
  if (
    typeof next.comfyUpscaleFactor !== 'number'
    || !VALID_UPSCALE_FACTORS.includes(next.comfyUpscaleFactor)
  ) {
    next.comfyUpscaleFactor = 1;
  }
  next.comfyQualitySteps = normalizeSteps(next.comfyQualitySteps, 12);
  next.comfyDraftSteps = normalizeSteps(next.comfyDraftSteps, 8);
  next.comfyCfg = normalizeCfg(next.comfyCfg);
  return next;
}

function normalizeSteps(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(50, Math.max(6, Math.round(value)));
}

function normalizeCfg(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
  return Math.min(20, Math.max(0.1, Math.round(value * 10) / 10));
}

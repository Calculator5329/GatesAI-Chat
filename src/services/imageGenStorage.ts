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

export interface ImageGenConfig {
  backend: ImageBackendId;

  /**
   * Optional path inside `/workspace/` to a custom ComfyUI workflow
   * JSON template. `{{PROMPT}}`, `{{WIDTH}}`, `{{HEIGHT}}`, `{{SEED}}`
   * get substituted before submission. Empty = use built-in SDXL
   * default.
   */
  comfyWorkflowPath?: string;

  /**
   * ComfyUI workflow preset. `full` runs the bundled FLUX.2 Klein FP8 4-step
   * workflow (with optional hires-fix); `quick` runs the SDXL Lightning
   * 4-step workflow at native resolution.
   */
  comfyQualityPreset?: ComfyQualityPreset;

  /**
   * Hires-fix multiplier applied in `full` mode. `1` (default) renders at
   * the workflow's native resolution and skips the second pass entirely.
   * Larger values pixel-upscale the decoded image and run a low-denoise
   * refinement pass at the new resolution.
   */
  comfyUpscaleFactor?: UpscaleFactor;

}

export const DEFAULT_IMAGE_GEN_CONFIG: ImageGenConfig = {
  backend: 'openrouter-image',
  comfyQualityPreset: 'full',
  comfyUpscaleFactor: 1,
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
  if (!isImageBackendId(next.backend)) {
    next.backend = 'openrouter-image';
  }
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
  const preset = next.comfyQualityPreset as unknown as string | undefined;
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
  return next;
}

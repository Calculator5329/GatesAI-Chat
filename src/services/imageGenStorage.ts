/**
 * Persistence for image-generation credentials and backend selection.
 * Separate localStorage key from `gatesai.providers.v1` so image-gen
 * backends can evolve — add BFL direct, Together, Replicate, etc.
 * without churning the LLM-provider shape.
 */

import type {
  ImageBackendId,
  ComfyQualityPreset,
  PromptEnhancementMode,
  PromptStylePreset,
  UpscaleFactor,
} from './image/types';
import { VALID_UPSCALE_FACTORS } from './image/types';

export type { ImageBackendId, ComfyQualityPreset, PromptEnhancementMode, PromptStylePreset, UpscaleFactor };

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

  /** Optional LLM pass that rewrites terse user prompts for SDXL/FLUX. */
  promptEnhancement?: PromptEnhancementMode;
  promptEnhancementOptIn?: boolean;
  promptStylePreset?: PromptStylePreset;

  /** AUTOMATIC1111 local server base URL, e.g. `http://127.0.0.1:7860`. */
  a1111BaseUrl?: string;
  a1111ApiKey?: string;
}

export const DEFAULT_IMAGE_GEN_CONFIG: ImageGenConfig = {
  backend: 'local-comfy',
  a1111BaseUrl: 'http://127.0.0.1:7860',
  comfyQualityPreset: 'quick',
  comfyUpscaleFactor: 1,
  promptEnhancement: 'off',
  promptEnhancementOptIn: false,
  promptStylePreset: 'auto',
};

const KEY = 'gatesai.imagegen.v1';

export function loadImageGenConfig(): ImageGenConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_IMAGE_GEN_CONFIG };
    const parsed = JSON.parse(raw) as Partial<ImageGenConfig>;
    return normalizeImageGenConfig({
      ...DEFAULT_IMAGE_GEN_CONFIG,
      ...(parsed && typeof parsed === 'object' ? parsed : {}),
    });
  } catch {
    return { ...DEFAULT_IMAGE_GEN_CONFIG };
  }
}

export function saveImageGenConfig(config: ImageGenConfig): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(config));
  } catch {
    // ignore quota / privacy-mode failures
  }
}

function normalizeImageGenConfig(config: ImageGenConfig): ImageGenConfig {
  const next = { ...config };
  if (next.comfyWorkflowPath === 'notes/flux2-workflow.json') {
    delete next.comfyWorkflowPath;
  }
  if (next.promptEnhancement === 'llm' && next.promptEnhancementOptIn !== true) {
    next.promptEnhancement = 'off';
  }
  if (next.backend !== 'local-comfy' && next.backend !== 'local-a1111') {
    next.backend = 'local-comfy';
  }
  // Migrate legacy preset names. The values were renamed for clarity:
  //   'final' -> 'full' (the upscale-capable Klein workflow)
  //   'draft' -> 'quick' (the SDXL Lightning workflow)
  // Stored snapshots from before the rename still load cleanly.
  const preset = next.comfyQualityPreset as unknown as string | undefined;
  if (preset === 'final') next.comfyQualityPreset = 'full';
  else if (preset === 'draft') next.comfyQualityPreset = 'quick';
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

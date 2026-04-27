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
} from './image/types';

export type { ImageBackendId, ComfyQualityPreset, PromptEnhancementMode, PromptStylePreset };

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
   * ComfyUI workflow preset. `final` uses the user workflow path / built-in
   * SDXL default; `draft` uses the built-in SDXL Lightning 4-step workflow.
   */
  comfyQualityPreset?: ComfyQualityPreset;

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
  comfyQualityPreset: 'draft',
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
  return next;
}

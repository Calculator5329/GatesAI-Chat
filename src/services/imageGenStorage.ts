/**
 * Persistence for image-generation credentials and backend selection.
 * Separate localStorage key from `gatesai.providers.v1` so image-gen
 * backends can evolve — add BFL direct, Together, Replicate, etc.
 * without churning the LLM-provider shape.
 */

export type ImageGenBackend = 'fal' | 'bfl' | 'local-comfy' | 'local-a1111';
export type ComfyQualityPreset = 'final' | 'draft';

export interface ImageGenConfig {
  backend: ImageGenBackend;
  falApiKey?: string;
  bflApiKey?: string;

  /** ComfyUI local server base URL, e.g. `http://127.0.0.1:8188`. */
  comfyBaseUrl?: string;

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

  /** AUTOMATIC1111 local server base URL, e.g. `http://127.0.0.1:7860`. */
  a1111BaseUrl?: string;
  a1111ApiKey?: string;

  /**
   * When a local backend fails, try this cloud backend automatically.
   * `null` disables the fallback.
   */
  fallbackBackend?: ImageGenBackend | null;

  /** Default cloud variant used when the tool doesn't specify one. */
  defaultVariant?: 'flux-2-pro' | 'flux-2-flex' | 'flux-2-dev';
}

export const DEFAULT_IMAGE_GEN_CONFIG: ImageGenConfig = {
  backend: 'fal',
  defaultVariant: 'flux-2-pro',
  comfyBaseUrl: 'http://127.0.0.1:8188',
  a1111BaseUrl: 'http://127.0.0.1:7860',
  fallbackBackend: 'fal',
  comfyQualityPreset: 'draft',
};

const KEY = 'gatesai.imagegen.v1';

export function loadImageGenConfig(): ImageGenConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_IMAGE_GEN_CONFIG };
    const parsed = JSON.parse(raw) as Partial<ImageGenConfig>;
    return {
      ...DEFAULT_IMAGE_GEN_CONFIG,
      ...(parsed && typeof parsed === 'object' ? parsed : {}),
    };
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

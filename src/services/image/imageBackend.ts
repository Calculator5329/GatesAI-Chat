// Implements image-generation backend behavior for imageBackend.
// Called by ImageJobStore and image tools; depends on provider configs, ComfyUI/OpenRouter APIs, and bridge file writes.
// Invariant: backend clients return normalized job artifacts and leave queue ownership to ImageJobStore.
import type {
  GenerateImageRequest,
  GenerateImageResult,
  ImageBackend,
  ImageBackendId,
  ImageBackendSnapshot,
} from './types';

/**
 * Configuration the dispatcher consumes for one tool call. Extends the
 * UI-facing {@link ImageBackendSnapshot} with two fields the tool
 * resolves before dispatching: a parsed Comfy workflow template (loaded
 * from /workspace/) and an injectable fetch for tests.
 */
export interface ImageBackendConfig extends ImageBackendSnapshot {
  comfyWorkflowTemplate?: Record<string, unknown>;
  /** Injectable for tests. */
  fetch?: typeof fetch;
}

const OPENROUTER_KEY_MISSING = 'OpenRouter API key is required for GPT-5.4 Image 2. Add one under Models → OpenRouter.';

/**
 * Auto routing lands on OpenRouter without a key only when no ComfyUI is
 * running (a running one wins then), so the message leads with local. It
 * avoids the words ImageJobCard's advice matcher keys on ("no image", "api key").
 */
const NO_IMAGE_BACKEND_READY = 'No backend can make images yet. Start ComfyUI or ComfyUI Desktop with an image model '
  + '(Settings > Models > Local shows what is missing), or add an OpenRouter key under Settings > Models.';

/**
 * Resolves the caller's configured `primary` into a concrete
 * {@link ImageBackend}. Returns `null` with a reason when the
 * backend can't be instantiated (missing key, missing base URL, etc.)
 * so the tool can surface the message verbatim.
 */
export async function resolveBackend(
  id: ImageBackendId,
  config: ImageBackendConfig,
): Promise<{ backend: ImageBackend } | { error: string }> {
  const fetchImpl = config.fetch;
  switch (id) {
    case 'local-comfy': {
      if (!config.comfyBaseUrl) return { error: 'no ComfyUI address configured. Start ComfyUI or ComfyUI Desktop on this computer; GatesAI looks for it on ports 8188 and 8000.' };
      const discovery = config.comfyDiscovery;
      if (discovery?.online && !discovery.preset && !config.comfyWorkflowTemplate) {
        return {
          error: `ComfyUI is running at ${discovery.baseUrl} but has no image model GatesAI can use. `
            + 'Put a model such as sdxl_lightning_4step.safetensors in its models/checkpoints folder, then try again.',
        };
      }
      const { ComfyClient } = await import('./comfyClient');
      return {
        backend: new ComfyClient({
          baseUrl: config.comfyBaseUrl,
          discovery,
          workflowTemplate: config.comfyWorkflowTemplate,
          qualityPreset: config.comfyQualityPreset,
          upscaleFactor: config.comfyUpscaleFactor,
          qualitySteps: config.comfyQualitySteps,
          draftSteps: config.comfyDraftSteps,
          cfg: config.comfyCfg,
          fetch: fetchImpl,
        }),
      };
    }
    case 'openrouter-image': {
      if (!config.openRouterApiKey) return { error: config.comfyDiscovery?.online ? OPENROUTER_KEY_MISSING : NO_IMAGE_BACKEND_READY };
      const { OpenRouterImageClient } = await import('./openrouterImageClient');
      return { backend: new OpenRouterImageClient({ apiKey: config.openRouterApiKey, fetch: fetchImpl }) };
    }
  }
}

export interface DispatchResult {
  result: GenerateImageResult;
}

/**
 * Runs the configured backend. Errors propagate to the caller.
 */
export async function dispatchImageGenerate(
  req: GenerateImageRequest,
  config: ImageBackendConfig,
): Promise<DispatchResult> {
  const primary = await resolveBackend(config.primary, config);
  if ('error' in primary) {
    throw new Error(primary.error);
  }
  const result = await primary.backend.generate(req);
  return { result };
}

import { ComfyClient } from './comfyClient';
import { OpenRouterImageClient } from './openrouterImageClient';
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

/**
 * Resolves the caller's configured `primary` into a concrete
 * {@link ImageBackend}. Returns `null` with a reason when the
 * backend can't be instantiated (missing key, missing base URL, etc.)
 * so the tool can surface the message verbatim.
 */
export function resolveBackend(
  id: ImageBackendId,
  config: ImageBackendConfig,
): { backend: ImageBackend } | { error: string } {
  const fetchImpl = config.fetch;
  switch (id) {
    case 'local-comfy': {
      if (!config.comfyBaseUrl) return { error: 'no ComfyUI base URL configured. Open Local and start/configure ComfyUI (default http://127.0.0.1:8188).' };
      return {
        backend: new ComfyClient({
          baseUrl: config.comfyBaseUrl,
          workflowTemplate: config.comfyWorkflowTemplate,
          qualityPreset: config.comfyQualityPreset,
          upscaleFactor: config.comfyUpscaleFactor,
          fetch: fetchImpl,
        }),
      };
    }
    case 'openrouter-image': {
      if (!config.openRouterApiKey) return { error: 'OpenRouter API key is required for GPT-5.4 Image 2. Add one under Menu -> API -> OpenRouter.' };
      return { backend: new OpenRouterImageClient({ apiKey: config.openRouterApiKey, fetch: fetchImpl }) };
    }
  }
}

export interface DispatchResult {
  result: GenerateImageResult;
}

/**
 * Run the configured ComfyUI backend. Errors propagate to the caller.
 */
export async function dispatchImageGenerate(
  req: GenerateImageRequest,
  config: ImageBackendConfig,
): Promise<DispatchResult> {
  const primary = resolveBackend(config.primary, config);
  if ('error' in primary) {
    throw new Error(primary.error);
  }
  const result = await primary.backend.generate(req);
  return { result };
}

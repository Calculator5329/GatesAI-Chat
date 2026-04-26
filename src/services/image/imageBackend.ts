import { A1111Client } from './a1111Client';
import { ComfyClient } from './comfyClient';
import { FluxClient } from './fluxClient';
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
    case 'fal': {
      if (!config.falApiKey) return { error: 'no fal.ai API key configured. Open Settings → API and paste a key under "Image generation" to enable this backend.' };
      return { backend: new FluxClient({ apiKey: config.falApiKey, fetch: fetchImpl }) };
    }
    case 'bfl':
      return { error: 'BFL backend is not implemented yet. Switch to fal.ai or a local backend in Settings → API.' };
    case 'local-comfy': {
      if (!config.comfyBaseUrl) return { error: 'no ComfyUI base URL configured. Open Settings → API and set it (default http://127.0.0.1:8188).' };
      return {
        backend: new ComfyClient({
          baseUrl: config.comfyBaseUrl,
          workflowTemplate: config.comfyWorkflowTemplate,
          qualityPreset: config.comfyQualityPreset,
          fetch: fetchImpl,
        }),
      };
    }
    case 'local-a1111': {
      if (!config.a1111BaseUrl) return { error: 'no AUTOMATIC1111 base URL configured. Open Settings → API and set it (default http://127.0.0.1:7860).' };
      return {
        backend: new A1111Client({
          baseUrl: config.a1111BaseUrl,
          apiKey: config.a1111ApiKey,
          fetch: fetchImpl,
        }),
      };
    }
  }
}

export interface DispatchResult {
  result: GenerateImageResult;
  /** Set when the primary backend failed and we fell back. */
  fallbackNote?: string;
}

/**
 * Try the configured primary backend. If it's a `local-*` backend and
 * it throws, and a `fallback` is configured with usable credentials,
 * retry against the fallback. Cloud backends never auto-fall-back —
 * a 402 / 429 there is a signal the user wants to see.
 */
export async function dispatchImageGenerate(
  req: GenerateImageRequest,
  config: ImageBackendConfig,
): Promise<DispatchResult> {
  const primary = resolveBackend(config.primary, config);
  if ('error' in primary) {
    // Try fallback straight away if the primary can't even instantiate.
    if (shouldAttemptFallback(config)) {
      return runFallback(req, config, primary.error);
    }
    throw new Error(primary.error);
  }

  try {
    const result = await primary.backend.generate(req);
    return { result };
  } catch (err) {
    if (isLocalBackend(config.primary) && shouldAttemptFallback(config)) {
      return runFallback(req, config, (err as Error).message);
    }
    throw err;
  }
}

async function runFallback(
  req: GenerateImageRequest,
  config: ImageBackendConfig,
  primaryError: string,
): Promise<DispatchResult> {
  const fallbackId = config.fallback;
  if (!fallbackId) throw new Error(primaryError);
  const resolved = resolveBackend(fallbackId, config);
  if ('error' in resolved) {
    throw new Error(`${primaryError} · fallback unavailable: ${resolved.error}`);
  }
  const result = await resolved.backend.generate(req);
  return {
    result,
    fallbackNote: `${config.primary} failed (${truncate(primaryError, 120)}); fell back to ${fallbackId}`,
  };
}

function isLocalBackend(id: ImageBackendId): boolean {
  return id === 'local-comfy' || id === 'local-a1111';
}

function shouldAttemptFallback(config: ImageBackendConfig): boolean {
  if (!config.fallback) return false;
  if (config.fallback === config.primary) return false;
  return !('error' in resolveBackend(config.fallback, config));
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

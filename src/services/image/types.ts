/**
 * Shared request / response shapes for every image-generation backend.
 *
 * The `image_generate` tool speaks this vocabulary; individual backends
 * (fal.ai, ComfyUI, A1111, BFL, Replicate…) adapt it to whatever their
 * API wants. Keeping the tool pinned to this shape is what lets us add
 * backends without touching the tool contract.
 */

export type FluxVariant = 'flux-2-pro' | 'flux-2-flex' | 'flux-2-dev';

export type ImageAspectRatio = '1:1' | '3:2' | '2:3' | '16:9' | '9:16';

export interface GenerateImageRequest {
  prompt: string;
  aspectRatio?: ImageAspectRatio;
  seed?: number;
  /**
   * Advisory hint for cloud backends. Local backends ignore this —
   * they use whatever checkpoint the user has loaded.
   */
  variant?: FluxVariant;
  /** Optional full endpoint override (fal only). */
  endpointOverride?: string;
}

export interface GenerateImageResult {
  /** Raw image bytes, base64-encoded (no `data:` prefix). */
  base64: string;
  mime: string;
  width?: number;
  height?: number;
  seed?: number;
  /** Debug breadcrumb — which URL actually served the image. */
  endpoint: string;
  /** Which backend produced this image. */
  backend: ImageBackendId;
}

export type ImageBackendId = 'fal' | 'bfl' | 'local-comfy' | 'local-a1111';

export type ComfyQualityPreset = 'final' | 'draft';

/**
 * Plain JSON-serializable snapshot of the user's image-gen settings,
 * resolved at tool-call time and consumed by the dispatcher and tools.
 * Source of truth for the shape; `services/tools/types.ts` re-exports it.
 *
 * Kept JSON-serializable on purpose: a future `ImageJobStore` will persist
 * one snapshot per queued job so mid-run settings changes don't corrupt
 * in-flight batches.
 */
export interface ImageBackendSnapshot {
  primary: ImageBackendId;
  falApiKey?: string;
  bflApiKey?: string;
  comfyBaseUrl?: string;
  comfyQualityPreset?: ComfyQualityPreset;
  a1111BaseUrl?: string;
  a1111ApiKey?: string;
  fallback?: ImageBackendId | null;
  /**
   * Default cloud variant the tool falls back to when the model
   * doesn't pick one. Local backends ignore this.
   */
  defaultVariant?: FluxVariant;
}

export interface ImageBackend {
  readonly id: ImageBackendId;
  generate(req: GenerateImageRequest): Promise<GenerateImageResult>;
}

/** Concrete pixel dims for each aspect-ratio slug. */
export function dimsForAspect(ratio: ImageAspectRatio): { width: number; height: number } {
  switch (ratio) {
    case '1:1': return { width: 1024, height: 1024 };
    case '3:2': return { width: 1216, height: 832 };
    case '2:3': return { width: 832, height: 1216 };
    case '16:9': return { width: 1344, height: 768 };
    case '9:16': return { width: 768, height: 1344 };
  }
}

/** Encode a byte array as base64 without blowing the call stack on large images. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function mimeFromUrl(url: string): string {
  const lower = url.toLowerCase().split('?')[0];
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/png';
}

export async function safeText(resp: Response): Promise<string> {
  try { return (await resp.text()).slice(0, 500); } catch { return ''; }
}

/**
 * Native `fetch` must not be called as a method of an arbitrary object — doing
 * `this.fetch = fetch; this.fetch(url)` makes `this` the wrong receiver and
 * throws "Illegal invocation" in WebView. Wrap so a stored implementation is
 * always invoked as a plain function; optional override is for tests.
 */
export function wrapGlobalFetch(override?: typeof fetch): typeof fetch {
  if (override) {
    return (input, init) => override(input, init);
  }
  return (input, init) => globalThis.fetch(input, init);
}

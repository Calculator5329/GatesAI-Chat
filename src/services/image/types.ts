/**
 * Shared request / response shapes for every image-generation backend.
 *
 * The `image_generate` tool speaks this vocabulary; individual backends
 * ComfyUI adapts it to its API. Keeping the tool pinned to this shape is what
 * lets us add future backends without touching the tool contract.
 */

export const IMAGE_ASPECT_RATIOS = ['1:1', '3:2', '2:3', '16:9', '9:16'] as const;
export type ImageAspectRatio = typeof IMAGE_ASPECT_RATIOS[number];

export interface GenerateImageRequest {
  prompt: string;
  aspectRatio?: ImageAspectRatio;
  width?: number;
  height?: number;
  seed?: number;
  /**
   * Optional filename hint. ComfyUI uses this to control where the file lands
   * in its own output folder via the SaveImage prefix.
   */
  filenamePrefix?: string;
}

/**
 * Generation result. Producers return EITHER a hosted URL the UI can render
 * directly OR raw bytes the runner needs to persist. Local backends that
 * already save to disk (ComfyUI) return a `url`; everything else returns
 * `base64`. Exactly one of `{url, base64}` is set.
 */
export interface GenerateImageResult {
  /** Raw image bytes, base64-encoded (no `data:` prefix). Set when the runner
   *  needs to persist the image itself. Mutually exclusive with `url`. */
  base64?: string;
  /** Hosted URL the UI can use directly as `<img src>`. Set when the backend
   *  already wrote the file to a server it controls. Mutually exclusive
   *  with `base64`. */
  url?: string;
  mime: string;
  width?: number;
  height?: number;
  seed?: number;
  /** Debug breadcrumb — which URL actually served the image. */
  endpoint: string;
  /** Which backend produced this image. */
  backend: ImageBackendId;
}

export type ImageBackendId =
  | 'local-comfy';

/**
 * ComfyUI workflow preset.
 * - `full` runs the bundled FLUX.2 Klein 4B FP8 4-step workflow. With
 *   `upscaleFactor > 1` it appends a hires-fix pass.
 * - `quick` runs the bundled SDXL Lightning 4-step workflow. Always native
 *   resolution, no hires.
 */
export type ComfyQualityPreset = 'full' | 'quick';

/**
 * User-facing local ComfyUI modes. These are exposed as direct-image
 * "models"; the backend still consumes the existing preset/upscale fields.
 */
export type LocalComfyMode = 'draft' | 'normal' | 'upscale';

/**
 * Hires-fix multiplier for `full` mode. `1` skips the hires-fix pass
 * entirely (fastest path); `1.5`/`2`/`2.5`/`3` decode the base latent,
 * pixel-upscale with lanczos, VAE-encode back, and run a partial-denoise
 * refinement pass at the larger resolution.
 */
export type UpscaleFactor = 1 | 1.5 | 2 | 2.5 | 3;
export const VALID_UPSCALE_FACTORS: readonly UpscaleFactor[] = [1, 1.5, 2, 2.5, 3];

export function comfySettingsForMode(mode: LocalComfyMode): Pick<ImageBackendSnapshot, 'comfyQualityPreset' | 'comfyUpscaleFactor'> {
  switch (mode) {
    case 'draft':
      return { comfyQualityPreset: 'quick', comfyUpscaleFactor: 1 };
    case 'normal':
      return { comfyQualityPreset: 'full', comfyUpscaleFactor: 1 };
    case 'upscale':
      return { comfyQualityPreset: 'full', comfyUpscaleFactor: 2 };
  }
}

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
  comfyBaseUrl?: string;
  comfyQualityPreset?: ComfyQualityPreset;
  comfyUpscaleFactor?: UpscaleFactor;
}

export interface ImageBackend {
  readonly id: ImageBackendId;
  generate(req: GenerateImageRequest): Promise<GenerateImageResult>;
}

export function isImageAspectRatio(value: unknown): value is ImageAspectRatio {
  return typeof value === 'string' && IMAGE_ASPECT_RATIOS.includes(value as ImageAspectRatio);
}

export function isLocalImageBackend(id: ImageBackendId): boolean {
  return id === 'local-comfy';
}

export function isImageBackendId(value: unknown): value is ImageBackendId {
  return typeof value === 'string'
    && value === 'local-comfy';
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

export interface ImageDimensions {
  width: number;
  height: number;
}

const MIN_IMAGE_DIMENSION = 64;
const MAX_IMAGE_DIMENSION = 4096;

export function validateExplicitDimensions(width: unknown, height: unknown): string | null {
  if (width === undefined && height === undefined) return null;
  if (width === undefined || height === undefined) return 'Both width and height are required when requesting explicit pixel dimensions.';
  if (typeof width !== 'number' || typeof height !== 'number') return 'Image width and height must be numbers.';
  if (!Number.isFinite(width) || !Number.isFinite(height)) return 'Image width and height must be finite numbers.';
  if (!Number.isInteger(width) || !Number.isInteger(height)) return 'Image width and height must be whole numbers.';
  if (width < MIN_IMAGE_DIMENSION || height < MIN_IMAGE_DIMENSION) return `Image width and height must be at least ${MIN_IMAGE_DIMENSION}px.`;
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) return `Image width and height must be at most ${MAX_IMAGE_DIMENSION}px.`;
  if (width % 16 !== 0 || height % 16 !== 0) return 'Image width and height must be multiples of 16 for local image generation.';
  return null;
}

export function dimsForRequest(
  req: Pick<GenerateImageRequest, 'aspectRatio' | 'width' | 'height'>,
  options: { allowExplicit?: boolean } = {},
): ImageDimensions {
  const allowExplicit = options.allowExplicit ?? true;
  if (allowExplicit && req.width !== undefined && req.height !== undefined) {
    const validationError = validateExplicitDimensions(req.width, req.height);
    if (validationError) throw new Error(validationError);
    return { width: req.width, height: req.height };
  }
  return dimsForAspect(req.aspectRatio ?? '1:1');
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

import {
  bytesToBase64,
  dimsForAspect,
  mimeFromUrl,
  safeText,
  wrapGlobalFetch,
  type FluxVariant,
  type GenerateImageRequest,
  type GenerateImageResult,
  type ImageBackend,
} from './types';

/**
 * Stateless client for fal.ai FLUX image generation. Owns only the
 * request-shape and response-shape; credentials and backend selection
 * live in {@link ImageGenStore}.
 *
 * Why fal's synchronous endpoints: the `fal.run/<model>` surface blocks
 * until the image is ready and returns `{images: [{url, ...}]}`. We
 * then fetch the image bytes ourselves so the tool can write them
 * through the bridge without depending on long-lived URLs.
 *
 * Endpoints here target FLUX 2.x. fal occasionally renames slugs; if
 * the request fails with 404/400 the user can override via
 * `endpointOverride` when the variant is invalid for their account.
 */

export type { FluxVariant } from './types';

export interface FluxClientDeps {
  apiKey: string;
  /** Injectable for tests. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

const ENDPOINTS: Record<FluxVariant, string> = {
  'flux-2-pro': 'https://fal.run/fal-ai/flux-pro/v2',
  'flux-2-flex': 'https://fal.run/fal-ai/flux/v2/flex',
  'flux-2-dev': 'https://fal.run/fal-ai/flux/v2/dev',
};

interface FalImage {
  url: string;
  width?: number;
  height?: number;
  content_type?: string;
}

interface FalImagesResponse {
  images?: FalImage[];
  seed?: number;
}

export class FluxClient implements ImageBackend {
  readonly id = 'fal' as const;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(deps: FluxClientDeps) {
    this.apiKey = deps.apiKey;
    this.fetchImpl = wrapGlobalFetch(deps.fetch);
  }

  async generate(req: GenerateImageRequest): Promise<GenerateImageResult> {
    const variant: FluxVariant = req.variant ?? 'flux-2-pro';
    const endpoint = req.endpointOverride ?? ENDPOINTS[variant];
    const aspect = req.aspectRatio ?? '1:1';
    const { width, height } = dimsForAspect(aspect);

    const body: Record<string, unknown> = {
      prompt: req.prompt,
      image_size: { width, height },
      num_images: 1,
      enable_safety_checker: true,
    };
    if (typeof req.seed === 'number') body.seed = req.seed;

    const resp = await this.fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Key ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await safeText(resp);
      throw new Error(`fal ${resp.status} ${resp.statusText}: ${text || '(no body)'} [${endpoint}]`);
    }

    const data = (await resp.json()) as FalImagesResponse;
    const first = data.images?.[0];
    if (!first?.url) {
      throw new Error(`fal response missing image url [${endpoint}]`);
    }

    const imgResp = await this.fetchImpl(first.url);
    if (!imgResp.ok) {
      throw new Error(`download failed ${imgResp.status} ${imgResp.statusText} for ${first.url}`);
    }
    const buf = new Uint8Array(await imgResp.arrayBuffer());
    const base64 = bytesToBase64(buf);

    return {
      base64,
      mime: first.content_type ?? mimeFromUrl(first.url),
      width: first.width,
      height: first.height,
      seed: data.seed,
      endpoint,
      backend: 'fal',
    };
  }
}

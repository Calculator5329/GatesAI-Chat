import {
  dimsForRequest,
  safeText,
  wrapGlobalFetch,
  type GenerateImageRequest,
  type GenerateImageResult,
  type ImageBackend,
} from './types';

/**
 * Minimal client for AUTOMATIC1111's WebUI (txt2img). We use the
 * `/sdapi/v1/txt2img` endpoint because it returns base64 images
 * synchronously — no polling, no file-path shuffling.
 *
 * Whatever checkpoint the user has selected in A1111's UI is what
 * runs. We don't try to enumerate or switch models from here —
 * checkpoint management is the user's responsibility, matching
 * ComfyUI's philosophy.
 *
 * Security: the default assumption is that the A1111 server is a
 * local process on 127.0.0.1; we pass the configured baseUrl through
 * to `fetch` unchanged, so CORS behavior is up to the server.
 */
export interface A1111ClientDeps {
  baseUrl: string;
  apiKey?: string;
  /** Injectable for tests. */
  fetch?: typeof fetch;
}

interface A1111Response {
  images?: string[];
  parameters?: Record<string, unknown>;
  info?: string;
}

export class A1111Client implements ImageBackend {
  readonly id = 'local-a1111' as const;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(deps: A1111ClientDeps) {
    this.baseUrl = deps.baseUrl.replace(/\/+$/, '');
    this.apiKey = deps.apiKey;
    this.fetchImpl = wrapGlobalFetch(deps.fetch);
  }

  async generate(req: GenerateImageRequest): Promise<GenerateImageResult> {
    const { width, height } = dimsForRequest(req);
    const endpoint = `${this.baseUrl}/sdapi/v1/txt2img`;

    const body: Record<string, unknown> = {
      prompt: req.prompt,
      width,
      height,
      steps: 25,
      cfg_scale: 5,
      sampler_name: 'DPM++ 2M',
      n_iter: 1,
      batch_size: 1,
    };
    if (typeof req.seed === 'number') body.seed = req.seed;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const resp = await this.fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await safeText(resp);
      throw new Error(`a1111 ${resp.status} ${resp.statusText}: ${text || '(no body)'} [${endpoint}]`);
    }

    const data = (await resp.json()) as A1111Response;
    const base64 = data.images?.[0];
    if (!base64) {
      throw new Error(`a1111 response missing images array [${endpoint}]`);
    }

    const seed = parseSeedFromInfo(data.info);

    return {
      base64,
      mime: 'image/png',
      width,
      height,
      seed,
      endpoint,
      backend: 'local-a1111',
    };
  }
}

function parseSeedFromInfo(info: string | undefined): number | undefined {
  if (!info) return undefined;
  try {
    // A1111 stuffs the resolved seed into `info` as a JSON-encoded string.
    const parsed = JSON.parse(info) as { seed?: number };
    return typeof parsed.seed === 'number' ? parsed.seed : undefined;
  } catch {
    // Some builds return a plain string; best-effort regex fallback.
    const m = /seed:\s*(\d+)/i.exec(info);
    return m ? Number(m[1]) : undefined;
  }
}

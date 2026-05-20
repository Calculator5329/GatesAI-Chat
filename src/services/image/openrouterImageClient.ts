import type { GenerateImageRequest, GenerateImageResult, ImageBackend } from './types';
import { safeText, wrapGlobalFetch } from './types';

export const OPENROUTER_IMAGE_MODEL_ID = 'openai/gpt-5.4-image-2';
const OPENROUTER_IMAGE_TIMEOUT_MS = 180_000;

interface OpenRouterImageClientOptions {
  apiKey?: string;
  fetch?: typeof fetch;
}

interface DataUrlImage {
  mime: string;
  base64: string;
}

export class OpenRouterImageClient implements ImageBackend {
  readonly id = 'openrouter-image' as const;
  private readonly apiKey?: string;
  private readonly fetch: typeof fetch;

  constructor(opts: OpenRouterImageClientOptions) {
    this.apiKey = opts.apiKey;
    this.fetch = wrapGlobalFetch(opts.fetch);
  }

  async generate(req: GenerateImageRequest): Promise<GenerateImageResult> {
    if (!this.apiKey) {
      throw new Error('OpenRouter API key is required for GPT-5.4 Image 2. Add one under Menu -> API -> OpenRouter.');
    }
    const prompt = req.prompt.trim();
    if (!prompt) throw new Error('Image prompt is required.');
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), OPENROUTER_IMAGE_TIMEOUT_MS);
    const signal = combineAbortSignals(req.signal, timeoutController.signal);

    let resp: Response;
    try {
      resp = await this.fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'http://localhost',
          'X-Title': 'GatesAI Chat',
        },
        signal,
        body: JSON.stringify({
          model: OPENROUTER_IMAGE_MODEL_ID,
          modalities: ['image', 'text'],
          stream: false,
          image_config: { aspect_ratio: aspectRatioForRequest(req) },
          messages: [{ role: 'user', content: prompt }],
        }),
      });
    } catch (err) {
      if (req.signal?.aborted) {
        throw new Error('OpenRouter image generation cancelled.');
      }
      if (timeoutController.signal.aborted) {
        throw new Error(`OpenRouter image generation timed out after ${Math.round(OPENROUTER_IMAGE_TIMEOUT_MS / 1000)}s.`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    if (!resp.ok) {
      const text = await safeText(resp);
      throw new Error(`OpenRouter image generation failed ${resp.status} ${resp.statusText}: ${text || '(no body)'}`);
    }

    const payload = await resp.json() as unknown;
    const image = extractFirstDataUrlImage(payload);
    if (!image) {
      const text = extractAssistantText(payload);
      throw new Error(`OpenRouter returned no generated image${text ? `: ${text}` : '.'}`);
    }
    const costUsd = extractUsageCost(payload);

    return {
      base64: image.base64,
      mime: image.mime,
      endpoint: `openrouter:${OPENROUTER_IMAGE_MODEL_ID}`,
      backend: this.id,
      width: req.width,
      height: req.height,
      seed: req.seed,
      ...(costUsd !== undefined ? { costUsd } : {}),
    };
  }
}

export function extractFirstDataUrlImage(value: unknown): DataUrlImage | null {
  const structured = extractStructuredImageUrl(value);
  if (structured) return parseDataUrl(structured);
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
  return parseDataUrl(text);
}

function parseDataUrl(text: string): DataUrlImage | null {
  const match = /data:(image\/(?:png|jpe?g|webp|gif));base64,([A-Za-z0-9+/=]+)/i.exec(text);
  if (!match) return null;
  const mime = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
  return { mime, base64: match[2] };
}

function extractStructuredImageUrl(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const choices = (value as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return null;
  for (const choice of choices) {
    const message = (choice as { message?: unknown }).message;
    if (!message || typeof message !== 'object') continue;
    const images = (message as { images?: unknown }).images;
    if (!Array.isArray(images)) continue;
    for (const image of images) {
      if (!image || typeof image !== 'object') continue;
      const snake = (image as { image_url?: { url?: unknown } }).image_url?.url;
      if (typeof snake === 'string') return snake;
      const camel = (image as { imageUrl?: { url?: unknown } }).imageUrl?.url;
      if (typeof camel === 'string') return camel;
    }
  }
  return null;
}

function extractAssistantText(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const choices = (value as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return '';
  const content = (choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content;
  if (typeof content === 'string') return content.slice(0, 300);
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') return (part as { text: string }).text;
        return '';
      })
      .filter(Boolean)
      .join(' ')
      .slice(0, 300);
  }
  return '';
}

function extractUsageCost(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const cost = (value as { usage?: { cost?: unknown } }).usage?.cost;
  return typeof cost === 'number' && Number.isFinite(cost) ? cost : undefined;
}

function aspectRatioForRequest(req: GenerateImageRequest): string {
  if (req.aspectRatio) return req.aspectRatio;
  if (!req.width || !req.height) return '1:1';
  const ratio = req.width / req.height;
  if (Math.abs(ratio - 1) < 0.05) return '1:1';
  if (ratio > 1.5) return '16:9';
  if (ratio > 1) return '3:2';
  if (ratio < 0.7) return '9:16';
  return '2:3';
}

function combineAbortSignals(...signals: Array<AbortSignal | undefined>): AbortSignal {
  const active = signals.filter(Boolean) as AbortSignal[];
  if (active.length === 1) return active[0];
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of active) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener('abort', abort, { once: true });
  }
  return controller.signal;
}

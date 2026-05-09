import type { GenerateImageRequest, GenerateImageResult, ImageBackend } from './types';
import { safeText, wrapGlobalFetch } from './types';

export const OPENROUTER_IMAGE_MODEL_ID = 'openai/gpt-5.4-image-2';

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

    const resp = await this.fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'http://localhost',
        'X-Title': 'GatesAI Chat',
      },
      body: JSON.stringify({
        model: OPENROUTER_IMAGE_MODEL_ID,
        modalities: ['image', 'text'],
        messages: [{ role: 'user', content: prompt }],
      }),
    });

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

    return {
      base64: image.base64,
      mime: image.mime,
      endpoint: `openrouter:${OPENROUTER_IMAGE_MODEL_ID}`,
      backend: this.id,
      width: req.width,
      height: req.height,
      seed: req.seed,
    };
  }
}

export function extractFirstDataUrlImage(value: unknown): DataUrlImage | null {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
  const match = /data:(image\/(?:png|jpe?g|webp|gif));base64,([A-Za-z0-9+/=]+)/i.exec(text);
  if (!match) return null;
  const mime = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
  return { mime, base64: match[2] };
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

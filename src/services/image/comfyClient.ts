import {
  bytesToBase64,
  dimsForAspect,
  safeText,
  wrapGlobalFetch,
  type GenerateImageRequest,
  type GenerateImageResult,
  type ImageBackend,
} from './types';

/**
 * Client for ComfyUI's `/prompt` API. ComfyUI runs arbitrary node
 * graphs; to keep the tool contract portable (the model calls
 * `image_generate` with `{prompt, aspect_ratio, …}` and doesn't know
 * ComfyUI exists) we ship a **default workflow template** with
 * `{{PROMPT}}`, `{{WIDTH}}`, `{{HEIGHT}}`, `{{SEED}}` tokens.
 *
 * Users running non-default checkpoints or ControlNet pipelines can
 * point the `workflowTemplate` override at their own JSON, using the
 * same tokens. That keeps the tool schema stable while accommodating
 * the "every user has a bespoke workflow" reality of ComfyUI.
 *
 * Protocol:
 *   1. POST `/prompt` with `{prompt: <workflow>}` → `{prompt_id}`.
 *   2. Poll `/history/<prompt_id>` until it appears with outputs.
 *   3. For each output image, GET `/view?filename=…&subfolder=…&type=output`.
 *
 * Failure modes surfaced to the caller as `Error` with the ComfyUI
 * response body so the tool can return a model-readable message.
 */
export interface ComfyClientDeps {
  baseUrl: string;
  clientId?: string;
  /** Override the default SDXL txt2img template. */
  workflowTemplate?: Record<string, unknown>;
  /** Built-in workflow choice when no explicit template is supplied. */
  qualityPreset?: 'final' | 'draft';
  /** How many times to poll /history. 120 × 500ms = 60s default. */
  maxPollAttempts?: number;
  pollIntervalMs?: number;
  /** Injectable clock + fetch for tests. */
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_POLL_ATTEMPTS = 120;
const DEFAULT_POLL_INTERVAL = 500;

/**
 * A minimal SDXL-compatible txt2img workflow. Node ids match ComfyUI
 * conventions; any SDXL checkpoint named `sd_xl_base_1.0.safetensors`
 * will light up out of the box. Users with different checkpoint
 * names should provide their own template.
 */
const DEFAULT_SDXL_WORKFLOW: Record<string, unknown> = {
  '3': {
    class_type: 'KSampler',
    inputs: {
      seed: '{{SEED}}', steps: 25, cfg: 5, sampler_name: 'dpmpp_2m',
      scheduler: 'karras', denoise: 1,
      model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0],
    },
  },
  '4': {
    class_type: 'CheckpointLoaderSimple',
    inputs: { ckpt_name: 'sd_xl_base_1.0.safetensors' },
  },
  '5': {
    class_type: 'EmptyLatentImage',
    inputs: { width: '{{WIDTH}}', height: '{{HEIGHT}}', batch_size: 1 },
  },
  '6': {
    class_type: 'CLIPTextEncode',
    inputs: { text: '{{PROMPT}}', clip: ['4', 1] },
  },
  '7': {
    class_type: 'CLIPTextEncode',
    inputs: { text: 'blurry, low quality, watermark', clip: ['4', 1] },
  },
  '8': {
    class_type: 'VAEDecode',
    inputs: { samples: ['3', 0], vae: ['4', 2] },
  },
  '9': {
    class_type: 'SaveImage',
    inputs: { filename_prefix: 'gatesai', images: ['8', 0] },
  },
};

const SDXL_LIGHTNING_4STEP_WORKFLOW: Record<string, unknown> = {
  '3': {
    class_type: 'KSampler',
    inputs: {
      seed: '{{SEED}}', steps: 4, cfg: 1,
      sampler_name: 'euler', scheduler: 'sgm_uniform', denoise: 1,
      model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0],
    },
  },
  '4': {
    class_type: 'CheckpointLoaderSimple',
    inputs: { ckpt_name: 'sdxl_lightning_4step.safetensors' },
  },
  '5': {
    class_type: 'EmptyLatentImage',
    inputs: { width: '{{WIDTH}}', height: '{{HEIGHT}}', batch_size: 1 },
  },
  '6': {
    class_type: 'CLIPTextEncode',
    inputs: { text: '{{PROMPT}}', clip: ['4', 1] },
  },
  '7': {
    class_type: 'CLIPTextEncode',
    inputs: { text: 'blurry, low quality, watermark', clip: ['4', 1] },
  },
  '8': {
    class_type: 'VAEDecode',
    inputs: { samples: ['3', 0], vae: ['4', 2] },
  },
  '9': {
    class_type: 'SaveImage',
    inputs: { filename_prefix: 'gatesai_sdxl_lightning', images: ['8', 0] },
  },
};

interface PromptResp { prompt_id?: string; error?: string | { message?: string } }
interface HistoryOutputImage { filename: string; subfolder: string; type: string }
interface HistoryEntry {
  outputs?: Record<string, { images?: HistoryOutputImage[] }>;
  status?: { status_str?: string; completed?: boolean };
}

export class ComfyClient implements ImageBackend {
  readonly id = 'local-comfy' as const;
  private readonly baseUrl: string;
  private readonly clientId: string;
  private readonly workflowTemplate: Record<string, unknown>;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxPoll: number;
  private readonly pollIntervalMs: number;

  constructor(deps: ComfyClientDeps) {
    this.baseUrl = deps.baseUrl.replace(/\/+$/, '');
    this.clientId = deps.clientId ?? 'gatesai-chat';
    this.workflowTemplate = deps.workflowTemplate ?? (
      deps.qualityPreset === 'draft' ? SDXL_LIGHTNING_4STEP_WORKFLOW : DEFAULT_SDXL_WORKFLOW
    );
    this.fetchImpl = wrapGlobalFetch(deps.fetch);
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxPoll = deps.maxPollAttempts ?? DEFAULT_POLL_ATTEMPTS;
    this.pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL;
  }

  async generate(req: GenerateImageRequest): Promise<GenerateImageResult> {
    const { width, height } = dimsForAspect(req.aspectRatio ?? '1:1');
    const seed = typeof req.seed === 'number' ? req.seed : Math.floor(Math.random() * 2 ** 31);

    const workflow = substituteWorkflow(this.workflowTemplate, {
      '{{PROMPT}}': req.prompt,
      '{{WIDTH}}': width,
      '{{HEIGHT}}': height,
      '{{SEED}}': seed,
    });
    const prompt = stripWorkflowMetadata(workflow);

    const promptResp = await this.fetchImpl(`${this.baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, client_id: this.clientId }),
    });
    if (!promptResp.ok) {
      const text = await safeText(promptResp);
      throw new Error(`comfy ${promptResp.status} ${promptResp.statusText}: ${text || '(no body)'} [/prompt]`);
    }
    const promptData = (await promptResp.json()) as PromptResp;
    const promptId = promptData.prompt_id;
    if (!promptId) {
      const err = typeof promptData.error === 'string'
        ? promptData.error
        : promptData.error?.message ?? 'missing prompt_id';
      throw new Error(`comfy /prompt rejected the workflow: ${err}`);
    }

    // Poll history until the prompt completes or we give up.
    const image = await this.waitForImage(promptId);
    const viewUrl = `${this.baseUrl}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(image.subfolder)}&type=${encodeURIComponent(image.type)}`;
    const imgResp = await this.fetchImpl(viewUrl);
    if (!imgResp.ok) {
      throw new Error(`comfy /view ${imgResp.status} ${imgResp.statusText} for ${image.filename}`);
    }
    const bytes = new Uint8Array(await imgResp.arrayBuffer());

    return {
      base64: bytesToBase64(bytes),
      mime: 'image/png',
      width,
      height,
      seed,
      endpoint: `${this.baseUrl}/prompt`,
      backend: 'local-comfy',
    };
  }

  private async waitForImage(promptId: string): Promise<HistoryOutputImage> {
    const historyUrl = `${this.baseUrl}/history/${encodeURIComponent(promptId)}`;
    for (let i = 0; i < this.maxPoll; i++) {
      const resp = await this.fetchImpl(historyUrl);
      if (resp.ok) {
        const data = (await resp.json()) as Record<string, HistoryEntry>;
        const entry = data[promptId];
        if (entry?.outputs) {
          for (const nodeOut of Object.values(entry.outputs)) {
            const first = nodeOut.images?.[0];
            if (first) return first;
          }
        }
      }
      await this.sleep(this.pollIntervalMs);
    }
    throw new Error(`comfy timed out after ${this.maxPoll * this.pollIntervalMs}ms waiting for prompt ${promptId}`);
  }
}

/**
 * Recursively walk the workflow template and substitute token
 * placeholders. Tokens can appear as standalone string values
 * (`"{{PROMPT}}"`) or as substrings; number-typed tokens become
 * actual numbers so ComfyUI's schema validation is happy.
 */
export function substituteWorkflow(
  template: unknown,
  subs: Record<string, string | number>,
): unknown {
  if (typeof template === 'string') {
    // Fast path — whole-string match preserves the substitution's type.
    if (Object.prototype.hasOwnProperty.call(subs, template)) {
      return subs[template];
    }
    let out = template;
    for (const [token, value] of Object.entries(subs)) {
      if (out.includes(token)) {
        out = out.split(token).join(String(value));
      }
    }
    return out;
  }
  if (Array.isArray(template)) {
    return template.map((item) => substituteWorkflow(item, subs));
  }
  if (template && typeof template === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(template as Record<string, unknown>)) {
      out[k] = substituteWorkflow(v, subs);
    }
    return out;
  }
  return template;
}

/**
 * ComfyUI's API treats every top-level workflow property as a node. Allow
 * human-readable metadata like `_comment` in workspace templates, but never
 * send those keys to `/prompt`.
 */
export function stripWorkflowMetadata(workflow: unknown): unknown {
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
    return workflow;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(workflow as Record<string, unknown>)) {
    if (key.startsWith('_')) continue;
    out[key] = value;
  }
  return out;
}

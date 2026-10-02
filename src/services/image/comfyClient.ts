// Implements image-generation backend behavior for comfyClient.
// Called by ImageJobStore and image tools; depends on provider configs, ComfyUI/OpenRouter APIs, and bridge file writes.
// Invariant: backend clients return normalized job artifacts and leave queue ownership to ImageJobStore.
import {
  bytesToBase64,
  dimsForRequest,
  mimeFromUrl,
  safeText,
  type GenerateImageRequest,
  type GenerateImageResult,
  type ImageBackend,
} from './types';
import { buildFinalFlux2KleinWorkflow } from './workflows/finalFlux2Klein';
import { logger } from '../diagnostics/logger';
import { buildSdxlLightningQuickWorkflow, SDXL_LIGHTNING_CHECKPOINT, type SdxlLightningOptions } from './workflows/sdxlLightning';
import { buildCheckpointWorkflow } from './workflows/checkpoint';
import {
  findFlux2KleinFiles,
  findSdxlLightningFiles,
  type ComfyDiscovery,
  type ComfyFetch,
  type SdxlLightningFiles,
} from './comfyDiscovery';
import { localFetch } from '../local/localHttp';
import { isRecord } from '../../core/guards';
import { isTauri } from '../../core/runtime';

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
 * Without a custom template, the built-in workflow comes from what
 * discovery found installed (see {@link builtInComfyWorkflow}).
 *
 * Protocol:
 *   1. POST `/prompt` with `{prompt: <workflow>}` → `{prompt_id}`.
 *   2. Poll `/history/<prompt_id>` until it appears with outputs.
 *   3. GET `/view?filename=…&subfolder=…&type=output` for the first image.
 *
 * Every request goes through `localFetch` by default, so on desktop it
 * travels the Rust pass-through and ComfyUI never sees a browser Origin.
 *
 * Failure modes surfaced to the caller as `Error` with the ComfyUI
 * response body so the tool can return a model-readable message.
 */
export interface ComfyClientDeps {
  baseUrl: string;
  clientId?: string;
  /** Override the default SDXL txt2img template. */
  workflowTemplate?: Record<string, unknown>;
  /** What discovery found on this server; picks the built-in workflow and its exact file names. */
  discovery?: ComfyDiscovery;
  /** Built-in workflow choice when no explicit template is supplied. */
  qualityPreset?: 'full' | 'quick';
  /** Hires-fix multiplier for `full` mode. `1` (default) = no hires pass. */
  upscaleFactor?: number;
  qualitySteps?: number;
  draftSteps?: number;
  cfg?: number;
  /**
   * Substituted into {{CHECKPOINT}}. Defaults to the checkpoint the built-in
   * workflow uses, else 'sdxl_lightning_4step.safetensors'.
   */
  checkpoint?: string;
  /** How many times to poll /history. 120 × 500ms = 60s default. */
  maxPollAttempts?: number;
  pollIntervalMs?: number;
  /** Injectable clock + fetch for tests. Defaults to `localFetch`. */
  fetch?: ComfyFetch;
  sleep?: (ms: number) => Promise<void>;
}

// Default ceiling = 5 minutes. The previous 60s wasn't enough for slow
// workflows like FluxKlein + UltimateSDUpscale, where a single prompt can
// take 70-90s. The runner already lets the user cancel from the card.
const DEFAULT_POLL_ATTEMPTS = 600;
const DEFAULT_POLL_INTERVAL = 500;

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
  private readonly checkpoint: string;
  private readonly fetchImpl: ComfyFetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxPoll: number;
  private readonly pollIntervalMs: number;

  constructor(deps: ComfyClientDeps) {
    this.baseUrl = deps.baseUrl.replace(/\/+$/, '');
    this.clientId = deps.clientId ?? 'gatesai-chat';
    const builtIn = builtInComfyWorkflow(deps);
    this.checkpoint = deps.checkpoint ?? builtIn.checkpoint ?? SDXL_LIGHTNING_CHECKPOINT;
    this.workflowTemplate = deps.workflowTemplate ?? builtIn.workflow;
    // Called as a plain function so a native fetch never sees the client as `this`.
    const fetchImpl = deps.fetch ?? localFetch;
    this.fetchImpl = (url, init) => fetchImpl(url, init);
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxPoll = deps.maxPollAttempts ?? DEFAULT_POLL_ATTEMPTS;
    this.pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL;
  }

  async generate(req: GenerateImageRequest): Promise<GenerateImageResult> {
    const { width, height } = dimsForRequest(req);
    const seed = typeof req.seed === 'number' ? req.seed : Math.floor(Math.random() * 2 ** 31);

    let workflow = substituteWorkflow(this.workflowTemplate, {
      '{{CHECKPOINT}}': this.checkpoint,
      '{{PROMPT}}': req.prompt,
      '{{WIDTH}}': width,
      '{{HEIGHT}}': height,
      '{{SEED}}': seed,
      // Used by the hires-fix refinement pass so the second sample uses
      // independent noise from the base pass.
      '{{SEED_PLUS_1}}': seed + 1,
    });
    // If the caller provided a filename prefix, override the SaveImage node's
    // filename_prefix in place. We organize chat-generated renders under a
    // `gatesai/` subfolder so the user's manually-rendered Comfy outputs stay
    // separate. This mutates a deep clone, never the original template.
    if (req.filenamePrefix) {
      workflow = applyFilenamePrefix(workflow, `gatesai/${req.filenamePrefix}`);
    }
    const prompt = stripWorkflowMetadata(workflow);

    let promptResp: Response;
    try {
      promptResp = await this.fetchImpl(`${this.baseUrl}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: req.signal,
        body: JSON.stringify({ prompt, client_id: this.clientId }),
      });
    } catch (err) {
      if (req.signal?.aborted) throw new Error('cancelled');
      throw new Error(unreachableMessage(this.baseUrl, err));
    }
    if (!promptResp.ok) {
      const text = await safeText(promptResp);
      throw new Error(`comfy ${promptResp.status} ${promptResp.statusText}: ${text || '(no body)'} [/prompt]`);
    }
    const promptData = parsePromptResp(await promptResp.json());
    const promptId = promptData.prompt_id;
    if (!promptId) {
      const err = typeof promptData.error === 'string'
        ? promptData.error
        : promptData.error?.message ?? 'missing prompt_id';
      throw new Error(`comfy /prompt rejected the workflow: ${err}`);
    }

    // Poll history until the prompt completes or we give up. ComfyUI has
    // already saved the image to its own output folder by this point — we
    // just need the metadata so we can build the /view URL.
    const image = await this.waitForImage(promptId, req.signal);
    const viewUrl = `${this.baseUrl}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(image.subfolder)}&type=${encodeURIComponent(image.type)}`;
    // Read the bytes here, through the same transport as /prompt. A plain
    // webview fetch of /view carries the app's Origin, which ComfyUI refuses.
    const viewResp = await this.fetchImpl(viewUrl, { signal: req.signal });
    if (!viewResp.ok) {
      const text = await safeText(viewResp);
      throw new Error(`comfy ${viewResp.status} ${viewResp.statusText}: ${text || '(no body)'} [/view]`);
    }
    const bytes = new Uint8Array(await viewResp.arrayBuffer());

    return {
      base64: bytesToBase64(bytes),
      mime: viewResp.headers.get('content-type')?.split(';')[0] || mimeFromUrl(image.filename),
      width,
      height,
      seed,
      endpoint: viewUrl,
      backend: 'local-comfy',
    };
  }

  private async waitForImage(promptId: string, signal?: AbortSignal): Promise<HistoryOutputImage> {
    const historyUrl = `${this.baseUrl}/history/${encodeURIComponent(promptId)}`;
    let loggedShape = false;
    for (let i = 0; i < this.maxPoll; i++) {
      if (signal?.aborted) throw new Error('comfy generation cancelled');
      let resp: Response | null = null;
      try {
        resp = await this.fetchImpl(historyUrl, { signal });
      } catch {
        // Transient network blip during a long render — keep polling instead
        // of bubbling. /prompt already succeeded so the prompt is in flight.
      }
      if (resp?.ok) {
        const data = parseHistoryResp(await resp.json());
        const entry = data[promptId];
        if (entry?.outputs) {
          for (const nodeOut of Object.values(entry.outputs)) {
            const first = nodeOut.images?.[0];
            if (first) return first;
          }
          if (!loggedShape) {
            // The prompt completed but no node exposed an `images` array. Most
            // likely the workflow's terminal node uses a different output key
            // (e.g. `gifs`, `latents`, or a custom-node payload). Surface the
            // raw output keys so the user can spot what to change.
            const nodeKeys = Object.keys(entry.outputs);
            const sampleNode = nodeKeys[0];
            const sampleKeys = sampleNode ? Object.keys(entry.outputs[sampleNode] ?? {}) : [];
            logger.warn('comfy', `/history/${promptId} has outputs but no node exposed an "images" array. Nodes: [${nodeKeys.join(', ')}]; first node keys: [${sampleKeys.join(', ')}]. Likely a workflow output-node mismatch.`);
            loggedShape = true;
          }
        }
      }
      await this.sleep(this.pollIntervalMs);
    }
    throw new Error(`comfy timed out after ${this.maxPoll * this.pollIntervalMs}ms waiting for prompt ${promptId}`);
  }
}

type BuiltInWorkflowOptions = Pick<
  ComfyClientDeps,
  'discovery' | 'qualityPreset' | 'upscaleFactor' | 'qualitySteps' | 'draftSteps' | 'cfg'
>;

export interface BuiltInWorkflow {
  workflow: Record<string, unknown>;
  /** Checkpoint for the `{{CHECKPOINT}}` token, when the workflow loads one. */
  checkpoint?: string;
}

/**
 * Picks the built-in workflow for a quality mode and what discovery found:
 *
 * | discovered preset | full (normal/upscale) | quick (draft)                       |
 * | flux2-klein       | FLUX.2 Klein          | SDXL Lightning if installed, else Klein at draft steps |
 * | sdxl-lightning    | SDXL Lightning        | SDXL Lightning                      |
 * | checkpoint        | generic checkpoint    | generic checkpoint                  |
 * | none / offline    | FLUX.2 Klein defaults | SDXL Lightning defaults             |
 *
 * File names are the ones ComfyUI reported, so models in subfolders or with
 * different capitalization still load.
 */
export function builtInComfyWorkflow(opts: BuiltInWorkflowOptions): BuiltInWorkflow {
  const quick = opts.qualityPreset === 'quick';
  const discovery = opts.discovery;
  const lightning = (files: SdxlLightningFiles | null): BuiltInWorkflow => {
    const options: SdxlLightningOptions = { steps: opts.draftSteps, cfg: opts.cfg };
    if (files) options.vae = files.vae;
    return { workflow: buildSdxlLightningQuickWorkflow(options), checkpoint: files?.checkpoint };
  };
  const klein = (): BuiltInWorkflow => ({
    workflow: buildFinalFlux2KleinWorkflow({
      files: (discovery && findFlux2KleinFiles(discovery)) ?? undefined,
      upscaleFactor: quick ? 1 : opts.upscaleFactor,
      steps: quick ? opts.draftSteps : opts.qualitySteps,
      cfg: opts.cfg,
    }),
  });

  const preset = discovery?.preset;
  if (!discovery || !preset) return quick ? lightning(null) : klein();
  switch (preset.kind) {
    case 'flux2-klein': {
      const draftFiles = quick ? findSdxlLightningFiles(discovery) : null;
      return draftFiles ? lightning(draftFiles) : klein();
    }
    case 'sdxl-lightning':
      return lightning(findSdxlLightningFiles(discovery));
    case 'checkpoint':
      return { workflow: buildCheckpointWorkflow({ checkpoint: preset.checkpoint }), checkpoint: preset.checkpoint };
  }
}

/**
 * On desktop the request went through the Rust pass-through, so a failure
 * means nothing answered. In a browser, ComfyUI also refuses pages from
 * another origin unless it was started with --enable-cors-header, and the
 * browser reports that as the same opaque network error.
 */
function unreachableMessage(baseUrl: string, err: unknown): string {
  const reason = err instanceof Error ? err.message : String(err);
  if (isTauri()) {
    return `could not reach ComfyUI at ${baseUrl} (${reason}). Start ComfyUI or ComfyUI Desktop; GatesAI finds it on its own.`;
  }
  return `could not reach ComfyUI at ${baseUrl} (${reason}). Either it is not running, or it was started without `
    + '--enable-cors-header, so it refuses requests from a browser page.';
}

function parsePromptResp(value: unknown): PromptResp {
  if (!isRecord(value)) return {};
  return {
    prompt_id: typeof value.prompt_id === 'string' ? value.prompt_id : undefined,
    error: typeof value.error === 'string' || isRecord(value.error)
      ? parsePromptError(value.error)
      : undefined,
  };
}

function parsePromptError(value: string | Record<string, unknown>): PromptResp['error'] {
  return typeof value === 'string'
    ? value
    : { message: typeof value.message === 'string' ? value.message : undefined };
}

function parseHistoryResp(value: unknown): Record<string, HistoryEntry> {
  if (!isRecord(value)) return {};
  const entries: Record<string, HistoryEntry> = {};
  for (const [key, entry] of Object.entries(value)) {
    const parsed = parseHistoryEntry(entry);
    if (parsed) entries[key] = parsed;
  }
  return entries;
}

function parseHistoryEntry(value: unknown): HistoryEntry | null {
  if (!isRecord(value)) return null;
  return {
    outputs: parseHistoryOutputs(value.outputs),
    status: isRecord(value.status)
      ? {
        status_str: typeof value.status.status_str === 'string' ? value.status.status_str : undefined,
        completed: typeof value.status.completed === 'boolean' ? value.status.completed : undefined,
      }
      : undefined,
  };
}

function parseHistoryOutputs(value: unknown): HistoryEntry['outputs'] {
  if (!isRecord(value)) return undefined;
  const outputs: NonNullable<HistoryEntry['outputs']> = {};
  for (const [key, output] of Object.entries(value)) {
    if (!isRecord(output) || !Array.isArray(output.images)) continue;
    const images = output.images
      .map(parseHistoryOutputImage)
      .filter((image): image is HistoryOutputImage => image !== null);
    outputs[key] = { images };
  }
  return outputs;
}

function parseHistoryOutputImage(value: unknown): HistoryOutputImage | null {
  if (!isRecord(value)) return null;
  const filename = typeof value.filename === 'string' ? value.filename : '';
  const subfolder = typeof value.subfolder === 'string' ? value.subfolder : '';
  const type = typeof value.type === 'string' ? value.type : '';
  return filename && type ? { filename, subfolder, type } : null;
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

/**
 * Walk a workflow object and override the `filename_prefix` of every
 * `SaveImage` (and `SaveImageWebsocket`) node. Returns a new workflow object
 * — the input is never mutated. If no save nodes are found, returns the
 * input unchanged (the prompt will still run; it just won't honor the AI's
 * naming hint).
 */
export function applyFilenamePrefix(workflow: unknown, prefix: string): unknown {
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
    return workflow;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(workflow as Record<string, unknown>)) {
    if (
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && (value as { class_type?: string }).class_type === 'SaveImage'
    ) {
      const node = value as { class_type: string; inputs?: Record<string, unknown> };
      out[key] = {
        ...node,
        inputs: { ...(node.inputs ?? {}), filename_prefix: prefix },
      };
    } else {
      out[key] = value;
    }
  }
  return out;
}

import {
  dimsForAspect,
  isImageAspectRatio,
  isLocalImageBackend,
  validateExplicitDimensions,
  type ImageAspectRatio,
} from '../image/types';
import type { Tool } from './types';
import type { FsReadResp } from '../../core/workspace';

/**
 * image_generate — enqueue an image-render job. The render runs in the
 * background through {@link ImageJobStore}; the tool returns immediately
 * with a job id so the chat can render an `image-job` artifact and
 * stream progress while the model continues talking.
 *
 * The tool contract is backend-agnostic by design: the model doesn't
 * know or care whether a request lands at ComfyUI or AUTOMATIC1111.
 * Routing lives in {@link ImageGenStore} / {@link dispatchImageGenerate}.
 */
export const imageGenerateTool: Tool = {
  def: {
    name: 'image_generate',
    description: [
      'Generate an image using the configured local backend (ComfyUI or AUTOMATIC1111). Returns a workspace path the user can click to open.',
      '',
      'Use this when the user asks you to draw, render, create, or generate an image, picture, or illustration.',
      'The call returns immediately while the render runs in the background — do not repeat the result back to the user; they already see the image inline.',
      '',
      'Parameters:',
      '  prompt — what to render (be specific about subject, style, lighting).',
      '  prompt_file — optional /workspace JSON file for overnight batches. Shape: { defaults?: {...}, prompts: [{ prompt, count?, aspect_ratio?, width?, height?, seed?, filename? }] }.',
      '  aspect_ratio — 1:1 (default), 3:2, 2:3, 16:9, 9:16.',
      '  width + height — optional explicit pixel dimensions; must be supplied together and be multiples of 16.',
      '  count — how many images to generate (1–10). Default 1.',
      '  seed — optional integer for reproducibility.',
      '  batch_name — optional slug prefix for prompt_file output filenames.',
      '  filename — optional short slug for the saved file (lowercase letters, numbers, dashes; e.g. "starfleet-mountain-crash"). If omitted, one is derived from the prompt. The actual file goes under ComfyUI\'s `output/gatesai/` folder.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Text description of the image to generate.' },
        prompt_file: { type: 'string', description: 'Workspace JSON file containing { defaults, prompts } for batch generation.' },
        aspect_ratio: {
          type: 'string',
          enum: ['1:1', '3:2', '2:3', '16:9', '9:16'],
          description: 'Output aspect ratio. Default 1:1.',
        },
        count: {
          type: 'number',
          description: 'How many images to generate (1–10). Default 1.',
        },
        seed: { type: 'number', description: 'Optional deterministic seed.' },
        batch_name: {
          type: 'string',
          description: 'Optional slug prefix for filenames generated from prompt_file entries.',
        },
        width: {
          type: 'number',
          description: 'Optional explicit output width in pixels. Must be supplied with height and be a multiple of 16.',
        },
        height: {
          type: 'number',
          description: 'Optional explicit output height in pixels. Must be supplied with width and be a multiple of 16.',
        },
        filename: {
          type: 'string',
          description: 'Optional short slug for the saved file (lowercase, dashes). Falls back to a slug derived from the prompt if omitted.',
        },
      },
    },
  },
  meta: {
    category: 'workspace',
    resultPolicy: { maxChars: 500 },
    hasSideEffects: () => true,
    isReadOnly: () => false,
  },
  async execute(args, ctx) {
    const promptFile = typeof args.prompt_file === 'string' ? args.prompt_file.trim() : '';
    const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
    if (!prompt && !promptFile) return 'Error: `prompt` is required.';
    if (!ctx.imageGen) return 'Error: image-generation is not configured in this session.';
    if (!ctx.imageJobs) return 'Error: image-jobs subsystem is not available in this session.';
    if (!ctx.bridge?.isOnline) return 'Error: bridge is offline. Start the gatesai-bridge companion process and try again.';

    const snapshot = ctx.imageGen.toBackendConfig();

    if (promptFile) {
      return enqueuePromptFileBatch(args, ctx, snapshot.primary, promptFile);
    }

    const aspect: ImageAspectRatio = isImageAspectRatio(args.aspect_ratio) ? args.aspect_ratio : '1:1';
    const seed = typeof args.seed === 'number' && Number.isFinite(args.seed) ? Math.floor(args.seed) : undefined;
    const explicitWidth = parseDimensionArg(args.width);
    const explicitHeight = parseDimensionArg(args.height);
    const dimensionError = validateExplicitDimensions(explicitWidth, explicitHeight);
    if (dimensionError) return `Error: ${dimensionError}`;

    let width: number;
    let height: number;
    if (
      isLocalImageBackend(snapshot.primary)
      && explicitWidth !== undefined
      && explicitHeight !== undefined
    ) {
      width = explicitWidth;
      height = explicitHeight;
    } else {
      const dims = dimsForAspect(aspect);
      width = dims.width;
      height = dims.height;
    }

    const count = clampCount(args.count);
    const filenamePrefix = pickFilenamePrefix(args.filename, prompt);

    const { jobId, count: scheduledCount } = ctx.imageJobs.enqueue({
      threadId: ctx.threadId,
      prompt,
      count,
      width,
      height,
      seed,
      backend: snapshot.primary,
      filenamePrefix,
    });

    const noun = scheduledCount === 1 ? 'an image render' : `${scheduledCount} image renders`;
    return {
      content: `Queued ${noun} (job ${jobId}).`,
      artifacts: [{ kind: 'image-job', jobId, count: scheduledCount }],
    };
  },
};

interface BatchPromptDefaults {
  prompt?: unknown;
  aspect_ratio?: unknown;
  count?: unknown;
  seed?: unknown;
  width?: unknown;
  height?: unknown;
  filename?: unknown;
}

interface BatchPromptFile {
  defaults?: BatchPromptDefaults;
  prompts?: unknown;
}

const MAX_BATCH_PROMPTS = 500;

interface PlannedBatchJob {
  prompt: string;
  count: number;
  width: number;
  height: number;
  seed?: number;
  filenamePrefix: string;
}

async function enqueuePromptFileBatch(
  args: Record<string, unknown>,
  ctx: Parameters<Tool['execute']>[1],
  backend: ReturnType<NonNullable<Parameters<Tool['execute']>[1]['imageGen']>['toBackendConfig']>['primary'],
  promptFile: string,
): Promise<string> {
  const resp = await ctx.bridge!.client.request<FsReadResp>('fs.read', { path: promptFile });
  if (resp.encoding !== 'utf8') return 'Error: `prompt_file` must be a UTF-8 JSON file.';

  let parsed: BatchPromptFile;
  try {
    parsed = JSON.parse(resp.content) as BatchPromptFile;
  } catch (err) {
    return `Error: could not parse prompt_file JSON: ${(err as Error).message}`;
  }

  const entries = Array.isArray(parsed.prompts) ? parsed.prompts : null;
  if (!entries) return 'Error: prompt_file JSON must contain a `prompts` array.';
  if (entries.length === 0) return 'Error: prompt_file must contain at least one prompt.';
  if (entries.length > MAX_BATCH_PROMPTS) return `Error: prompt_file can contain at most ${MAX_BATCH_PROMPTS} prompts per tool call.`;

  const defaults = typeof parsed.defaults === 'object' && parsed.defaults !== null
    ? parsed.defaults
    : {};
  const batchPrefix = typeof args.batch_name === 'string' ? slugify(args.batch_name) : '';
  const plannedJobs: PlannedBatchJob[] = [];
  const jobIds: string[] = [];
  let totalImages = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (typeof entry !== 'object' || entry === null) {
      return `Error: prompt_file prompts[${i}] must be an object.`;
    }
    const item = entry as BatchPromptDefaults;
    const prompt = typeof item.prompt === 'string'
      ? item.prompt.trim()
      : typeof defaults.prompt === 'string'
        ? defaults.prompt.trim()
        : '';
    if (!prompt) return `Error: prompt_file prompts[${i}].prompt is required.`;

    const count = clampCount(item.count ?? defaults.count ?? args.count);
    const seed = parseSeedArg(item.seed ?? defaults.seed ?? args.seed);
    const dims = resolveDimensions({
      aspectRatio: item.aspect_ratio ?? defaults.aspect_ratio ?? args.aspect_ratio,
      width: item.width ?? defaults.width ?? args.width,
      height: item.height ?? defaults.height ?? args.height,
      backend,
    });
    if ('error' in dims) return `Error: prompt_file prompts[${i}]: ${dims.error}`;

    const rawFilename = item.filename ?? defaults.filename;
    const filenamePrefix = [
      batchPrefix,
      pickFilenamePrefix(rawFilename, prompt),
    ].filter(Boolean).join('-');
    plannedJobs.push({
      prompt,
      count,
      width: dims.width,
      height: dims.height,
      seed,
      filenamePrefix,
    });
  }

  for (const job of plannedJobs) {
    const { jobId, count: scheduledCount } = ctx.imageJobs!.enqueue({
      threadId: ctx.threadId,
      prompt: job.prompt,
      count: job.count,
      width: job.width,
      height: job.height,
      seed: job.seed,
      backend,
      filenamePrefix: job.filenamePrefix,
    });
    jobIds.push(jobId);
    totalImages += scheduledCount;
  }

  return `Queued ${jobIds.length} jobs / ${totalImages} image renders from ${promptFile}. First job: ${jobIds[0]}.`;
}

function resolveDimensions(input: {
  aspectRatio: unknown;
  width: unknown;
  height: unknown;
  backend: ReturnType<NonNullable<Parameters<Tool['execute']>[1]['imageGen']>['toBackendConfig']>['primary'];
}): { width: number; height: number } | { error: string } {
  const explicitWidth = parseDimensionArg(input.width);
  const explicitHeight = parseDimensionArg(input.height);
  const dimensionError = validateExplicitDimensions(explicitWidth, explicitHeight);
  if (dimensionError) return { error: dimensionError };
  if (
    isLocalImageBackend(input.backend)
    && explicitWidth !== undefined
    && explicitHeight !== undefined
  ) {
    return { width: explicitWidth, height: explicitHeight };
  }
  const aspect: ImageAspectRatio = isImageAspectRatio(input.aspectRatio) ? input.aspectRatio : '1:1';
  return dimsForAspect(aspect);
}

function clampCount(raw: unknown): number {
  const n = typeof raw === 'number' ? Math.floor(raw) : 1;
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(10, n));
}

function parseDimensionArg(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

function parseSeedArg(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : undefined;
}

const FILENAME_MAX_LEN = 60;

/**
 * Sanitize an AI-supplied filename, or fall back to a slug derived from the
 * prompt's first few words. Always returns a non-empty string of lowercase
 * letters, numbers, and dashes — safe to use as a `SaveImage.filename_prefix`
 * on Windows / macOS / Linux.
 */
export function pickFilenamePrefix(rawFilename: unknown, prompt: string): string {
  const explicit = typeof rawFilename === 'string' ? slugify(rawFilename) : '';
  if (explicit) return explicit.slice(0, FILENAME_MAX_LEN);
  const fromPrompt = slugify(prompt).slice(0, FILENAME_MAX_LEN);
  return fromPrompt || 'render';
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

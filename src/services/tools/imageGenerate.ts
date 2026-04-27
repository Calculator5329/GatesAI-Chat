import {
  dimsForAspect,
  isImageAspectRatio,
  isLocalImageBackend,
  validateExplicitDimensions,
  type ImageAspectRatio,
} from '../image/types';
import type { Tool } from './types';

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
      '  aspect_ratio — 1:1 (default), 3:2, 2:3, 16:9, 9:16.',
      '  width + height — optional explicit pixel dimensions; must be supplied together and be multiples of 16.',
      '  count — how many images to generate (1–10). Default 1.',
      '  seed — optional integer for reproducibility.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Text description of the image to generate.' },
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
        width: {
          type: 'number',
          description: 'Optional explicit output width in pixels. Must be supplied with height and be a multiple of 16.',
        },
        height: {
          type: 'number',
          description: 'Optional explicit output height in pixels. Must be supplied with width and be a multiple of 16.',
        },
      },
      required: ['prompt'],
    },
  },
  meta: {
    category: 'workspace',
    resultPolicy: { maxChars: 500 },
    hasSideEffects: () => true,
    isReadOnly: () => false,
  },
  async execute(args, ctx) {
    const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
    if (!prompt) return 'Error: `prompt` is required.';
    if (!ctx.imageGen) return 'Error: image-generation is not configured in this session.';
    if (!ctx.imageJobs) return 'Error: image-jobs subsystem is not available in this session.';
    if (!ctx.bridge?.isOnline) return 'Error: bridge is offline. Start the gatesai-bridge companion process and try again.';

    const snapshot = ctx.imageGen.toBackendConfig();

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

    const { jobId, count: scheduledCount } = ctx.imageJobs.enqueue({
      threadId: ctx.threadId,
      prompt,
      count,
      width,
      height,
      seed,
      backend: snapshot.primary,
    });

    const noun = scheduledCount === 1 ? 'an image render' : `${scheduledCount} image renders`;
    return {
      content: `Queued ${noun} (job ${jobId}).`,
      artifacts: [{ kind: 'image-job', jobId, count: scheduledCount }],
    };
  },
};

function clampCount(raw: unknown): number {
  const n = typeof raw === 'number' ? Math.floor(raw) : 1;
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(10, n));
}

function parseDimensionArg(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

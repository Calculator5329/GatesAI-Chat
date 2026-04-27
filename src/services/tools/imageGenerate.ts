import type { FsReadResp, FsWriteResp } from '../../core/workspace';
import { dispatchImageGenerate, type ImageBackendConfig } from '../image/imageBackend';
import { enhancePrompt } from '../image/promptEnhancer';
import {
  isImageAspectRatio,
  isImageVariant,
  isLocalImageBackend,
  validateExplicitDimensions,
} from '../image/types';
import type { Tool } from './types';

/**
 * image_generate — render an image from a text prompt using the
 * configured image-gen backend (fal.ai FLUX 2.x in the cloud, or a
 * local ComfyUI / AUTOMATIC1111 server) and save the bytes into
 * `/workspace/artifacts/`.
 *
 * The tool contract is backend-agnostic by design: the model doesn't
 * know or care whether a request went to fal, ComfyUI, or A1111.
 * Routing lives in {@link ImageGenStore} and the
 * {@link dispatchImageGenerate} helper. That same indirection lets a
 * local failure transparently fall back to the cloud, with a short
 * note appended to the tool result so the model can mention it.
 *
 * The tool does NOT return raw base64 to the model — that would blow
 * the context window. It writes the file through `fs.write` and hands
 * the model a path the user can click (see the workspace-link
 * markdown renderer).
 */
export const imageGenerateTool: Tool = {
  def: {
    name: 'image_generate',
    description: [
      'Generate an image from a text prompt and save it to /workspace/artifacts/.',
      '',
      'Use this when the user asks you to draw, render, create, or generate an image, picture, or illustration.',
      'Returns a workspace path the user can click to open the full-resolution file.',
      '',
      'Backends: fal.ai FLUX 2.x is configured in API; ComfyUI local generation is configured in Local.',
      'The model doesn\'t pick the backend — the user does. Local failures fall back to cloud automatically when a cloud key is configured.',
      '',
      'Parameters:',
      '  prompt — what to render (be specific about subject, style, lighting).',
      '  aspect_ratio — 1:1 (default), 3:2, 2:3, 16:9, 9:16. Works on every backend.',
      '  width + height — optional explicit local pixel dimensions, e.g. width=1360 height=768. Local ComfyUI/A1111 only; cloud backends keep aspect_ratio.',
      '  variant — flux-2-pro (highest quality, default), flux-2-flex, flux-2-dev. Cloud backends only; local backends ignore this.',
      '  filename — optional stem for the artifact; extension is appended. Defaults to a timestamp.',
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
        variant: {
          type: 'string',
          enum: ['flux-2-pro', 'flux-2-flex', 'flux-2-dev'],
          description: 'FLUX 2 variant. Default flux-2-pro. Cloud backends only.',
        },
        filename: { type: 'string', description: 'Optional filename stem (without extension).' },
        seed: { type: 'number', description: 'Optional deterministic seed.' },
        width: {
          type: 'number',
          description: 'Optional explicit output width in pixels for local ComfyUI/A1111. Must be supplied with height and be a multiple of 16.',
        },
        height: {
          type: 'number',
          description: 'Optional explicit output height in pixels for local ComfyUI/A1111. Must be supplied with width and be a multiple of 16.',
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
    if (!ctx.bridge?.isOnline) return 'Error: bridge is offline. Start the gatesai-bridge companion process and try again.';

    const snapshot = ctx.imageGen.toBackendConfig();
    const config: ImageBackendConfig = { ...snapshot };

    // ComfyUI-only: load the user's custom workflow JSON from /workspace/
    // if they've pointed at one. We do this here rather than in the
    // dispatcher because only the bridge knows how to read workspace paths.
    if (
      snapshot.primary === 'local-comfy'
      && snapshot.comfyQualityPreset !== 'draft'
      && ctx.imageGen.comfyWorkflowPath
    ) {
      const template = await loadComfyWorkflow(ctx.bridge, ctx.imageGen.comfyWorkflowPath);
      if (typeof template === 'string') return template; // error string
      config.comfyWorkflowTemplate = template;
    }

    const aspect = isImageAspectRatio(args.aspect_ratio) ? args.aspect_ratio : '1:1';
    const variant = isImageVariant(args.variant)
      ? args.variant
      : (snapshot.defaultVariant ?? 'flux-2-pro');
    const seed = typeof args.seed === 'number' && Number.isFinite(args.seed) ? Math.floor(args.seed) : undefined;
    const width = parseDimensionArg(args.width);
    const height = parseDimensionArg(args.height);
    const dimensionError = validateExplicitDimensions(width, height);
    if (dimensionError) return `Error: ${dimensionError}`;
    const localDimensions = isLocalImageBackend(snapshot.primary) && width !== undefined && height !== undefined
      ? { width, height }
      : {};
    const effectivePrompt = snapshot.promptEnhancement === 'llm'
      ? await enhancePrompt({
          prompt,
          stylePreset: snapshot.promptStylePreset ?? 'auto',
          llmComplete: ctx.chat.llmComplete.bind(ctx.chat),
        })
      : prompt;

    let dispatchResult;
    try {
      dispatchResult = await dispatchImageGenerate(
        { prompt: effectivePrompt, aspectRatio: aspect, variant, seed, ...localDimensions },
        config,
      );
    } catch (err) {
      return `Error generating image: ${(err as Error).message}`;
    }
    const { result, fallbackNote } = dispatchResult;

    const filename = sanitizeFilename(typeof args.filename === 'string' ? args.filename : '')
      || defaultFilename(result.backend);
    const ext = extensionForMime(result.mime);
    const finalName = filename.endsWith(ext) ? filename : `${filename}${ext}`;
    const path = `/workspace/artifacts/${finalName}`;

    try {
      const resp = await ctx.bridge.client.request<FsWriteResp>('fs.write', {
        path,
        content: result.base64,
        encoding: 'base64',
        append: false,
      });
      const dims = result.width && result.height ? `${result.width}x${result.height}` : aspect;
      const seedStr = typeof result.seed === 'number' ? `, seed=${result.seed}` : '';
      const fallbackLine = fallbackNote ? `\nNote: ${fallbackNote}` : '';
      const promptLine = effectivePrompt !== prompt ? `\nEnhanced prompt: ${effectivePrompt}` : '';
      return {
        content: `Saved: ${resp.path} (${dims}${seedStr}, backend=${result.backend})${promptLine}${fallbackLine}`,
        artifacts: [{ kind: 'image', path: resp.path, mime: result.mime }],
      };
    } catch (err) {
      return `Error saving image: ${(err as Error).message}`;
    }
  },
};

async function loadComfyWorkflow(
  bridge: NonNullable<Parameters<Tool['execute']>[1]['bridge']>,
  path: string,
): Promise<Record<string, unknown> | string> {
  try {
    const resp = await bridge.client.request<FsReadResp>('fs.read', { path, encoding: 'utf8' });
    if (typeof resp.content !== 'string') {
      return `Error: ComfyUI workflow template at ${path} is not readable as text.`;
    }
    try {
      const parsed = JSON.parse(resp.content) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return `Error: ComfyUI workflow template at ${path} must be a JSON object.`;
      }
      return parsed;
    } catch (err) {
      return `Error: ComfyUI workflow template at ${path} is not valid JSON (${(err as Error).message}).`;
    }
  } catch (err) {
    return `Error reading ComfyUI workflow template at ${path}: ${(err as Error).message}`;
  }
}

function sanitizeFilename(raw: string): string {
  const trimmed = raw.trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed) return '';
  // Strip any path separators — the tool always writes into /workspace/artifacts/.
  return trimmed
    .replace(/[\\/]+/g, '_')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/\.{2,}/g, '_')
    .slice(0, 96);
}

function defaultFilename(backend: string): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const prefix = backend === 'local-comfy' ? 'comfy' : backend === 'local-a1111' ? 'a1111' : 'flux';
  return `${prefix}-${stamp}`;
}

function extensionForMime(mime: string): string {
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/gif') return '.gif';
  return '.png';
}

function parseDimensionArg(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}


// Display names, duration estimates, and ComfyUI modes for direct-image turns.
import type { ImageBackendId, LocalComfyMode } from '../image/types';

export function directImageComfyMode(providerModelId: string | undefined): LocalComfyMode {
  switch (providerModelId) {
    case 'comfy-direct-draft':
      return 'draft';
    case 'comfy-direct-upscale':
      return 'upscale';
    case 'comfy-direct':
    default:
      return 'normal';
  }
}

export function imageBackendDisplayName(backend: ImageBackendId): string {
  return backend === 'openrouter-image'
    ? 'OpenRouter GPT-5.4 Image 2'
    : 'local ComfyUI';
}

export function estimatedImageDuration(backend: ImageBackendId): string {
  return backend === 'openrouter-image'
    ? 'about 30-90 seconds'
    : 'about 10-60 seconds';
}

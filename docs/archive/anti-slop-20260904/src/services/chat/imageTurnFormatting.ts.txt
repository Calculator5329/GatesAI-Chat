// Display text for image-generation turns: backend names, duration
// estimates, terminal (done/failed/cancelled) follow-up messages, and the
// dedupe key used so a job's completion is only announced once.
// Pure string builders consumed by ChatStore's direct-image path and
// image-job completion notifications.
import type { ImageBackendId, LocalComfyMode } from '../image/types';
import type { CompletedJob } from '../image/jobs/types';

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

export function formatImageElapsed(job: CompletedJob): string {
  if (!job.startedAt || !job.completedAt || job.completedAt <= job.startedAt) return '';
  const seconds = Math.max(1, Math.round((job.completedAt - job.startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

export function imageTerminalMessage(job: CompletedJob, backend: string, elapsed: string): string {
  const elapsedPart = elapsed ? ` in ${elapsed}` : '';
  if (job.status === 'done') {
    const count = job.results.length;
    const noun = count === 1 ? 'image is' : `${count} images are`;
    return `Here ${count === 1 ? 'it is' : 'they are'} — your ${noun} ready from ${backend}${elapsedPart}.`;
  }
  if (job.status === 'cancelled') {
    return `The image render through ${backend} was cancelled${elapsedPart}.`;
  }
  const detail = job.error ? ` ${job.error}` : '';
  return `The image render through ${backend} failed${elapsedPart}.${detail}`;
}

export function imageTerminalToolResult(job: CompletedJob, backend: string, elapsed: string): string {
  if (job.status === 'done') {
    return `Image render completed through ${backend}${elapsed ? ` in ${elapsed}` : ''}.`;
  }
  if (job.status === 'cancelled') {
    return `Image render cancelled through ${backend}${elapsed ? ` after ${elapsed}` : ''}.`;
  }
  return `Image render failed through ${backend}${elapsed ? ` after ${elapsed}` : ''}: ${job.error ?? 'Unknown error'}`;
}

export function imageTerminalKey(job: CompletedJob): string {
  return `${job.id}:${job.status}:${job.completedAt ?? 0}:${job.results.length}:${job.error ?? ''}`;
}

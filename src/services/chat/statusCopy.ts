import type { StreamActivity } from '../../core/types';
import type { ImageBackendId } from '../image/types';
import { isLocalImageBackend } from '../image/types';

export interface ImageJobRunningLabelParts {
  statusLine: string;
  detailLine?: string;
  progressLine?: string;
  waitingForProvider: boolean;
}

function isLocalProvider(providerId?: string): boolean {
  return providerId === 'ollama';
}

function localModelLabel(providerModelId?: string): string {
  const model = providerModelId?.trim();
  return model
    ? `Warming up ${model}...`
    : 'Loading local model...';
}

function localModelLabelNoTrailingDots(providerModelId?: string): string {
  const model = providerModelId?.trim();
  return model
    ? `Warming up ${model}`
    : 'Loading local model';
}

export function streamFooterLabelForActivity(activity?: StreamActivity): string {
  switch (activity?.phase) {
    case 'connecting':
      return isLocalProvider(activity.providerId)
        ? localModelLabel(activity.providerModelId)
        : 'waiting for provider...';
    case 'stalled':
      return 'provider stalled';
    case 'tooling':
      return 'running tools...';
    case 'streaming':
      return 'streaming...';
    default:
      return 'streaming...';
  }
}

export function providerStreamVerb(
  phase: StreamActivity['phase'],
  label?: string,
  providerId?: string,
  providerModelId?: string,
): string {
  if (phase === 'connecting') {
    return isLocalProvider(providerId)
      ? localModelLabelNoTrailingDots(providerModelId)
      : 'Waiting for provider';
  }
  if (phase === 'stalled') return 'Provider stalled';
  if (label === 'responding') return 'Responding';
  if (label === 'compacting') return 'Compacting';
  if (label === 'generating') return 'Generating';
  return 'Streaming';
}

export function imageRunningCopy(args: {
  backend: ImageBackendId;
  pct: number;
  elapsedSeconds: number;
  completed: number;
  total: number;
}): ImageJobRunningLabelParts {
  const backendLabel = args.backend === 'local-comfy' ? 'ComfyUI' : 'OpenRouter';
  const isRemote = !isLocalImageBackend(args.backend);
  if (isRemote && args.pct >= 92) {
    return {
      statusLine: 'Waiting on provider...',
      detailLine: `${backendLabel} remote render - ${args.elapsedSeconds}s elapsed`,
      progressLine: args.total > 1 ? `${args.completed} / ${args.total} done` : undefined,
      waitingForProvider: true,
    };
  }

  return {
    statusLine: `${isRemote ? 'waiting on' : 'generating'} · ${args.pct}% · ${backendLabel}`,
    detailLine: isRemote ? `${backendLabel} remote render · ${args.elapsedSeconds}s elapsed` : undefined,
    progressLine: args.total > 1 ? `${args.completed} / ${args.total} done` : undefined,
    waitingForProvider: false,
  };
}

import type { StreamActivity } from './types';
import { imageJobWaitingCopy, isLocalRuntimeProvider, localRuntimeStreamStatusLabel } from '../copy/localStatus';

// Mirrors services/image/types ImageBackendId; core cannot import services,
// and the literal union keeps callers assignment-compatible in both directions.
export type ImageBackendCopyId = 'local-comfy' | 'openrouter-image';

export interface ImageJobRunningLabelParts {
  statusLine: string;
  detailLine?: string;
  progressLine?: string;
  waitingForProvider: boolean;
}

export function streamFooterLabelForActivity(activity?: StreamActivity): string {
  switch (activity?.phase) {
    case 'connecting':
      return isLocalRuntimeProvider(activity.providerId)
        ? localRuntimeStreamStatusLabel(activity.phase, { providerId: activity.providerId, providerModelId: activity.providerModelId })
        : 'waiting for provider...';
    case 'stalled':
      return isLocalRuntimeProvider(activity.providerId) ? localRuntimeStreamStatusLabel('stalled', { providerId: activity.providerId }) : 'provider stalled';
    case 'tooling':
      return isLocalRuntimeProvider(activity.providerId) ? localRuntimeStreamStatusLabel('tooling', { providerId: activity.providerId }) : 'running tools...';
    case 'streaming':
      return isLocalRuntimeProvider(activity.providerId) ? localRuntimeStreamStatusLabel('streaming', { providerId: activity.providerId }) : 'streaming...';
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
    return isLocalRuntimeProvider(providerId)
      ? localRuntimeStreamStatusLabel('connecting', { providerId, providerModelId })
      : 'Waiting for provider';
  }
  if (phase === 'stalled') {
    return isLocalRuntimeProvider(providerId) ? 'Local model stalled' : 'Provider stalled';
  }
  if (label === 'responding') return 'Responding';
  if (label === 'compacting') return 'Compacting';
  if (label === 'generating') return 'Generating';
  return 'Streaming';
}

export function imageRunningCopy(args: {
  backend: ImageBackendCopyId;
  pct: number;
  elapsedSeconds: number;
  completed: number;
  total: number;
}): ImageJobRunningLabelParts {
  const backendLabel = args.backend === 'local-comfy' ? 'ComfyUI' : 'OpenRouter';
  const isRemote = args.backend !== 'local-comfy';
  if (isRemote && args.pct >= 92) {
    return {
      statusLine: imageJobWaitingCopy(args.backend),
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

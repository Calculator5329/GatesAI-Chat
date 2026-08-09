import type { StreamActivity } from '../core/types';

export type LocalRuntimeProviderId = 'ollama' | 'local-image';

export type LocalImageBackend = 'openrouter-image' | 'local-comfy';

export interface LocalRuntimeStatusContext {
  providerId?: string;
  providerModelId?: string;
  elapsedMs?: number;
}

export interface LocalRuntimeStallContext extends LocalRuntimeStatusContext {
  idleSeconds: number;
  coldStart: boolean;
}

const COLD_START_MESSAGE_CYCLE_MS = 6_000;
const LOCAL_RUNTIME_PHRASES = [
  'Loading {model} into memory...',
  'Running locally, first token can take a moment on a cold model',
  'Warming up the local runtime...',
] as const;

export function isLocalRuntimeProvider(providerId?: string): boolean {
  return providerId === 'ollama' || providerId === 'local-image';
}

function localModelLabel(providerModelId?: string): string {
  return providerModelId?.trim() || 'the local model';
}

function renderModelTemplate(template: string, providerModelId?: string): string {
  return template.replace('{model}', localModelLabel(providerModelId));
}

export function localRuntimeConnectingStatusLabel(args: LocalRuntimeStatusContext): string {
  const elapsedMs = Math.max(0, args.elapsedMs ?? 0);
  const index = Math.floor(elapsedMs / COLD_START_MESSAGE_CYCLE_MS) % LOCAL_RUNTIME_PHRASES.length;
  return renderModelTemplate(LOCAL_RUNTIME_PHRASES[index], args.providerModelId);
}

export function localRuntimeStreamStatusLabel(phase: StreamActivity['phase'], args: LocalRuntimeStatusContext): string {
  if (phase === 'connecting') return localRuntimeConnectingStatusLabel(args);
  if (phase === 'stalled') return 'Local model went quiet...';
  if (phase === 'tooling') return 'Running tools locally...';
  return 'Streaming locally...';
}

export function localRuntimeStallReason(args: LocalRuntimeStallContext): string {
  if (!isLocalRuntimeProvider(args.providerId)) {
    return `No provider data arrived for ${args.idleSeconds}s, so GatesAI stopped the stalled stream.`;
  }
  const modelLabel = localModelLabel(args.providerModelId);
  if (args.coldStart) {
    return `${modelLabel} took longer than ${args.idleSeconds}s to load locally, so GatesAI stopped waiting for first token.`;
  }
  return `The local model went quiet for ${args.idleSeconds}s, so GatesAI stopped the stalled stream.`;
}

export function imageJobWaitingCopy(backend: LocalImageBackend): string {
  if (backend === 'local-comfy') return 'Warming up ComfyUI runtime...';
  return 'Waiting on OpenRouter image service...';
}

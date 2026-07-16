import type { AssistantMessage, StreamActivity } from '../../core/types';

export interface StreamStatusCopyArgs {
  phase: StreamActivity['phase'];
  providerId?: string;
  providerModelId?: string;
  preTokenLabel?: AssistantMessage['preTokenLabel'];
  idleSeconds?: number;
}

export interface StreamStatusCopy {
  verb: string;
  stallReason?: string;
}

/** OpenAI-compatible endpoints can be local or remote, so do not guess. */
export function isLocalStreamProvider(providerId?: string): boolean {
  return providerId === 'ollama' || providerId?.startsWith('local-') === true;
}

export function streamStatusCopy(args: StreamStatusCopyArgs): StreamStatusCopy {
  if (isLocalStreamProvider(args.providerId)) return localStreamStatusCopy(args);
  return remoteStreamStatusCopy(args);
}

function localStreamStatusCopy(args: StreamStatusCopyArgs): StreamStatusCopy {
  if (args.phase === 'stalled') {
    return {
      verb: 'Local model paused',
      stallReason: args.idleSeconds == null
        ? 'The local runtime stopped sending data, so GatesAI stopped the stalled stream.'
        : `The local runtime sent no data for ${args.idleSeconds}s, so GatesAI stopped the stalled stream.`,
    };
  }
  if (args.phase === 'connecting') {
    const model = args.providerModelId?.trim();
    return { verb: model ? `Loading ${model} locally` : 'Warming up local model' };
  }
  if (args.preTokenLabel === 'responding') return { verb: 'Responding' };
  if (args.preTokenLabel === 'compacting') return { verb: 'Compacting' };
  if (args.preTokenLabel === 'generating') return { verb: 'Generating' };
  return { verb: 'Streaming locally' };
}

function remoteStreamStatusCopy(args: StreamStatusCopyArgs): StreamStatusCopy {
  if (args.phase === 'stalled') {
    return {
      verb: 'Provider stalled',
      stallReason: args.idleSeconds == null
        ? 'The provider stopped sending data, so GatesAI stopped the stalled stream.'
        : `No provider data arrived for ${args.idleSeconds}s, so GatesAI stopped the stalled stream.`,
    };
  }
  if (args.phase === 'connecting') return { verb: 'Waiting for provider' };
  if (args.preTokenLabel === 'responding') return { verb: 'Responding' };
  if (args.preTokenLabel === 'compacting') return { verb: 'Compacting' };
  if (args.preTokenLabel === 'generating') return { verb: 'Generating' };
  return { verb: 'Streaming' };
}

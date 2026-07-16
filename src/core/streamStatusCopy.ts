import type { AssistantMessage, StreamActivity } from './types';

export interface StreamStatusCopyArgs {
  phase: StreamActivity['phase'];
  providerId?: string;
  providerModelId?: string;
  preTokenLabel?: AssistantMessage['preTokenLabel'];
  idleSeconds?: number;
}

export interface StreamStatusCopy {
  verb: string;
  footer: string;
  stallReason?: string;
}

/** OpenAI-compatible endpoints can be local or remote, so do not guess. */
export function isLocalStreamProvider(providerId?: string): boolean {
  return providerId === 'ollama' || providerId?.startsWith('local-') === true;
}

export function streamStatusCopy(args: StreamStatusCopyArgs): StreamStatusCopy {
  if (isLocalStreamProvider(args.providerId)) return localStreamStatusCopy(args);
  if (args.providerId === 'openai-compat') return neutralStreamStatusCopy(args);
  return remoteStreamStatusCopy(args);
}

function localStreamStatusCopy(args: StreamStatusCopyArgs): StreamStatusCopy {
  if (args.phase === 'stalled') {
    return {
      verb: 'Local model paused',
      footer: 'local model paused',
      stallReason: args.idleSeconds == null
        ? 'The local runtime stopped sending data, so GatesAI stopped the stalled stream.'
        : `The local runtime sent no data for ${args.idleSeconds}s, so GatesAI stopped the stalled stream.`,
    };
  }
  if (args.phase === 'connecting') {
    const model = args.providerModelId?.trim();
    return {
      verb: model ? `Loading ${model} locally` : 'Warming up local model',
      footer: model ? `loading ${model} locally...` : 'warming up local model...',
    };
  }
  if (args.phase === 'tooling') return { verb: 'Running tools', footer: 'running tools...' };
  if (args.preTokenLabel === 'responding') return { verb: 'Responding', footer: 'responding locally...' };
  if (args.preTokenLabel === 'compacting') return { verb: 'Compacting', footer: 'compacting locally...' };
  if (args.preTokenLabel === 'generating') return { verb: 'Generating', footer: 'generating locally...' };
  return { verb: 'Streaming locally', footer: 'streaming locally...' };
}

function neutralStreamStatusCopy(args: StreamStatusCopyArgs): StreamStatusCopy {
  if (args.phase === 'stalled') {
    return {
      verb: 'Model paused',
      footer: 'model paused',
      stallReason: args.idleSeconds == null
        ? 'The model stopped sending data, so GatesAI stopped the stalled stream.'
        : `No model data arrived for ${args.idleSeconds}s, so GatesAI stopped the stalled stream.`,
    };
  }
  if (args.phase === 'connecting') return { verb: 'Waiting for model', footer: 'waiting for model...' };
  if (args.phase === 'tooling') return { verb: 'Running tools', footer: 'running tools...' };
  if (args.preTokenLabel === 'responding') return { verb: 'Responding', footer: 'responding...' };
  if (args.preTokenLabel === 'compacting') return { verb: 'Compacting', footer: 'compacting...' };
  if (args.preTokenLabel === 'generating') return { verb: 'Generating', footer: 'generating...' };
  return { verb: 'Streaming', footer: 'streaming...' };
}

function remoteStreamStatusCopy(args: StreamStatusCopyArgs): StreamStatusCopy {
  if (args.phase === 'stalled') {
    return {
      verb: 'Provider stalled',
      footer: 'provider stalled',
      stallReason: args.idleSeconds == null
        ? 'The provider stopped sending data, so GatesAI stopped the stalled stream.'
        : `No provider data arrived for ${args.idleSeconds}s, so GatesAI stopped the stalled stream.`,
    };
  }
  if (args.phase === 'connecting') return { verb: 'Waiting for provider', footer: 'waiting for provider...' };
  if (args.phase === 'tooling') return { verb: 'Running tools', footer: 'running tools...' };
  if (args.preTokenLabel === 'responding') return { verb: 'Responding', footer: 'responding...' };
  if (args.preTokenLabel === 'compacting') return { verb: 'Compacting', footer: 'compacting...' };
  if (args.preTokenLabel === 'generating') return { verb: 'Generating', footer: 'generating...' };
  return { verb: 'Streaming', footer: 'streaming...' };
}

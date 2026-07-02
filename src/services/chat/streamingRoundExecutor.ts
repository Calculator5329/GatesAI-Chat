/*
Extraction plan:
1. Keep ChatStore as the owner of thread/message mutation, request building,
   compaction, tool-loop sequencing, persistence, and auto-naming.
2. Move one provider round into this service: start activity at connecting,
   stream provider chunks through one abort-aware iterator, report streaming
   activity and usage, accumulate text/tool calls, and return a typed outcome.
3. Move stall timers here. A round gets an initial connect timer and then a
   provider-idle timer; a stall aborts only the provider attempt signal and
   returns a stalled outcome for ChatStore to format with existing copy.
4. Move retry timing here. The default RetryPolicy retries transient failures
   only before any provider output was delivered, never after user abort, and
   uses abort-aware backoff delays.
5. Leave output-limit retries in ChatStore's tool loop, but keep the shared
   retry count constant here so the policy is no longer buried in the store.
*/
import type { LlmChunk, LlmRequest, LlmUsage, ToolCall } from '../../core/llm';
import type { AssistantFinishReason, StreamActivity } from '../../core/types';

export const OUTPUT_LIMIT_RETRY_ROUNDS = 2;
export const PROVIDER_STREAM_STALL_MS = 120_000;
export const PROVIDER_STREAM_INITIAL_STALL_MS = 180_000;

export const TRANSIENT_PROVIDER_RETRY_DELAYS_MS = [1_000, 4_000] as const;

export interface RetryDecision {
  retry: boolean;
  delayMs: number;
}

export interface RetryPolicy {
  (error: unknown, attempt: number): RetryDecision;
}

export interface StreamingRoundActivityUpdate {
  phase: StreamActivity['phase'];
  at: number;
  round: number;
  providerId: string;
  providerModelId: string;
  stallReason?: string;
  idleSeconds?: number;
}

export interface StreamingRoundCallbacks {
  onChunk?: (delta: string) => void;
  onActivityPhase?: (update: StreamingRoundActivityUpdate) => void;
  onUsage?: (usage: LlmUsage) => void;
}

export type ProviderStreamFn = (request: LlmRequest, signal: AbortSignal) => AsyncIterable<LlmChunk>;

export interface StreamingRoundExecutorOptions {
  initialStallMs?: number;
  stallMs?: number;
  retryPolicy?: RetryPolicy;
}

export interface ExecuteStreamingRoundOptions {
  request: LlmRequest;
  stream: ProviderStreamFn;
  signal: AbortSignal;
  round: number;
  providerId: string;
  providerModelId: string;
  callbacks?: StreamingRoundCallbacks;
  retryPolicy?: RetryPolicy;
}

interface RoundPayload {
  text: string;
  toolCalls: ToolCall[];
  usage: LlmUsage[];
  receivedContent: boolean;
  retryAttempts: number;
}

export type StreamingRoundOutcome =
  | (RoundPayload & {
      status: 'completed';
      finishReason?: AssistantFinishReason;
    })
  | (RoundPayload & {
      status: 'aborted';
    })
  | (RoundPayload & {
      status: 'stalled';
      finishReason: 'error';
      error: string;
    })
  | (RoundPayload & {
      status: 'errored';
      finishReason: 'error';
      error: string;
      cause?: unknown;
    });

type WithoutRetry<T> = T extends unknown ? Omit<T, 'retryAttempts'> : never;
type AttemptOutcome = WithoutRetry<StreamingRoundOutcome>;

interface AttemptState {
  text: string;
  toolCalls: ToolCall[];
  usage: LlmUsage[];
  receivedContent: boolean;
}

const emptyPayload = (): RoundPayload => ({
  text: '',
  toolCalls: [],
  usage: [],
  receivedContent: false,
  retryAttempts: 0,
});

export function transientProviderRetryPolicy(error: unknown, attempt: number): RetryDecision {
  const delayMs = TRANSIENT_PROVIDER_RETRY_DELAYS_MS[attempt];
  if (delayMs == null || !isTransientProviderError(error)) {
    return { retry: false, delayMs: 0 };
  }
  return { retry: true, delayMs };
}

export function isTransientProviderError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const message = errorMessage(error).toLowerCase();
  if (!message) return false;
  if (/\b(?:http\s*)?(429|5\d\d)\b/i.test(message)) return true;
  return [
    'failed to fetch',
    'fetch failed',
    'networkerror',
    'network error',
    'load failed',
    'connection reset',
    'connection refused',
    'econnreset',
    'econnrefused',
    'etimedout',
    'socket hang up',
  ].some(needle => message.includes(needle));
}

export class StreamingRoundExecutor {
  private readonly initialStallMs: number;
  private readonly stallMs: number;
  private readonly retryPolicy?: RetryPolicy;

  constructor(options: StreamingRoundExecutorOptions = {}) {
    this.initialStallMs = options.initialStallMs ?? PROVIDER_STREAM_INITIAL_STALL_MS;
    this.stallMs = options.stallMs ?? PROVIDER_STREAM_STALL_MS;
    this.retryPolicy = options.retryPolicy;
  }

  async execute(options: ExecuteStreamingRoundOptions): Promise<StreamingRoundOutcome> {
    if (options.signal.aborted) return { ...emptyPayload(), status: 'aborted' };

    let retryAttempts = 0;
    while (true) {
      const outcome = await this.executeAttempt(options);
      if (outcome.status !== 'errored') return { ...outcome, retryAttempts };
      if (options.signal.aborted) return abortedFrom(outcome, retryAttempts);
      if (outcome.receivedContent) return { ...outcome, retryAttempts };

      const policy = options.retryPolicy ?? this.retryPolicy;
      const decision = policy?.(outcome.cause ?? new Error(outcome.error), retryAttempts) ?? { retry: false, delayMs: 0 };
      if (!decision.retry) return { ...outcome, retryAttempts };

      const completedDelay = await delayWithAbort(decision.delayMs, options.signal);
      if (!completedDelay) return abortedFrom(outcome, retryAttempts);
      retryAttempts += 1;
    }
  }

  private async executeAttempt(options: ExecuteStreamingRoundOptions): Promise<AttemptOutcome> {
    const controller = new AbortController();
    const parentAbort = () => controller.abort(options.signal.reason);
    if (options.signal.aborted) controller.abort(options.signal.reason);
    else options.signal.addEventListener('abort', parentAbort, { once: true });

    const state: AttemptState = {
      text: '',
      toolCalls: [],
      usage: [],
      receivedContent: false,
    };
    let stalledReason: string | null = null;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    let lastProviderAt = Date.now();

    const clearStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = null;
    };
    const emitActivity = (phase: StreamActivity['phase'], extras: Partial<StreamingRoundActivityUpdate> = {}) => {
      options.callbacks?.onActivityPhase?.({
        phase,
        at: Date.now(),
        round: options.round,
        providerId: options.providerId,
        providerModelId: options.providerModelId,
        ...extras,
      });
    };
    const armStallTimer = (timeoutMs: number) => {
      clearStallTimer();
      stallTimer = setTimeout(() => {
        const idleSeconds = Math.max(1, Math.round((Date.now() - lastProviderAt) / 1000));
        stalledReason = `No provider data arrived for ${idleSeconds}s, so GatesAI stopped the stalled stream.`;
        emitActivity('stalled', {
          stallReason: stalledReason,
          idleSeconds,
          at: Date.now(),
        });
        controller.abort(new Error(stalledReason));
      }, timeoutMs);
    };

    try {
      lastProviderAt = Date.now();
      emitActivity('connecting', { at: lastProviderAt });
      armStallTimer(this.initialStallMs);

      for await (const chunk of abortFilteredChunks(options.stream(options.request, controller.signal), controller.signal)) {
        if (chunk.type !== 'done') {
          state.receivedContent = true;
          lastProviderAt = Date.now();
          emitActivity('streaming', { at: lastProviderAt });
          armStallTimer(this.stallMs);
        }

        if (chunk.type === 'text') {
          state.text += chunk.delta;
          options.callbacks?.onChunk?.(chunk.delta);
        } else if (chunk.type === 'tool_call') {
          state.toolCalls.push(chunk.call);
        } else if (chunk.type === 'usage') {
          state.usage.push(chunk.usage);
          options.callbacks?.onUsage?.(chunk.usage);
        } else if (chunk.type === 'done') {
          if (chunk.finishReason === 'error') {
            return {
              ...state,
              status: 'errored',
              finishReason: 'error',
              error: chunk.error || 'Provider ended the response with an error.',
              cause: new Error(chunk.error || 'Provider ended the response with an error.'),
            };
          }
          if (chunk.finishReason === 'cancelled' && stalledReason) {
            return {
              ...state,
              status: 'stalled',
              finishReason: 'error',
              error: stalledReason,
            };
          }
          return {
            ...state,
            status: 'completed',
            finishReason: chunk.finishReason,
          };
        }
      }
    } catch (err) {
      if (stalledReason) {
        return {
          ...state,
          status: 'stalled',
          finishReason: 'error',
          error: stalledReason,
        };
      }
      if (controller.signal.aborted || options.signal.aborted) {
        return {
          ...state,
          status: 'aborted',
        };
      }
      return {
        ...state,
        status: 'errored',
        finishReason: 'error',
        error: errorMessage(err) || 'Provider stream failed.',
        cause: err,
      };
    } finally {
      clearStallTimer();
      options.signal.removeEventListener('abort', parentAbort);
    }

    if (stalledReason) {
      return {
        ...state,
        status: 'stalled',
        finishReason: 'error',
        error: stalledReason,
      };
    }
    if (controller.signal.aborted || options.signal.aborted) {
      return {
        ...state,
        status: 'aborted',
      };
    }
    return {
      ...state,
      status: 'completed',
    };
  }
}

function abortedFrom(outcome: AttemptOutcome, retryAttempts: number): StreamingRoundOutcome {
  return {
    text: outcome.text,
    toolCalls: outcome.toolCalls,
    usage: outcome.usage,
    receivedContent: outcome.receivedContent,
    retryAttempts,
    status: 'aborted',
  };
}

export async function delayWithAbort(delayMs: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return false;
  if (delayMs <= 0) return true;
  return new Promise(resolve => {
    let settled = false;
    const finish = (completed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(completed);
    };
    const onAbort = () => finish(false);
    const timer = setTimeout(() => finish(true), delayMs);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function* abortFilteredChunks(iterable: AsyncIterable<LlmChunk>, signal: AbortSignal): AsyncIterable<LlmChunk> {
  const iterator = iterable[Symbol.asyncIterator]();
  const aborted = abortPromise(signal);
  try {
    while (true) {
      const next = await Promise.race([iterator.next(), aborted.promise]);
      if (next === ABORTED || signal.aborted) return;
      if (next.done) return;
      yield next.value;
    }
  } finally {
    aborted.cleanup();
    if (signal.aborted) {
      try {
        void iterator.return?.().catch(() => undefined);
      } catch {
        // The abort outcome is already known; provider cleanup errors should not
        // be reported as a separate round failure.
      }
    }
  }
}

const ABORTED = Symbol('aborted');

function abortPromise(signal: AbortSignal): { promise: Promise<typeof ABORTED>; cleanup: () => void } {
  if (signal.aborted) return { promise: Promise.resolve(ABORTED), cleanup: () => undefined };
  let cleanup: () => void = () => undefined;
  const promise = new Promise<typeof ABORTED>(resolve => {
    const onAbort = () => resolve(ABORTED);
    cleanup = () => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  return { promise, cleanup };
}

function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message || error.name;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return String(error ?? '');
}

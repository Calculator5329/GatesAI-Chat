import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LlmChunk, LlmRequest } from '../../../src/core/llm';
import {
  StreamingRoundExecutor,
  transientProviderRetryPolicy,
} from '../../../src/services/chat/streamingRoundExecutor';

const request: LlmRequest = {
  modelId: 'test-model',
  messages: [{ role: 'user', content: 'hello' }],
};

async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe('StreamingRoundExecutor', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('executes a normal round and reports chunks, usage, activity, and tool calls', async () => {
    const chunks: string[] = [];
    const phases: string[] = [];
    const usageSeen: unknown[] = [];
    const executor = new StreamingRoundExecutor();

    const outcome = await executor.execute({
      request,
      stream: async function*(): AsyncIterable<LlmChunk> {
        yield { type: 'text', delta: 'Hello ' };
        yield {
          type: 'usage',
          usage: { providerId: 'openrouter', modelId: 'test-model', promptTokens: 1, completionTokens: 2 },
        };
        yield { type: 'tool_call', call: { id: 'call-1', name: 'memory', arguments: { action: 'list' } } };
        yield { type: 'done', finishReason: 'tool_use' };
      },
      signal: new AbortController().signal,
      round: 0,
      providerId: 'openrouter',
      providerModelId: 'test-model',
      callbacks: {
        onChunk: delta => chunks.push(delta),
        onUsage: usage => usageSeen.push(usage),
        onActivityPhase: update => phases.push(update.phase),
      },
    });

    expect(outcome).toMatchObject({
      status: 'completed',
      text: 'Hello ',
      finishReason: 'tool_use',
      retryAttempts: 0,
    });
    expect(outcome.toolCalls).toEqual([{ id: 'call-1', name: 'memory', arguments: { action: 'list' } }]);
    expect(chunks).toEqual(['Hello ']);
    expect(usageSeen).toHaveLength(1);
    expect(phases).toEqual(['connecting', 'streaming', 'streaming', 'streaming']);
  });

  it('does not deliver post-abort chunks when the provider keeps yielding', async () => {
    const controller = new AbortController();
    const chunks: string[] = [];
    const executor = new StreamingRoundExecutor();

    const outcome = await executor.execute({
      request,
      stream: async function*(): AsyncIterable<LlmChunk> {
        yield { type: 'text', delta: 'first' };
        yield { type: 'text', delta: 'second' };
        yield { type: 'done', finishReason: 'stop' };
      },
      signal: controller.signal,
      round: 0,
      providerId: 'openrouter',
      providerModelId: 'test-model',
      callbacks: {
        onChunk: delta => {
          chunks.push(delta);
          controller.abort();
        },
      },
    });

    expect(outcome.status).toBe('aborted');
    expect(chunks).toEqual(['first']);
  });

  it('returns a stalled outcome when no provider data arrives before the stall timer', async () => {
    vi.useFakeTimers();
    const phases: string[] = [];
    const executor = new StreamingRoundExecutor({ initialStallMs: 5, stallMs: 5 });

    const promise = executor.execute({
      request,
      stream: async function*(_req: LlmRequest, signal: AbortSignal): AsyncIterable<LlmChunk> {
        await new Promise<void>(resolve => {
          if (signal.aborted) resolve();
          else signal.addEventListener('abort', () => resolve(), { once: true });
        });
        yield { type: 'done', finishReason: 'cancelled' };
      },
      signal: new AbortController().signal,
      round: 0,
      providerId: 'openrouter',
      providerModelId: 'test-model',
      callbacks: {
        onActivityPhase: update => phases.push(update.phase),
      },
    });

    await flush();
    expect(phases).toEqual(['connecting']);
    await vi.advanceTimersByTimeAsync(6);
    const outcome = await promise;

    expect(outcome.status).toBe('stalled');
    expect(outcome.status === 'stalled' ? outcome.error : '').toContain('No provider data arrived');
    expect(phases).toEqual(['connecting', 'stalled']);
  });

  it('retries a transient error before the first token per policy', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const executor = new StreamingRoundExecutor({ retryPolicy: transientProviderRetryPolicy });

    const promise = executor.execute({
      request,
      stream: async function*(): AsyncIterable<LlmChunk> {
        calls += 1;
        if (calls === 1) throw new TypeError('Failed to fetch');
        yield { type: 'text', delta: 'recovered' };
        yield { type: 'done', finishReason: 'stop' };
      },
      signal: new AbortController().signal,
      round: 0,
      providerId: 'openrouter',
      providerModelId: 'test-model',
    });

    await flush();
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    const outcome = await promise;

    expect(calls).toBe(2);
    expect(outcome).toMatchObject({ status: 'completed', text: 'recovered', retryAttempts: 1 });
  });

  it('does not retry a transient error after the first token', async () => {
    let calls = 0;
    const chunks: string[] = [];
    const executor = new StreamingRoundExecutor({ retryPolicy: transientProviderRetryPolicy });

    const outcome = await executor.execute({
      request,
      stream: async function*(): AsyncIterable<LlmChunk> {
        calls += 1;
        yield { type: 'text', delta: 'partial' };
        yield { type: 'done', finishReason: 'error', error: 'OpenRouter 503 Service Unavailable' };
      },
      signal: new AbortController().signal,
      round: 0,
      providerId: 'openrouter',
      providerModelId: 'test-model',
      callbacks: {
        onChunk: delta => chunks.push(delta),
      },
    });

    expect(calls).toBe(1);
    expect(chunks).toEqual(['partial']);
    expect(outcome).toMatchObject({ status: 'errored', text: 'partial', retryAttempts: 0 });
  });

  it('cancels retry immediately when aborted during backoff', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let calls = 0;
    const executor = new StreamingRoundExecutor({ retryPolicy: transientProviderRetryPolicy });

    const promise = executor.execute({
      request,
      stream: async function*(): AsyncIterable<LlmChunk> {
        calls += 1;
        throw new TypeError('Failed to fetch');
      },
      signal: controller.signal,
      round: 0,
      providerId: 'openrouter',
      providerModelId: 'test-model',
    });

    await flush();
    controller.abort();
    const outcome = await promise;

    expect(calls).toBe(1);
    expect(outcome.status).toBe('aborted');
  });

  it('retries HTTP 5xx but not HTTP 400 provider errors', async () => {
    vi.useFakeTimers();
    let fiveHundredCalls = 0;
    const executor = new StreamingRoundExecutor({ retryPolicy: transientProviderRetryPolicy });

    const fiveHundred = executor.execute({
      request,
      stream: async function*(): AsyncIterable<LlmChunk> {
        fiveHundredCalls += 1;
        if (fiveHundredCalls === 1) {
          yield { type: 'done', finishReason: 'error', error: 'OpenRouter 500 Internal Server Error' };
          return;
        }
        yield { type: 'done', finishReason: 'stop' };
      },
      signal: new AbortController().signal,
      round: 0,
      providerId: 'openrouter',
      providerModelId: 'test-model',
    });
    await flush();
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(fiveHundred).resolves.toMatchObject({ status: 'completed', retryAttempts: 1 });
    expect(fiveHundredCalls).toBe(2);

    vi.useRealTimers();
    let fourHundredCalls = 0;
    const fourHundred = await executor.execute({
      request,
      stream: async function*(): AsyncIterable<LlmChunk> {
        fourHundredCalls += 1;
        yield { type: 'done', finishReason: 'error', error: 'OpenRouter 400 Bad Request' };
      },
      signal: new AbortController().signal,
      round: 0,
      providerId: 'openrouter',
      providerModelId: 'test-model',
    });

    expect(fourHundred).toMatchObject({ status: 'errored', retryAttempts: 0 });
    expect(fourHundredCalls).toBe(1);
  });
});

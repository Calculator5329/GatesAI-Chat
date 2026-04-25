import type { LlmChunk, LlmProvider, LlmRequest, ProviderId } from '../../src/core/llm';
import type { ProviderStore } from '../../src/stores/ProviderStore';
import type { LlmRouter } from '../../src/services/llm';

/**
 * A scriptable in-memory LlmProvider for tests. Records every call and
 * returns whatever chunks the test asks for, with a tiny `await` to give
 * MobX reactions a chance to settle between yields.
 */
export class MockProvider implements LlmProvider {
  readonly id: ProviderId = 'openai';
  calls: LlmRequest[] = [];
  abortedAt: number | null = null;

  constructor(private chunks: LlmChunk[] = [{ type: 'text', delta: 'ok' }, { type: 'done', finishReason: 'stop' }]) {}

  setChunks(chunks: LlmChunk[]): void { this.chunks = chunks; }

  ready(): boolean { return true; }

  async *stream(req: LlmRequest, signal: AbortSignal): AsyncIterable<LlmChunk> {
    this.calls.push(req);
    let i = 0;
    for (const chunk of this.chunks) {
      if (signal.aborted) { this.abortedAt = i; return; }
      await Promise.resolve();
      yield chunk;
      i++;
    }
  }
}

/** Replaces every provider in the router so tests are deterministic. */
export function installMockProvider(providers: ProviderStore, mock: MockProvider): void {
  // The router exposes `get(id)` reads only, so we monkey-patch the resolution.
  const router = providers.router as LlmRouter & {
    resolve: (modelId: string) => { provider: LlmProvider; providerModelId: string };
  };
  router.resolve = (modelId: string) => ({ provider: mock, providerModelId: modelId });
}

/** Drains pending microtasks so MobX reactions and the stream loop settle. */
export async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

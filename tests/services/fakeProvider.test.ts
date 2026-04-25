import { describe, expect, it } from 'vitest';
import { FakeProvider } from '../../src/services/llm';
import type { LlmRequest } from '../../src/core/llm';

const request: LlmRequest = {
  modelId: 'fake',
  messages: [{ role: 'user', content: 'hello' }],
};

async function firstTextChunk(provider: FakeProvider): Promise<string> {
  const controller = new AbortController();
  for await (const chunk of provider.stream(request, controller.signal)) {
    if (chunk.type === 'text') {
      controller.abort();
      return chunk.delta;
    }
  }
  return '';
}

describe('FakeProvider', () => {
  it('keeps canned response rotation scoped to each provider instance', async () => {
    await expect(firstTextChunk(new FakeProvider())).resolves.toBe(
      await firstTextChunk(new FakeProvider())
    );
  });
});

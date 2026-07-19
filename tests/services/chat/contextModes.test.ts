import { describe, expect, it } from 'vitest';
import type { Model, Thread } from '../../../src/core/types';
import { SMALL_LOCAL_CONTEXT_TOKENS } from '../../../src/core/localModelMeta';
import { effectiveContextMode } from '../../../src/services/chat/contextModes';

function localModel(providerModelId: string, patch: Partial<Model> = {}): Model {
  return {
    id: `ollama-${providerModelId}`,
    name: providerModelId,
    vendor: 'Ollama',
    providerId: 'ollama',
    providerModelId,
    ...patch,
  };
}

function thread(): Thread {
  return {
    id: 'thread-id',
    title: 'Test Thread',
    subtitle: '',
    createdAt: 1,
    updatedAt: 1,
    pinned: false,
    modelId: 'ollama-test',
    messages: [{ id: 'message-id', role: 'user', content: 'test', createdAt: 2 }],
  };
}

describe('effectiveContextMode', () => {
  it('selects micro mode for small local models below the context threshold', () => {
    const tinyModel = localModel('tiny', { contextLength: SMALL_LOCAL_CONTEXT_TOKENS - 1 });

    expect(effectiveContextMode(thread(), tinyModel)).toBe('micro');
  });

  it('keeps bare mode for tiny local models when explicitly set', () => {
    const tinyModel = localModel('tiny', { contextLength: SMALL_LOCAL_CONTEXT_TOKENS - 1 });
    const tinyThread = thread();
    tinyThread.contextMode = 'bare';

    expect(effectiveContextMode(tinyThread, tinyModel)).toBe('bare');
  });

  it('keeps full mode for local models at or above the context threshold when unset', () => {
    const largeModel = localModel('large', { contextLength: SMALL_LOCAL_CONTEXT_TOKENS });

    expect(effectiveContextMode(thread(), largeModel)).toBe('full');
  });
});

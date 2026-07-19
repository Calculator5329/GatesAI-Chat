import { describe, expect, it } from 'vitest';
import {
  localModelContextLength,
  localModelContextProfile,
  localModelMetaFor,
  SMALL_LOCAL_CONTEXT_TOKENS,
} from '../../src/core/localModelMeta';
import type { Model } from '../../src/core/types';

function model(providerModelId: string, patch: Partial<Model> = {}): Model {
  return {
    id: `ollama-${providerModelId}`,
    name: providerModelId,
    vendor: 'Ollama',
    providerId: 'ollama',
    providerModelId,
    dynamic: true,
    ...patch,
  };
}

describe('localModelMetaFor', () => {
  it('matches qwen coder before generic qwen', () => {
    const meta = localModelMetaFor(model('qwen2.5-coder:14b'));

    expect(meta?.family).toBe('qwen-coder');
    expect(meta?.capabilities).toContain('tools');
    expect(meta?.capabilities).toContain('fast');
    expect(meta?.costLabel).toBe('LOCAL');
  });

  it('uses real context metadata before family defaults', () => {
    const m = model('qwen2.5-coder:14b', { contextLength: 65_536 });

    expect(localModelContextLength(m)).toBe(65_536);
  });

  it('adds vision chips for llava family matches', () => {
    const meta = localModelMetaFor(model('llava:13b'));

    expect(meta?.family).toBe('llava');
    expect(meta?.capabilities).toContain('vision');
  });

  it('uses a slim context profile for local models below the small-context threshold', () => {
    const meta = model('small-local', { contextLength: SMALL_LOCAL_CONTEXT_TOKENS - 1 });

    expect(localModelContextProfile(meta)).toBe('slim');
  });

  it('uses full context profile for local models at or above the threshold', () => {
    const meta = model('large-local', { contextLength: SMALL_LOCAL_CONTEXT_TOKENS });

    expect(localModelContextProfile(meta)).toBe('full');
  });
});

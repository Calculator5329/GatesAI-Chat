import { describe, expect, it } from 'vitest';
import {
  localModelContextLength,
  localModelContextProfile,
  localModelMaxContextLength,
  localModelMetaFor,
  localModelParameterBillions,
  SMALL_LOCAL_CONTEXT_TOKENS,
} from '../../src/core/localModelMeta';
import { badgesForModel } from '../../src/core/modelPicker';
import type { OllamaCatalogModel } from '../../src/core/localModelMeta';

function model(providerModelId: string, patch: Partial<OllamaCatalogModel> = {}): OllamaCatalogModel {
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

  it('shows tools and reasoning that Ollama reported, even for a blocklisted family', () => {
    const meta = localModelMetaFor(model('gemma4:12b', { supportsTools: true, supportsThinking: true }));

    expect(meta?.capabilities).toEqual(expect.arrayContaining(['tools', 'reasoning']));
  });

  it('shows the reported maximum context as a ceiling without feeding the working window', () => {
    const gemma = model('gemma4:12b', { maxContextLength: 262_144 });

    expect(localModelMaxContextLength(gemma)).toBe(262_144);
    expect(localModelContextLength(gemma)).toBe(8_192);
    expect(badgesForModel(gemma)).toContainEqual(expect.objectContaining({ label: 'up to 262K' }));
  });

  it('prefers the reported parameter size over the tag name', () => {
    expect(localModelParameterBillions(model('gemma4:12b', { parameterBillions: 12.2 }))).toBe(12.2);
    expect(localModelParameterBillions(model('qwen2.5:7b'))).toBe(7);
    expect(localModelParameterBillions(model('llama3.2:latest'))).toBeUndefined();
  });

  it('does not describe an Ollama cloud model as local', () => {
    const meta = localModelMetaFor(model('gpt-oss:120b-cloud', { remoteHost: 'https://ollama.com:443' }));

    expect(meta?.tag).toBe('Ollama cloud model');
    expect(localModelMetaFor(model('llama3.1:8b'))?.tag).toBe('local general chat model');
  });

  it('badges an Ollama cloud model as cloud, never local', () => {
    const labels = badgesForModel(model('gpt-oss:120b-cloud', { remoteHost: 'https://ollama.com:443' })).map(badge => badge.label);

    expect(labels).toContain('CLOUD');
    expect(labels).not.toContain('LOCAL');
    expect(badgesForModel(model('llama3.1:8b')).map(badge => badge.label)).toContain('LOCAL');
  });

  it('keeps the name rules and family table when capabilities were not reported', () => {
    expect(localModelMetaFor(model('gemma2:9b'))?.capabilities).not.toContain('tools');
    expect(localModelMetaFor(model('deepseek-r1:8b'))?.capabilities).toContain('reasoning');
    expect(localModelMetaFor(model('deepseek-r1:8b', { supportsThinking: false }))?.capabilities).not.toContain('reasoning');
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

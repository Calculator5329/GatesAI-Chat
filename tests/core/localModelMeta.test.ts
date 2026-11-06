import { describe, expect, it } from 'vitest';
import {
  localModelContextLength,
  localModelContextProfile,
  localModelMaxContextLength,
  localModelMetaFor,
  localModelParameterBillions,
  COMPACT_LOCAL_CONTEXT_TOKENS,
  SMALL_LOCAL_CONTEXT_TOKENS,
} from '../../src/core/localModelMeta';
import { badgesForModel } from '../../src/core/modelPicker';
import { contextWindowFor, OLLAMA_DEFAULT_CONTEXT_TOKENS } from '../../src/core/tokens';
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
    // No Modelfile num_ctx and none sent: Ollama loads it at its own 4096 default
    // (measured on Ollama 0.40.4, 2026-11-05), not the family's trained size.
    expect(localModelContextLength(gemma)).toBe(OLLAMA_DEFAULT_CONTEXT_TOKENS);
    expect(contextWindowFor(gemma)).toBe(OLLAMA_DEFAULT_CONTEXT_TOKENS);
    expect(badgesForModel(gemma)).toContainEqual(expect.objectContaining({ label: 'up to 262K' }));
  });

  it('decides the slim profile from the loaded window, never the family table', () => {
    // qwen's family row says 128K, but an unconfigured qwen still loads at 4096.
    expect(localModelContextProfile(model('qwen3.5:9b', { maxContextLength: 262_144 }))).toBe('slim');
    // A Modelfile `num_ctx 16384` (read from /api/show) lifts it out of micro, into the compact tier.
    expect(localModelContextProfile(model('gemma4-abliterated:26b', { contextLength: 16_384 }))).toBe('compact');
    expect(contextWindowFor(model('gemma4-abliterated:26b', { contextLength: 16_384 }))).toBe(16_384);
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

  it('uses the compact profile from the small threshold up to the compact one', () => {
    expect(localModelContextProfile(model('mid-local', { contextLength: SMALL_LOCAL_CONTEXT_TOKENS }))).toBe('compact');
    expect(localModelContextProfile(model('mid-local', { contextLength: COMPACT_LOCAL_CONTEXT_TOKENS - 1 }))).toBe('compact');
  });

  it('uses full context profile for local models at or above the compact threshold', () => {
    const meta = model('large-local', { contextLength: COMPACT_LOCAL_CONTEXT_TOKENS });

    expect(localModelContextProfile(meta)).toBe('full');
  });

  it('never gives an Ollama cloud model the 4096 local fallback (review F4)', () => {
    const cloud = model('gpt-oss:120b-cloud', { remoteHost: 'https://ollama.com:443', maxContextLength: 131_072 });
    expect(localModelContextProfile(cloud)).toBe('full');
    expect(localModelContextLength(cloud)).toBe(131_072);
    // Nothing reported: still full, budgeted at no less than the compact threshold.
    const unreported = model('mystery:cloud', { remoteHost: 'https://ollama.com:443' });
    expect(localModelContextProfile(unreported)).toBe('full');
    expect(localModelContextLength(unreported)).toBeGreaterThanOrEqual(COMPACT_LOCAL_CONTEXT_TOKENS);
  });
});

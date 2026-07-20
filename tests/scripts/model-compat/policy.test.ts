import { describe, expect, it } from 'vitest';
import type { OpenRouterCatalogModel } from '../../../scripts/model-compat/catalog';
import { auditCompatibilityCatalog, CURSOR_COMPAT_NOTICE } from '../../../scripts/model-compat/policy';

function model(id: string, created: number, extra: Partial<OpenRouterCatalogModel> = {}): OpenRouterCatalogModel {
  return {
    id,
    name: id,
    created,
    supported_parameters: ['max_tokens', 'tools'],
    architecture: { output_modalities: ['text'] },
    pricing: { prompt: '0.000001', completion: '0.000002' },
    ...extra,
  };
}

function viableCatalog(): OpenRouterCatalogModel[] {
  return [
    model('anthropic/claude-3.7-sonnet', 90),
    model('anthropic/claude-sonnet-4', 100),
    model('anthropic/claude-opus-4', 110),
    model('anthropic/claude-sonnet-5', 200),
    model('google/gemini-2.0-flash', 100),
    model('google/gemini-2.5-pro', 110),
    model('google/gemini-3-flash', 120),
    model('openai/gpt-5', 100),
    model('openai/gpt-5-mini', 110),
    model('openai/gpt-5.5', 120),
    model('meta-llama/llama-4-scout', 100),
    model('meta-llama/llama-4-maverick', 110),
    model('meta/muse-spark-1.1', 120),
    model('x-ai/grok-4.3', 100),
    model('x-ai/grok-4.20', 110),
    model('x-ai/grok-4.5', 120),
    model('moonshotai/kimi-k2', 100),
    model('moonshotai/kimi-k2.6', 110),
    model('moonshotai/kimi-k2.7-code', 120),
    model('z-ai/glm-5', 100),
    model('z-ai/glm-5.1', 110),
    model('z-ai/glm-5.2', 120),
    model('nvidia/nemotron-3-nano-30b', 100),
    model('nvidia/nemotron-3-super-120b', 110),
    model('nvidia/nemotron-3-ultra-550b', 120),
    model('deepseek/deepseek-v3.2', 100),
    model('deepseek/deepseek-v4-flash', 110),
    model('deepseek/deepseek-v4-pro', 120),
  ];
}

describe('model compatibility catalog policy', () => {
  it('selects every floor-based route and only the three newest focused-family routes', () => {
    const audit = auditCompatibilityCatalog(viableCatalog(), new Date('2026-07-19T12:00:00Z'));

    expect(audit.passed).toBe(true);
    expect(audit.families.find(family => family.id === 'claude-sonnet-4-plus')?.models.map(item => item.id))
      .toEqual(['anthropic/claude-sonnet-5', 'anthropic/claude-opus-4', 'anthropic/claude-sonnet-4']);
    expect(audit.families.find(family => family.id === 'gemini-2-plus')?.models).toHaveLength(3);
    expect(audit.families.find(family => family.id === 'meta-recent')?.models).toHaveLength(3);
    expect(audit.selected.some(item => item.id === 'anthropic/claude-3.7-sonnet')).toBe(false);
  });

  it('drops expired, image-only, alias, and duplicate free routes', () => {
    const catalog = viableCatalog();
    catalog.push(
      model('x-ai/grok-expired', 999, { expiration_date: '2026-07-18' }),
      model('google/gemini-4-image', 999, { architecture: { output_modalities: ['image'] } }),
      model('openai/gpt-5-image', 999),
      model('meta-llama/llama-guard-4', 999),
      model('nvidia/nemotron-3-content-safety', 999),
      model('~openai/gpt-latest', 999),
      model('deepseek/deepseek-v4-pro:free', 999),
    );

    const audit = auditCompatibilityCatalog(catalog, new Date('2026-07-19T12:00:00Z'));
    const ids = audit.selected.map(item => item.id);

    expect(ids).not.toContain('x-ai/grok-expired');
    expect(ids).not.toContain('google/gemini-4-image');
    expect(ids).not.toContain('openai/gpt-5-image');
    expect(ids).not.toContain('meta-llama/llama-guard-4');
    expect(ids).not.toContain('nvidia/nemotron-3-content-safety');
    expect(ids).not.toContain('~openai/gpt-latest');
    expect(ids).not.toContain('deepseek/deepseek-v4-pro:free');
  });

  it('fails closed when a required family disappears and reports the Cursor boundary', () => {
    const audit = auditCompatibilityCatalog(
      viableCatalog().filter(item => !item.id.startsWith('z-ai/glm-')),
      new Date('2026-07-19T12:00:00Z'),
    );

    expect(audit.passed).toBe(false);
    expect(audit.errors.some(error => error.includes('Recent GLM models'))).toBe(true);
    expect(audit.notices).toContain(CURSOR_COMPAT_NOTICE);
  });
});

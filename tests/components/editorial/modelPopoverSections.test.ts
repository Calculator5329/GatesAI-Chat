import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_ID } from '../../../src/core/models';
import { ModelRegistry } from '../../../src/stores/ModelRegistry';
import { computeModelSections } from '../../../src/components/editorial/modelPopoverSections';
import type { CapabilityFilter, SourceFilter } from '../../../src/core/modelPicker';

function compute(opts: {
  query?: string;
  source?: SourceFilter;
  caps?: ReadonlySet<CapabilityFilter>;
  recentIds?: readonly string[];
  favoriteIds?: readonly string[];
} = {}) {
  const registry = new ModelRegistry();
  return computeModelSections(
    registry,
    opts.query ?? '',
    {
      currentModelId: DEFAULT_MODEL_ID,
      source: opts.source ?? 'auto',
      caps: opts.caps ?? new Set(),
      recentIds: opts.recentIds ?? [],
      runtime: { webLite: false, ollamaOnline: false, comfyReady: false },
    },
    opts.favoriteIds ?? [],
  );
}

describe('computeModelSections', () => {
  it('builds the default recommended and verified sections', () => {
    const result = compute();

    expect(result.sourceTabs).toEqual(['auto', 'cloud']);
    expect(result.effectiveSource).toBe('auto');
    expect(result.displaySections.map(section => section.title)).toContain('Recommended');
    expect(result.displaySections.map(section => section.title)).toContain('Verified');
    expect(result.flatIndexById.get('auto-gemini-3-flash')).toBe(0);
    expect(result.flatIndexById.get(DEFAULT_MODEL_ID)).toBe(1);
  });

  it('puts favorites first and exposes favorite lookup state', () => {
    const result = compute({ favoriteIds: ['or-gpt-5.5'] });

    expect(result.displaySections[0]?.title).toBe('Favorites');
    expect(result.displaySections[0]?.models.map(model => model.id)).toContain('or-gpt-5.5');
    expect(result.favoriteSet.has('or-gpt-5.5')).toBe(true);
  });

  it('filters query results across the full model list', () => {
    const result = compute({ query: 'kimi' });
    const ids = result.flat.map(model => model.id);

    expect(ids).toContain('or-kimi-k2.6');
    expect(ids.every(id => id.toLowerCase().includes('kimi'))).toBe(true);
    expect(result.hiddenCount).toBe(result.totalMatching - result.flat.length);
  });

  it('uses the persisted source only when that source is available', () => {
    const result = compute({ source: 'local' });

    expect(result.sourceTabs).toEqual(['auto', 'cloud']);
    expect(result.effectiveSource).toBe('auto');
  });
});

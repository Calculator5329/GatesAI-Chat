import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_ID } from '../../../src/core/models';
import { ModelRegistry } from '../../../src/stores/ModelRegistry';
import { computeModelSections } from '../../../src/components/editorial/modelPopoverSections';
import type { CapabilityFilter, SourceFilter } from '../../../src/core/modelPicker';
import type { Model } from '../../../src/core/types';

function compute(opts: {
  query?: string;
  source?: SourceFilter;
  caps?: ReadonlySet<CapabilityFilter>;
  recentIds?: readonly string[];
  favoriteIds?: readonly string[];
  registry?: ModelRegistry;
  ollamaOnline?: boolean;
  defaultModelId?: string;
} = {}) {
  const registry = opts.registry ?? new ModelRegistry();
  return computeModelSections(
    registry,
    opts.query ?? '',
    {
      currentModelId: DEFAULT_MODEL_ID,
      defaultModelId: opts.defaultModelId,
      source: opts.source ?? 'auto',
      caps: opts.caps ?? new Set(),
      recentIds: opts.recentIds ?? [],
      runtime: {
        webLite: false,
        ollamaOnline: opts.ollamaOnline ?? false,
        comfyReady: false,
      },
    },
    opts.favoriteIds ?? [],
  );
}

// A row's identity is its route; Auto is a routing choice that shares Gemini
// Flash's route but is its own row.
function routeOf(model: Model): string {
  return model.id === 'auto-gemini-3-flash' ? model.id : `${model.providerId}::${model.providerModelId}`;
}

function sectionIds(result: ReturnType<typeof compute>, title: string): string[] | undefined {
  return result.displaySections.find(section => section.title === title)?.models.map(model => model.id);
}

function liveTwin(slug: string): Model {
  return {
    id: `or-live-${slug.replace(/[^a-zA-Z0-9_.-]/g, '_')}`,
    name: slug,
    vendor: 'OpenRouter',
    providerId: 'openrouter',
    providerModelId: slug,
    dynamic: true,
  };
}

describe('computeModelSections', () => {
  it('builds the default recommended and verified sections', () => {
    const result = compute();

    expect(result.sourceTabs).toEqual(['auto', 'cloud', 'local']);
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

  it('keeps a persisted local source available for offline setup guidance', () => {
    const result = compute({ source: 'local' });

    expect(result.sourceTabs).toEqual(['auto', 'cloud', 'local']);
    expect(result.effectiveSource).toBe('local');
    expect(result.displaySections).toEqual([]);
  });

  it('includes first-class local recommendations when Ollama is online', () => {
    const registry = new ModelRegistry();
    registry.setDynamicForProvider('ollama', [
      {
        id: 'ollama-gemma2:9b',
        name: 'gemma2:9b',
        vendor: 'Ollama',
        providerId: 'ollama',
        providerModelId: 'gemma2:9b',
        dynamic: true,
        supportsTools: false,
        contextLength: 128_000,
      },
      {
        id: 'ollama-qwen2.5-coder:14b',
        name: 'qwen2.5-coder:14b',
        vendor: 'Ollama',
        providerId: 'ollama',
        providerModelId: 'qwen2.5-coder:14b',
        dynamic: true,
        contextLength: 128_000,
      },
    ]);

    const result = compute({
      registry,
      ollamaOnline: true,
      source: 'local',
      defaultModelId: 'ollama-qwen2.5-coder:14b',
    });

    expect(result.sourceTabs).toEqual(['auto', 'cloud', 'local']);
    expect(result.effectiveSource).toBe('local');
    expect(result.defaultModelId).toBe('ollama-qwen2.5-coder:14b');
    expect(result.displaySections[0]).toMatchObject({
      title: 'Recommended',
      models: [expect.objectContaining({ id: 'ollama-qwen2.5-coder:14b' })],
    });
    expect(result.displaySections.map(section => section.title)).toContain('Local');
  });

  it('lists each model once outside Favorites, even when it is also a recent pick', () => {
    const result = compute({ recentIds: ['or-gpt-6-sol', 'or-kimi-k2.5'] });
    const routes = result.displaySections
      .filter(section => section.title !== 'Favorites')
      .flatMap(section => section.models.map(routeOf));

    expect(routes).toEqual([...new Set(routes)]);
    expect(sectionIds(result, 'Recent')).toEqual(['or-kimi-k2.5']);
  });

  it('treats a curated recent pick and its live catalog twin as one model', () => {
    const registry = new ModelRegistry();
    // GPT-5.5 is curated but not Verified; GPT-6 Sol is Verified. The second
    // recent id is the live row someone picked before GPT-6 Sol was curated.
    registry.setDynamicForProvider('openrouter', [liveTwin('openai/gpt-5.5'), liveTwin('openai/gpt-6-sol')]);
    const result = compute({ registry, recentIds: ['or-gpt-5.5', 'or-live-openai_gpt-6-sol'] });

    expect(sectionIds(result, 'Recent')).toEqual(['or-gpt-5.5']);
    expect(sectionIds(result, 'Verified')).toContain('or-gpt-6-sol');
  });

  it('shows recent picks in a source tab once, above the browse list', () => {
    const browseFirst = sectionIds(compute({ source: 'cloud' }), 'Cloud')?.[0];
    expect(browseFirst).toBeDefined();
    // or-kimi-k2.5 sits past the browse limit, so Recent is its only row.
    const result = compute({ source: 'cloud', recentIds: [browseFirst!, 'or-kimi-k2.5'] });
    const titles = result.displaySections.map(section => section.title);

    expect(sectionIds(result, 'Recent')).toEqual([browseFirst, 'or-kimi-k2.5']);
    expect(sectionIds(result, 'Cloud')).not.toContain(browseFirst);
    expect(titles.indexOf('Recent')).toBeLessThan(titles.indexOf('Cloud'));
  });
});

import { describe, expect, it } from 'vitest';
import { ModelRegistry } from '../../src/stores/ModelRegistry';
import { DEFAULT_OPENROUTER_CATALOG_MODEL_IDS } from '../../src/core/models';
import { isVerifiedModelId } from '../../src/core/modelPickerAvailability';
import type { Model } from '../../src/core/types';

// Regression: when the live OpenRouter catalog ships an entry that shares a
// curated model's providerModelId, `all` dedupes the curated id away. The model
// picker's "Verified" section must still resolve every curated id (via
// findById), otherwise the section collapses to only the not-yet-live entries.
describe('ModelRegistry verified resolution under live supersession', () => {
  it('recovers a curated verified id even after a dynamic entry supersedes it', () => {
    const registry = new ModelRegistry();
    const curated = registry.curated.find(m => m.id === 'or-gpt-5.5');
    expect(curated).toBeDefined();

    const dynamicTwin: Model = {
      id: 'dyn-openai-gpt-5.5',
      name: 'GPT-5.5 (live)',
      vendor: 'OpenAI',
      providerId: 'openrouter',
      providerModelId: curated!.providerModelId, // same slug => supersedes
      dynamic: true,
    };
    registry.setDynamicForProvider('openrouter', [dynamicTwin]);

    // The curated id is gone from `all` (deduped by providerId::providerModelId)…
    expect(registry.all.some(m => m.id === 'or-gpt-5.5')).toBe(false);
    // …but findById still resolves it, hydrated with the live data.
    const resolved = registry.findById('or-gpt-5.5');
    expect(resolved).toBeDefined();
    expect(resolved!.id).toBe('or-gpt-5.5');
    expect(resolved!.name).toBe('GPT-5.5 (live)');
    expect(isVerifiedModelId('or-gpt-5.5')).toBe(true);
  });

  it('resolves the whole verified catalog when every entry is superseded live', () => {
    const registry = new ModelRegistry();
    const twins: Model[] = registry.curated
      .filter(m => DEFAULT_OPENROUTER_CATALOG_MODEL_IDS.includes(m.id as never))
      .map((m, i) => ({
        id: `dyn-${i}`,
        name: `${m.name} (live)`,
        vendor: m.vendor,
        providerId: 'openrouter',
        providerModelId: m.providerModelId,
        dynamic: true,
      }));
    registry.setDynamicForProvider('openrouter', twins);

    const resolved = DEFAULT_OPENROUTER_CATALOG_MODEL_IDS
      .map(id => registry.findById(id))
      .filter(Boolean);
    expect(resolved).toHaveLength(DEFAULT_OPENROUTER_CATALOG_MODEL_IDS.length);
  });
});

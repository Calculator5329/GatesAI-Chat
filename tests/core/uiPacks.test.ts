import { describe, expect, it } from 'vitest';
import { DEFAULT_UI_PACK, UI_PACKS, coerceUiPack, isUiPackKey, uiPackMeta } from '../../src/core/uiPacks';

describe('uiPacks registry', () => {
  it('ships Classic as the default and keeps it first', () => {
    expect(DEFAULT_UI_PACK).toBe('classic');
    expect(UI_PACKS[0].key).toBe('classic');
  });

  it('gives every pack a unique key, a name, and a description', () => {
    const keys = UI_PACKS.map(pack => pack.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const pack of UI_PACKS) {
      expect(pack.name.trim().length).toBeGreaterThan(0);
      expect(pack.description.trim().length).toBeGreaterThan(0);
    }
  });

  it('coerces anything unrecognised back to the default', () => {
    // Persisted prefs outlive the registry: a pack removed in a later version
    // must degrade to Classic rather than render nothing.
    expect(coerceUiPack('aurora')).toBe('aurora');
    expect(coerceUiPack('elements')).toBe(DEFAULT_UI_PACK);
    expect(coerceUiPack(undefined)).toBe(DEFAULT_UI_PACK);
    expect(coerceUiPack(7)).toBe(DEFAULT_UI_PACK);
  });

  it('recognises exactly the registered keys', () => {
    expect(isUiPackKey('classic')).toBe(true);
    expect(isUiPackKey('aurora')).toBe(true);
    expect(isUiPackKey('Aurora')).toBe(false);
  });

  it('resolves metadata by key', () => {
    expect(uiPackMeta('aurora').key).toBe('aurora');
    expect(uiPackMeta('classic').name).toBe('Classic');
  });
});

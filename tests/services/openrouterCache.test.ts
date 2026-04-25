import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearOpenRouterCache,
  loadOpenRouterCache,
  saveOpenRouterCache,
} from '../../src/services/openrouterCache';
import { clearAppStorage } from '../helpers/storage';

describe('openrouterCache', () => {
  beforeEach(() => clearAppStorage());
  afterEach(() => clearAppStorage());

  it('returns null when nothing is stored', () => {
    expect(loadOpenRouterCache()).toBeNull();
  });

  it('roundtrips a snapshot', () => {
    const snap = {
      fetchedAt: 1234,
      models: [{
        id: 'or-live-x',
        name: 'X',
        vendor: 'Test',
        providerId: 'openrouter' as const,
        providerModelId: 'x',
        dynamic: true,
      }],
    };
    saveOpenRouterCache(snap);
    expect(loadOpenRouterCache()).toEqual(snap);
  });

  it('returns null on malformed payload', () => {
    localStorage.setItem('gatesai.openrouter.catalog.v1', 'not json');
    expect(loadOpenRouterCache()).toBeNull();
  });

  it('clearOpenRouterCache wipes the entry', () => {
    saveOpenRouterCache({ fetchedAt: 1, models: [] });
    clearOpenRouterCache();
    expect(loadOpenRouterCache()).toBeNull();
  });
});

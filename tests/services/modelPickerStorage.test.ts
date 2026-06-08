import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadFavoriteModelIds, toggleFavoriteModelId } from '../../src/services/storage/modelPickerStorage';
import { clearAppStorage } from '../helpers/storage';

describe('modelPickerStorage favorites', () => {
  beforeEach(() => clearAppStorage());
  afterEach(() => clearAppStorage());

  it('starts with no favorites', () => {
    expect(loadFavoriteModelIds()).toEqual([]);
  });

  it('toggles favorites on and off (round trip)', () => {
    expect(toggleFavoriteModelId('or-gpt-5.5')).toEqual(['or-gpt-5.5']);
    expect(loadFavoriteModelIds()).toEqual(['or-gpt-5.5']);

    expect(toggleFavoriteModelId('or-claude-opus-latest')).toEqual(['or-gpt-5.5', 'or-claude-opus-latest']);
    expect(loadFavoriteModelIds()).toEqual(['or-gpt-5.5', 'or-claude-opus-latest']);

    expect(toggleFavoriteModelId('or-gpt-5.5')).toEqual(['or-claude-opus-latest']);
    expect(loadFavoriteModelIds()).toEqual(['or-claude-opus-latest']);
  });

  it('falls back to an empty list when stored data is corrupt', () => {
    localStorage.setItem('gatesai.modelPicker.favorites.v1', 'not json');
    expect(loadFavoriteModelIds()).toEqual([]);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ImageGenStore } from '../../src/stores/ImageGenStore';
import { clearAppStorage } from '../helpers/storage';

describe('ImageGenStore', () => {
  beforeEach(() => clearAppStorage());
  afterEach(() => clearAppStorage());

  it('keeps prompt enhancement off unless the user opts in', () => {
    const store = new ImageGenStore();

    expect(store.toBackendConfig().promptEnhancement).toBe('off');

    store.setPromptEnhancement('llm');
    expect(store.toBackendConfig().promptEnhancement).toBe('llm');
  });
});

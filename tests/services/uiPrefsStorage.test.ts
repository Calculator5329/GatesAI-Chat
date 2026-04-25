import { beforeEach, describe, expect, it } from 'vitest';
import { clearAppStorage } from '../helpers/storage';
import { loadUiPrefs, saveUiPrefs } from '../../src/services/uiPrefsStorage';

describe('uiPrefsStorage', () => {
  beforeEach(() => clearAppStorage());

  it('loads default markdown and code appearance preferences', () => {
    expect(loadUiPrefs()).toEqual({
      toolCallStyle: 'aside',
      markdownStyle: 'compact',
      codeStyle: 'obsidian',
      markdownDensity: 'compact',
      codeSize: 'medium',
    });
  });

  it('round-trips markdown and code appearance preferences', () => {
    saveUiPrefs({
      toolCallStyle: 'aside',
      markdownStyle: 'technical',
      codeStyle: 'terminal',
      markdownDensity: 'compact',
      codeSize: 'large',
    });

    expect(loadUiPrefs()).toEqual({
      toolCallStyle: 'aside',
      markdownStyle: 'technical',
      codeStyle: 'terminal',
      markdownDensity: 'compact',
      codeSize: 'large',
    });
  });

  it('falls back per field when persisted values are invalid', () => {
    localStorage.setItem('gatesai.uiprefs.v1', JSON.stringify({
      toolCallStyle: 'wat',
      markdownStyle: 'loud',
      codeStyle: 'neon',
      markdownDensity: 'tiny',
      codeSize: 'huge',
    }));

    expect(loadUiPrefs()).toEqual({
      toolCallStyle: 'aside',
      markdownStyle: 'compact',
      codeStyle: 'obsidian',
      markdownDensity: 'compact',
      codeSize: 'medium',
    });
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { clearAppStorage } from '../helpers/storage';
import { loadUiPrefs, saveUiPrefs } from '../../src/services/uiPrefsStorage';

const DEFAULTS = {
  markdownStyle: 'compact',
  codeStyle: 'obsidian',
  markdownDensity: 'compact',
  codeSize: 'medium',
  bodyFontSizePx: 17,
  readingWidthPx: 720,
  animationsEnabled: true,
  onboardingDismissed: false,
  theme: 'dark',
} as const;

describe('uiPrefsStorage', () => {
  beforeEach(() => clearAppStorage());

  it('loads default markdown and code appearance preferences', () => {
    expect(loadUiPrefs()).toEqual(DEFAULTS);
  });

  it('normalizes persisted appearance preferences to the fixed foundation defaults', () => {
    saveUiPrefs({
      markdownStyle: 'technical',
      codeStyle: 'terminal',
      markdownDensity: 'spacious',
      codeSize: 'large',
      bodyFontSizePx: 19,
      readingWidthPx: 860,
      animationsEnabled: false,
      onboardingDismissed: true,
      theme: 'light',
    });

    expect(loadUiPrefs()).toEqual({ ...DEFAULTS, onboardingDismissed: true, theme: 'light' });
  });

  it('falls back per field when persisted values are invalid', () => {
    localStorage.setItem('gatesai.uiprefs.v1', JSON.stringify({
      toolCallStyle: 'wat',
      markdownStyle: 'loud',
      codeStyle: 'neon',
      markdownDensity: 'tiny',
      codeSize: 'huge',
      bodyFontSizePx: 'big',
      readingWidthPx: 999,
      animationsEnabled: 'sure',
      onboardingDismissed: 'nope',
      theme: 'sepia',
    }));

    expect(loadUiPrefs()).toEqual(DEFAULTS);
  });

  it('round-trips system theme mode', () => {
    saveUiPrefs({ ...DEFAULTS, theme: 'system' });
    expect(loadUiPrefs().theme).toBe('system');
  });

  it('clamps font size to the supported range', () => {
    saveUiPrefs({ ...DEFAULTS, bodyFontSizePx: 99 });
    expect(loadUiPrefs().bodyFontSizePx).toBe(DEFAULTS.bodyFontSizePx);
    saveUiPrefs({ ...DEFAULTS, bodyFontSizePx: 1 });
    expect(loadUiPrefs().bodyFontSizePx).toBe(DEFAULTS.bodyFontSizePx);
  });
});

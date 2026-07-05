/**
 * Fixed foundation UI preferences. The retired Appearance tab used to persist
 * these choices, but the app now normalizes them to one supported presentation.
 */

import type { CodeSizeKey, CodeStyleKey, MarkdownDensityKey, MarkdownStyleKey, ThemeMode } from '../core/types';
import { createJsonPersistenceProvider } from './storage/persistenceProvider';

export interface UiPrefsSnapshot {
  markdownStyle: MarkdownStyleKey;
  codeStyle: CodeStyleKey;
  markdownDensity: MarkdownDensityKey;
  codeSize: CodeSizeKey;
  bodyFontSizePx: number;
  readingWidthPx: number;
  animationsEnabled: boolean;
  onboardingDismissed: boolean;
  theme: ThemeMode;
}

const KEY = 'gatesai.uiprefs.v1';
export const DEFAULT_UI_PREFS: UiPrefsSnapshot = {
  markdownStyle: 'compact',
  codeStyle: 'obsidian',
  markdownDensity: 'compact',
  codeSize: 'medium',
  bodyFontSizePx: 17,
  readingWidthPx: 720,
  animationsEnabled: true,
  onboardingDismissed: false,
  theme: 'dark',
};

export const uiPrefsPersistence = createJsonPersistenceProvider<UiPrefsSnapshot>({
  key: KEY,
  parse: raw => {
    const parsed = raw && typeof raw === 'object' ? raw as Partial<UiPrefsSnapshot> : {};
    return {
      ...DEFAULT_UI_PREFS,
      onboardingDismissed: typeof parsed.onboardingDismissed === 'boolean'
        ? parsed.onboardingDismissed
        : DEFAULT_UI_PREFS.onboardingDismissed,
      theme: isThemeMode(parsed.theme) ? parsed.theme : DEFAULT_UI_PREFS.theme,
    };
  },
});

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'dark' || value === 'light' || value === 'system';
}

export function loadUiPrefs(): UiPrefsSnapshot {
  return uiPrefsPersistence.load();
}

export function saveUiPrefs(snap: UiPrefsSnapshot): void {
  uiPrefsPersistence.save({ ...DEFAULT_UI_PREFS, onboardingDismissed: snap.onboardingDismissed, theme: snap.theme });
}

/**
 * Fixed foundation UI preferences. The retired Appearance tab used to persist
 * these choices, but the app now normalizes them to one supported presentation.
 */

import type { CodeSizeKey, CodeStyleKey, MarkdownDensityKey, MarkdownStyleKey, ThemeMode } from '../core/types';
import { DEFAULT_GLOBAL_SUMMON_CHORD } from '../core/shortcutChord';
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
  globalSummonEnabled: boolean;
  globalSummonChord: string;
  closeButtonHidesToTray: boolean;
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
  // Ctrl+Shift+Space avoids Alt+Space (Windows system menu) and Ctrl+Space
  // collisions with IMEs and editors while staying easy to press.
  globalSummonEnabled: true,
  globalSummonChord: DEFAULT_GLOBAL_SUMMON_CHORD,
  closeButtonHidesToTray: false,
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
      globalSummonEnabled: typeof parsed.globalSummonEnabled === 'boolean'
        ? parsed.globalSummonEnabled
        : DEFAULT_UI_PREFS.globalSummonEnabled,
      globalSummonChord: typeof parsed.globalSummonChord === 'string' && parsed.globalSummonChord.trim().length > 0
        ? parsed.globalSummonChord
        : DEFAULT_UI_PREFS.globalSummonChord,
      closeButtonHidesToTray: typeof parsed.closeButtonHidesToTray === 'boolean'
        ? parsed.closeButtonHidesToTray
        : DEFAULT_UI_PREFS.closeButtonHidesToTray,
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
  uiPrefsPersistence.save({
    ...DEFAULT_UI_PREFS,
    onboardingDismissed: snap.onboardingDismissed,
    theme: snap.theme,
    globalSummonEnabled: snap.globalSummonEnabled,
    globalSummonChord: snap.globalSummonChord,
    closeButtonHidesToTray: snap.closeButtonHidesToTray,
  });
}

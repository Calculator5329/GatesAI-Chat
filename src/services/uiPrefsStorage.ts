/**
 * Fixed foundation UI preferences. The retired Appearance tab used to persist
 * these choices, but the app now normalizes them to one supported presentation.
 */

import type { CodeSizeKey, CodeStyleKey, MarkdownDensityKey, MarkdownStyleKey } from '../core/types';
import { createJsonPersistenceProvider } from './storage/persistenceProvider';

export interface UiPrefsSnapshot {
  markdownStyle: MarkdownStyleKey;
  codeStyle: CodeStyleKey;
  markdownDensity: MarkdownDensityKey;
  codeSize: CodeSizeKey;
  bodyFontSizePx: number;
  readingWidthPx: number;
  animationsEnabled: boolean;
}

const KEY = 'gatesai.uiprefs.v1';
const DEFAULT: UiPrefsSnapshot = {
  markdownStyle: 'compact',
  codeStyle: 'obsidian',
  markdownDensity: 'compact',
  codeSize: 'medium',
  bodyFontSizePx: 17,
  readingWidthPx: 720,
  animationsEnabled: true,
};

export const uiPrefsPersistence = createJsonPersistenceProvider<UiPrefsSnapshot>({
  key: KEY,
  parse: () => DEFAULT,
});

export function loadUiPrefs(): UiPrefsSnapshot {
  return uiPrefsPersistence.load();
}

export function saveUiPrefs(snap: UiPrefsSnapshot): void {
  uiPrefsPersistence.save({ ...snap, ...DEFAULT });
}

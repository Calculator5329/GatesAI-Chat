/**
 * Fixed foundation UI preferences. The retired Appearance tab used to persist
 * these choices, but the app now normalizes them to one supported presentation.
 */

import type { CodeSizeKey, CodeStyleKey, MarkdownDensityKey, MarkdownStyleKey, ToolCallStyleKey } from '../core/types';

export interface UiPrefsSnapshot {
  toolCallStyle: ToolCallStyleKey;
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
  toolCallStyle: 'aside',
  markdownStyle: 'compact',
  codeStyle: 'obsidian',
  markdownDensity: 'compact',
  codeSize: 'medium',
  bodyFontSizePx: 17,
  readingWidthPx: 720,
  animationsEnabled: true,
};

export function loadUiPrefs(): UiPrefsSnapshot {
  return DEFAULT;
}

export function saveUiPrefs(snap: UiPrefsSnapshot): void {
  try { localStorage.setItem(KEY, JSON.stringify({ ...snap, ...DEFAULT })); } catch { /* quota / privacy */ }
}

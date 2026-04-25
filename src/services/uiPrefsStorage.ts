/**
 * Tiny persistence for opt-in UI preferences. Theme keys (accent / bg / etc.)
 * intentionally don't persist — they're tuning, not data. But picks like the
 * tool-call render style are something users actually want to "set and forget,"
 * so they get their own slot here.
 */

import type { CodeSizeKey, CodeStyleKey, MarkdownDensityKey, MarkdownStyleKey, ToolCallStyleKey } from '../core/types';

export interface UiPrefsSnapshot {
  toolCallStyle: ToolCallStyleKey;
  markdownStyle: MarkdownStyleKey;
  codeStyle: CodeStyleKey;
  markdownDensity: MarkdownDensityKey;
  codeSize: CodeSizeKey;
}

const KEY = 'gatesai.uiprefs.v1';
const DEFAULT: UiPrefsSnapshot = {
  toolCallStyle: 'whisper',
  markdownStyle: 'editorial',
  codeStyle: 'obsidian',
  markdownDensity: 'comfortable',
  codeSize: 'medium',
};

const VALID_STYLES: ToolCallStyleKey[] = ['whisper', 'dot', 'aside', 'mark', 'hidden'];
const VALID_MARKDOWN_STYLES: MarkdownStyleKey[] = ['editorial', 'technical', 'compact'];
const VALID_CODE_STYLES: CodeStyleKey[] = ['obsidian', 'terminal', 'paper'];
const VALID_MARKDOWN_DENSITIES: MarkdownDensityKey[] = ['compact', 'comfortable', 'spacious'];
const VALID_CODE_SIZES: CodeSizeKey[] = ['small', 'medium', 'large'];

export function loadUiPrefs(): UiPrefsSnapshot {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw) as Partial<UiPrefsSnapshot>;
    return {
      toolCallStyle: VALID_STYLES.includes(parsed.toolCallStyle as ToolCallStyleKey)
        ? (parsed.toolCallStyle as ToolCallStyleKey)
        : DEFAULT.toolCallStyle,
      markdownStyle: VALID_MARKDOWN_STYLES.includes(parsed.markdownStyle as MarkdownStyleKey)
        ? (parsed.markdownStyle as MarkdownStyleKey)
        : DEFAULT.markdownStyle,
      codeStyle: VALID_CODE_STYLES.includes(parsed.codeStyle as CodeStyleKey)
        ? (parsed.codeStyle as CodeStyleKey)
        : DEFAULT.codeStyle,
      markdownDensity: VALID_MARKDOWN_DENSITIES.includes(parsed.markdownDensity as MarkdownDensityKey)
        ? (parsed.markdownDensity as MarkdownDensityKey)
        : DEFAULT.markdownDensity,
      codeSize: VALID_CODE_SIZES.includes(parsed.codeSize as CodeSizeKey)
        ? (parsed.codeSize as CodeSizeKey)
        : DEFAULT.codeSize,
    };
  } catch {
    return DEFAULT;
  }
}

export function saveUiPrefs(snap: UiPrefsSnapshot): void {
  try { localStorage.setItem(KEY, JSON.stringify(snap)); } catch { /* quota / privacy */ }
}

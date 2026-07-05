// Defines shared theme domain contracts and pure helpers for chat, models, tokens, or workspace paths.
// Called by stores, services, components, and tests; depends on stable TypeScript data shapes.
// Invariant: core modules stay side-effect free except for explicit cache helpers.
import type { ThemeConfig } from './types';

export type ThemeCssVars = Record<string, string>;

interface BgPalette {
  key: string;
  label: string;
  bg: string;
  panel: string;
  panel2: string;
  panel3: string;
}

interface AccentPalette {
  key: string;
  label: string;
  accent: string;
  accent2: string;
  glow: string;
}

export const BGS: BgPalette[] = [
  { key: 'graphite', label: 'Graphite', bg: '#0b0c0e', panel: '#111316', panel2: '#181a1f', panel3: '#1e2127' },
  { key: 'charcoal', label: 'Charcoal', bg: '#121212', panel: '#181818', panel2: '#202020', panel3: '#282828' },
  { key: 'slate',    label: 'Slate',    bg: '#0d0f10', panel: '#13161a', panel2: '#1a1e23', panel3: '#22262c' },
  { key: 'espresso', label: 'Espresso', bg: '#0e0b08', panel: '#15110d', panel2: '#1c1813', panel3: '#231e18' },
  { key: 'pure',     label: 'Pure',     bg: '#000000', panel: '#0a0a0a', panel2: '#121212', panel3: '#1a1a1a' },
];

export const ACCENTS: AccentPalette[] = [
  { key: 'blue',    label: 'Deep Blue', accent: '#5b8cff', accent2: '#7aa7ff', glow: 'rgba(91,140,255,0.35)' },
  { key: 'emerald', label: 'Emerald',   accent: '#3ecf8e', accent2: '#5fe0a7', glow: 'rgba(62,207,142,0.35)' },
  { key: 'violet',  label: 'Violet',    accent: '#a98aff', accent2: '#c3adff', glow: 'rgba(169,138,255,0.35)' },
  { key: 'amber',   label: 'Amber',     accent: '#e8a948', accent2: '#f0c378', glow: 'rgba(232,169,72,0.35)' },
  { key: 'rose',    label: 'Rose',      accent: '#ff7597', accent2: '#ff9bb3', glow: 'rgba(255,117,151,0.35)' },
  { key: 'cyan',    label: 'Cyan',      accent: '#3ccfcf', accent2: '#69e3e3', glow: 'rgba(60,207,207,0.35)' },
  { key: 'ivory',   label: 'Ivory',     accent: '#e8e2d2', accent2: '#f0ece0', glow: 'rgba(232,226,210,0.25)' },
];

export const FONTS = {
  serif: '"Source Serif 4", Iowan Old Style, Apple Garamond, Georgia, serif',
  ui: '"Geist", ui-sans-serif, system-ui, sans-serif',
  mono: '"Geist Mono", ui-monospace, monospace',
} as const;

export function buildTheme(bg: string, accent: string): ThemeConfig {
  const bgPalette = BGS.find(b => b.key === bg) ?? BGS[1];
  const accentPalette = ACCENTS.find(x => x.key === accent) ?? ACCENTS[0];
  return {
    accent: accentPalette.accent,
    accent2: accentPalette.accent2,
    accentGlow: accentPalette.glow,
    bg: bgPalette.bg,
    panel: bgPalette.panel,
    panel2: bgPalette.panel2,
    panel3: bgPalette.panel3,
    border: 'rgba(255,255,255,0.07)',
    text: '#e4e7ef',
    textDim: '#a0a9bd',
    textFaint: '#606778',
    font: FONTS.serif,
    fontUi: FONTS.ui,
    fontMono: FONTS.mono,
  };
}

export function themeToCssVars(t: ThemeConfig): ThemeCssVars {
  return {
    '--accent': t.accent,
    '--accent-2': t.accent2,
    '--accent-glow': t.accentGlow,
    '--accent-contrast': '#06120a',
    '--bg': t.bg,
    '--panel': t.panel,
    '--panel-2': t.panel2,
    '--panel-3': t.panel3,
    '--border': t.border,
    '--text': t.text,
    '--text-dim': t.textDim,
    '--text-faint': t.textFaint,
    '--app-body-bg': '#050608',
    '--app-body-text': '#e7e9ee',
    '--stage-bg': 'radial-gradient(ellipse at 20% 0%, rgba(91,140,255,0.06), transparent 60%), radial-gradient(ellipse at 80% 100%, rgba(120,110,150,0.04), transparent 60%), #050608',
    '--stage-bg-static': '#050608',
    '--hover-wash': 'rgba(255, 255, 255, 0.04)',
    '--hover-wash-soft': 'rgba(255, 255, 255, 0.045)',
    '--hover-wash-strong': 'rgba(255, 255, 255, 0.06)',
    '--surface-wash-1': 'rgba(255,255,255,0.018)',
    '--surface-wash-2': 'rgba(255,255,255,0.02)',
    '--surface-wash-3': 'rgba(255,255,255,0.025)',
    '--surface-wash-5': 'rgba(255,255,255,0.05)',
    '--surface-wash-8': 'rgba(255,255,255,0.08)',
    '--surface-wash-10': 'rgba(255,255,255,0.1)',
    '--surface-active-border': 'rgba(255,255,255,0.16)',
    '--surface-file-text': 'rgba(255,255,255,0.8)',
    '--surface-folder-text': 'rgba(255,255,255,0.7)',
    '--surface-faint': 'rgba(255,255,255,0.25)',
    '--surface-fainter': 'rgba(255,255,255,0.2)',
    '--inset-bg': 'rgba(0,0,0,0.12)',
    '--inset-bg-strong': 'rgba(0,0,0,0.2)',
    '--inset-bg-soft': 'rgba(0,0,0,0.18)',
    '--overlay-scrim': 'rgba(0,0,0,0.56)',
    '--danger': '#ff7597',
    '--danger-2': '#ff9ab3',
    '--danger-muted': '#c96a6a',
    '--danger-soft': '#ffaaaa',
    '--danger-border': 'rgba(255,117,151,0.52)',
    '--danger-bg': 'rgba(255,117,151,0.08)',
    '--danger-border-subtle': 'rgba(255,117,151,0.3)',
    '--danger-alt': '#e57373',
    '--danger-alt-bg': 'rgba(229,115,115,0.08)',
    '--danger-alt-border': 'rgba(229,115,115,0.25)',
    '--danger-pill-bg': 'rgba(229,115,115,0.14)',
    '--warning': '#d19a66',
    '--warning-2': '#e5b84d',
    '--warning-muted': '#c8b87e',
    '--success': '#5fbf7a',
    '--success-2': '#6ee7a7',
    '--success-card-bg': 'rgba(62,207,142,0.04)',
    '--success-card-border': 'rgba(62,207,142,0.2)',
    '--success-pill-bg': 'rgba(62,207,142,0.1)',
    '--success-pill-border': 'rgba(62,207,142,0.4)',
    '--warning-pill-bg': 'rgba(229,184,77,0.12)',
    '--warning-active-bg': 'rgba(232,169,72,0.04)',
    '--semantic-border': 'rgba(113, 185, 138, 0.35)',
    '--semantic-bg': 'rgba(113, 185, 138, 0.06)',
    '--status-blue': '#5b8cff',
    '--status-blue-text': '#8fb0ff',
    '--diff-added': '#7ec8a0',
    '--diff-added-text': '#a8ddb8',
    '--diff-added-bg': 'rgba(95,191,122,0.12)',
    '--diff-added-bg-strong': 'rgba(126,200,160,0.12)',
    '--diff-added-border': 'rgba(126,200,160,0.35)',
    '--diff-removed': '#e08b8b',
    '--diff-removed-text': '#e3a0a0',
    '--diff-removed-bg': 'rgba(201,106,106,0.13)',
    '--diff-removed-bg-soft': 'rgba(201,106,106,0.12)',
    '--diff-removed-border': 'rgba(201,106,106,0.45)',
    '--diff-removed-strong': '#e6a0a0',
    '--folder-attachments': '#7db4e0',
    '--code-obsidian-bg-inline': 'rgba(255,255,255,0.06)',
    '--code-default-bg-block': 'rgba(8, 10, 14, 0.9)',
    '--code-obsidian-bg-block': 'rgba(8, 10, 14, 0.92)',
    '--code-obsidian-head': 'rgba(14, 16, 22, 0.95)',
    '--code-terminal-bg': '#030504',
    '--code-terminal-inline-base': 'rgba(0,0,0,0.36)',
    '--code-terminal-shadow': 'rgba(0,0,0,0.65)',
    '--table-head-bg': 'rgba(255,255,255,0.04)',
    '--toggle-thumb-off': '#e4e7ef',
    '--mermaid-theme': 'dark',
    '--mermaid-bg': '#080a0f',
    '--mermaid-main-bg': '#151922',
    '--mermaid-text': '#e7e9ee',
    '--mermaid-border': '#2a3040',
    '--mermaid-line': '#7aa2ff',
    '--mermaid-secondary': '#10141c',
    '--mermaid-tertiary': '#0d1118',
    '--palette-bg': 'rgba(18, 20, 26, 0.92)',
    '--palette-foot': 'rgba(12, 14, 20, 0.7)',
    '--palette-border': 'rgba(255,255,255,0.08)',
    '--code-bg': 'rgba(6, 8, 12, 0.9)',
    '--code-head': 'rgba(14, 16, 22, 0.95)',
    fontFamily: t.font,
    color: t.text,
  };
}

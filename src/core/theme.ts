import type { AccentKey, BgKey, ThemeConfig } from './types';

export type ThemeCssVars = Record<string, string>;

interface BgPalette {
  key: BgKey;
  label: string;
  bg: string;
  panel: string;
  panel2: string;
  panel3: string;
}

interface AccentPalette {
  key: AccentKey;
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

export function buildTheme(bgKey: BgKey, accentKey: AccentKey): ThemeConfig {
  const bg = BGS.find(b => b.key === bgKey) ?? BGS[1];
  const a = ACCENTS.find(x => x.key === accentKey) ?? ACCENTS[0];
  return {
    accent: a.accent,
    accent2: a.accent2,
    accentGlow: a.glow,
    bg: bg.bg,
    panel: bg.panel,
    panel2: bg.panel2,
    panel3: bg.panel3,
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
    '--bg': t.bg,
    '--panel': t.panel,
    '--panel-2': t.panel2,
    '--panel-3': t.panel3,
    '--border': t.border,
    '--text': t.text,
    '--text-dim': t.textDim,
    '--text-faint': t.textFaint,
    '--palette-bg': 'rgba(18, 20, 26, 0.92)',
    '--palette-foot': 'rgba(12, 14, 20, 0.7)',
    '--palette-border': 'rgba(255,255,255,0.08)',
    '--code-bg': 'rgba(6, 8, 12, 0.9)',
    '--code-head': 'rgba(14, 16, 22, 0.95)',
    fontFamily: t.font,
    color: t.text,
  };
}

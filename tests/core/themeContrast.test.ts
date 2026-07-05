import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Rgba = { r: number; g: number; b: number; a: number };
type ThemeVars = Record<string, string>;

const css = readFileSync('src/styles/base.css', 'utf8');

describe('theme contrast', () => {
  it('keeps core text and accent pairs at WCAG AA contrast', () => {
    for (const theme of ['dark', 'light'] as const) {
      const vars = themeVars(theme);
      const bg = colorVar(vars, '--bg');
      const panel = colorVar(vars, '--panel');
      const confirmBg = colorMix([
        [colorVar(vars, '--bg'), 90],
        [colorVar(vars, '--accent'), 7],
      ], bg);
      const addedBg = colorVar(vars, '--diff-added-bg', bg);
      const removedBg = colorVar(vars, '--diff-removed-bg', bg);

      expectContrast(theme, '--text on --bg', colorVar(vars, '--text'), bg);
      expectContrast(theme, '--text-dim on --bg', colorVar(vars, '--text-dim'), bg);
      expectContrast(theme, '--text on --panel', colorVar(vars, '--text'), panel);
      expectContrast(theme, '--accent on --bg', colorVar(vars, '--accent'), bg);
      expectContrast(theme, 'confirm text on confirm panel', colorVar(vars, '--text-dim'), confirmBg);
      expectContrast(theme, 'confirm accent on confirm panel', colorVar(vars, '--accent'), confirmBg);
      expectContrast(theme, 'diff added text on tint', colorVar(vars, '--diff-added-text'), addedBg);
      expectContrast(theme, 'diff removed text on tint', colorVar(vars, '--diff-removed-text'), removedBg);
    }
  });
});

function themeVars(theme: 'dark' | 'light'): ThemeVars {
  const selector = theme === 'dark'
    ? String.raw`:root,\s*:root\[data-theme="dark"\]`
    : String.raw`:root\[data-theme="light"\]`;
  const match = css.match(new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\}`));
  if (!match) throw new Error(`Missing ${theme} theme block`);
  return Object.fromEntries(
    [...match[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)]
      .map(([, key, value]) => [key, value.trim()]),
  );
}

function expectContrast(theme: string, label: string, foreground: Rgba, background: Rgba): void {
  const value = contrastRatio(foreground, background);
  expect(value, `${theme} ${label}`).toBeGreaterThanOrEqual(4.5);
}

function colorVar(vars: ThemeVars, name: string, under?: Rgba): Rgba {
  const value = vars[name];
  if (!value) throw new Error(`Missing ${name}`);
  return parseColor(value, under);
}

function parseColor(value: string, under: Rgba = { r: 255, g: 255, b: 255, a: 1 }): Rgba {
  if (value.startsWith('#')) return hex(value);
  const rgba = value.match(/^rgba?\(([^)]+)\)$/);
  if (!rgba) throw new Error(`Unsupported color: ${value}`);
  const parts = rgba[1].split(',').map(part => part.trim());
  const color = {
    r: Number(parts[0]),
    g: Number(parts[1]),
    b: Number(parts[2]),
    a: parts[3] === undefined ? 1 : Number(parts[3]),
  };
  return color.a >= 1 ? color : composite(color, under);
}

function hex(value: string): Rgba {
  const clean = value.slice(1);
  const full = clean.length === 3
    ? clean.split('').map(char => `${char}${char}`).join('')
    : clean;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
    a: 1,
  };
}

function colorMix(items: Array<[Rgba, number]>, under: Rgba): Rgba {
  const total = items.reduce((sum, [, weight]) => sum + weight, 0);
  const mixed = items.reduce<Rgba>((acc, [color, weight]) => {
    const ratio = weight / total;
    return {
      r: acc.r + color.r * ratio,
      g: acc.g + color.g * ratio,
      b: acc.b + color.b * ratio,
      a: acc.a + color.a * ratio,
    };
  }, { r: 0, g: 0, b: 0, a: 0 });
  const alpha = Math.min(total / 100, 1);
  return composite({ ...mixed, a: mixed.a * alpha }, under);
}

function composite(over: Rgba, under: Rgba): Rgba {
  const a = over.a + under.a * (1 - over.a);
  return {
    r: (over.r * over.a + under.r * under.a * (1 - over.a)) / a,
    g: (over.g * over.a + under.g * under.a * (1 - over.a)) / a,
    b: (over.b * over.a + under.b * under.a * (1 - over.a)) / a,
    a,
  };
}

function contrastRatio(a: Rgba, b: Rgba): number {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(color: Rgba): number {
  const [r, g, b] = [color.r, color.g, color.b].map(channel => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const DEFAULT_GLOBAL_SUMMON_CHORD = 'Ctrl+Shift+Space';

const MODIFIER_KEYS = new Set([
  'Control',
  'Ctrl',
  'Shift',
  'Alt',
  'Meta',
]);

const KEY_LABELS: Record<string, string> = {
  ' ': 'Space',
  Spacebar: 'Space',
  Esc: 'Escape',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
};

export function chordFromKeyboardEvent(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  const key = normalizeKeyLabel(event.key);
  if (!key) return null;
  const modifiers = [
    event.ctrlKey ? 'Ctrl' : null,
    event.altKey ? 'Alt' : null,
    event.shiftKey ? 'Shift' : null,
    event.metaKey ? 'Meta' : null,
  ].filter((value): value is string => Boolean(value));
  if (modifiers.length === 0) return null;
  return [...modifiers, key].join('+');
}

export function normalizeKeyLabel(key: string): string | null {
  const mapped = KEY_LABELS[key] ?? key;
  if (!mapped || mapped.length === 0) return null;
  if (mapped.length === 1) return mapped.toUpperCase();
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(mapped)) return mapped;
  return mapped;
}

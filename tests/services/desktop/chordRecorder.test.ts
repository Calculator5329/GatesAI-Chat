import { describe, expect, it } from 'vitest';
import { chordFromKeyboardEvent, normalizeKeyLabel } from '../../../src/core/shortcutChord';

describe('chordRecorder', () => {
  it('captures and formats modifier key combos', () => {
    expect(chordFromKeyboardEvent({
      key: ' ',
      ctrlKey: true,
      altKey: false,
      shiftKey: true,
      metaKey: false,
    })).toBe('Ctrl+Shift+Space');
    expect(chordFromKeyboardEvent({
      key: 'k',
      ctrlKey: true,
      altKey: true,
      shiftKey: false,
      metaKey: false,
    })).toBe('Ctrl+Alt+K');
  });

  it('rejects modifier-only and unmodified keys', () => {
    expect(chordFromKeyboardEvent({
      key: 'Shift',
      ctrlKey: false,
      altKey: false,
      shiftKey: true,
      metaKey: false,
    })).toBeNull();
    expect(chordFromKeyboardEvent({
      key: 'k',
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false,
    })).toBeNull();
  });

  it('normalizes key labels', () => {
    expect(normalizeKeyLabel('a')).toBe('A');
    expect(normalizeKeyLabel('F12')).toBe('F12');
    expect(normalizeKeyLabel('Esc')).toBe('Escape');
  });
});

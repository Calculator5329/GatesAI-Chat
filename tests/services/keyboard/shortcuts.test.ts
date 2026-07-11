import { describe, expect, it, vi } from 'vitest';
import {
  createKeyboardShortcutHandler,
  dispatchKeyboardShortcut,
  type KeyboardShortcutActions,
} from '../../../src/services/keyboard/shortcuts';

function actions(overrides: Partial<KeyboardShortcutActions> = {}): KeyboardShortcutActions {
  return {
    paletteOpen: () => false,
    togglePalette: vi.fn(),
    closePalette: vi.fn(),
    newConversation: vi.fn(),
    focusComposer: vi.fn(),
    toggleSettings: vi.fn(),
    menuOpen: () => false,
    closeMenu: vi.fn(),
    undo: vi.fn(),
    ...overrides,
  };
}

describe('keyboard shortcut dispatcher', () => {
  it('fires Ctrl+K even without an editable-target guard', () => {
    const shortcutActions = actions();
    const event = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    expect(dispatchKeyboardShortcut(event, shortcutActions)).toBe(true);

    expect(shortcutActions.togglePalette).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('suppresses Ctrl+N inside a textarea', () => {
    const shortcutActions = actions();
    const handler = createKeyboardShortcutHandler(shortcutActions);
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.addEventListener('keydown', handler);

    const event = new KeyboardEvent('keydown', {
      key: 'n',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    textarea.dispatchEvent(event);

    expect(shortcutActions.newConversation).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);

    textarea.remove();
  });

  it('fires Ctrl+Z outside editable controls', () => {
    const shortcutActions = actions();
    const event = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    expect(dispatchKeyboardShortcut(event, shortcutActions)).toBe(true);
    expect(shortcutActions.undo).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('preserves native Ctrl+Z inside editable controls', () => {
    const shortcutActions = actions();
    const textarea = document.createElement('textarea');
    const event = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'target', { value: textarea });

    expect(dispatchKeyboardShortcut(event, shortcutActions)).toBe(false);
    expect(shortcutActions.undo).not.toHaveBeenCalled();
  });

  it('gives Escape to the palette before closing the menu', () => {
    const closePalette = vi.fn();
    const closeMenu = vi.fn();
    const shortcutActions = actions({
      paletteOpen: () => true,
      closePalette,
      menuOpen: () => true,
      closeMenu,
    });
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    const stopImmediate = vi.spyOn(event, 'stopImmediatePropagation');

    expect(dispatchKeyboardShortcut(event, shortcutActions)).toBe(true);

    expect(closePalette).toHaveBeenCalledTimes(1);
    expect(closeMenu).not.toHaveBeenCalled();
    expect(stopImmediate).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('lets local Escape overlays close before the menu', () => {
    const closeMenu = vi.fn();
    const shortcutActions = actions({
      menuOpen: () => true,
      closeMenu,
      localEscapeOverlayOpen: () => true,
    });
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });

    expect(dispatchKeyboardShortcut(event, shortcutActions)).toBe(false);

    expect(closeMenu).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});

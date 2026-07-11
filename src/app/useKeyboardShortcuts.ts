// React/root-store wiring for the pure keyboard shortcut dispatcher.
// Called by App so services/keyboard remains free of UI and store imports.
import { useEffect } from 'react';
import type { RootStore } from '../stores/RootStore';
import {
  installKeyboardShortcuts,
  localEscapeOverlayOpen,
  type KeyboardShortcutActions,
} from '../services/keyboard/shortcuts';

export function useKeyboardShortcuts(root: RootStore): void {
  useEffect(() => {
    const actions: KeyboardShortcutActions = {
      paletteOpen: () => root.ui.paletteOpen,
      togglePalette: () => root.ui.togglePalette(),
      closePalette: () => root.ui.closePalette(),
      newConversation: () => {
        const id = root.chat.createThread();
        root.router.goThread(id);
      },
      focusComposer: () => {
        if (root.router.isMenu) root.router.goThread(root.chat.activeThreadId);
        root.ui.focusComposer();
      },
      toggleSettings: () => {
        if (root.router.isMenu) {
          root.router.goThread(root.chat.activeThreadId);
          return;
        }
        root.ui.markMenuHintSeen();
        root.router.goMenu('settings');
      },
      menuOpen: () => root.router.isMenu,
      closeMenu: () => root.router.goThread(root.chat.activeThreadId),
      undo: () => {
        if (!root.undo.undo() || root.router.isMenu) return;
        root.router.goThread(root.chat.activeThreadId);
      },
      localEscapeOverlayOpen: () => localEscapeOverlayOpen(),
    };
    return installKeyboardShortcuts(actions);
  }, [root]);
}

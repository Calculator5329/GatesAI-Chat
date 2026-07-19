import { useEffect } from 'react';
import { autorun } from 'mobx';
import type { RootStore } from '../stores/RootStore';
import {
  DESKTOP_NEW_CONVERSATION_DOM_EVENT,
  DESKTOP_SHORTCUT_STATE_DOM_EVENT,
  DESKTOP_SUMMON_DOM_EVENT,
  listenDesktopAmbient,
  setCloseToTray,
  setGlobalShortcut,
  type GlobalShortcutStatus,
} from '../services/desktop/ambient';
import { isWebLite } from '../core/runtime';

export function useDesktopAmbient(root: RootStore, target: Window = window): void {
  useEffect(() => {
    if (isWebLite()) return undefined;

    const summon = (): void => {
      if (root.router.isMenu) root.router.goThread(root.chat.activeThreadId);
      root.ui.focusComposer();
    };
    const newConversation = (): void => {
      const id = root.chat.createThread();
      root.router.goThread(id);
      root.ui.focusComposer();
    };
    const shortcutState = (state: GlobalShortcutStatus): void => {
      root.ui.setGlobalShortcutStatus(state.available ? null : state.reason ?? 'shortcut unavailable');
    };

    const handleSummon = () => summon();
    const handleNewConversation = () => newConversation();
    const handleShortcutState = (event: Event) => {
      const detail = (event as CustomEvent<GlobalShortcutStatus>).detail;
      if (detail) shortcutState(detail);
    };

    target.addEventListener(DESKTOP_SUMMON_DOM_EVENT, handleSummon);
    target.addEventListener(DESKTOP_NEW_CONVERSATION_DOM_EVENT, handleNewConversation);
    target.addEventListener(DESKTOP_SHORTCUT_STATE_DOM_EVENT, handleShortcutState);

    let disposed = false;
    let unlistenTauri: (() => void) | null = null;
    void listenDesktopAmbient({
      onSummon: summon,
      onNewConversation: newConversation,
      onShortcutState: shortcutState,
    }).then(unlisten => {
      if (disposed) {
        unlisten();
      } else {
        unlistenTauri = unlisten;
      }
    });

    const disposePrefs = autorun(() => {
      const chord = root.ui.globalSummonEnabled ? root.ui.globalSummonChord : null;
      void setGlobalShortcut(chord).then(shortcutState);
      void setCloseToTray(root.ui.closeButtonHidesToTray);
    });

    return () => {
      disposed = true;
      unlistenTauri?.();
      disposePrefs();
      target.removeEventListener(DESKTOP_SUMMON_DOM_EVENT, handleSummon);
      target.removeEventListener(DESKTOP_NEW_CONVERSATION_DOM_EVENT, handleNewConversation);
      target.removeEventListener(DESKTOP_SHORTCUT_STATE_DOM_EVENT, handleShortcutState);
    };
  }, [root, target]);
}

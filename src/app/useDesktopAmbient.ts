import { useEffect } from 'react';
import { autorun } from 'mobx';
import type { RootStore } from '../stores/RootStore';
import {
  DESKTOP_NEW_CONVERSATION_DOM_EVENT,
  DESKTOP_KNOWLEDGE_DOM_EVENT,
  DESKTOP_KNOWLEDGE_SHORTCUT_STATE_DOM_EVENT,
  DESKTOP_SHORTCUT_STATE_DOM_EVENT,
  DESKTOP_SUMMON_DOM_EVENT,
  listenDesktopAmbient,
  getKnowledgeShortcutState,
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
    const knowledge = (): void => {
      if (!root.offlineLibrary.enabled || root.offlineLibrary.phase !== 'healthy') {
        root.ui.markMenuHintSeen();
        root.router.goMenu('settings');
        return;
      }
      if (!root.providers.isConnected('ollama')) {
        root.ui.markMenuHintSeen();
        root.router.goMenu('local');
        return;
      }
      const suggested = [
        root.offlineLibrary.profileForTask('public_database_schema'),
        root.offlineLibrary.profileForTask('knowledge_document_balanced'),
        root.offlineLibrary.profileForTask('knowledge_document'),
      ].filter(profile => profile !== null);
      const localModels = root.registry.all.filter(model => model.providerId === 'ollama');
      const model = suggested
        .map(profile => localModels.find(candidate => candidate.providerModelId === profile.model && candidate.supportsTools !== false))
        .find(candidate => candidate !== undefined)
        ?? localModels.find(candidate => candidate.supportsTools !== false);
      if (!model) {
        root.ui.markMenuHintSeen();
        root.router.goMenu('local');
        return;
      }
      const id = root.chat.createThread();
      root.chat.renameThread(id, 'Offline knowledge');
      root.chat.setThreadModel(id, model.id);
      root.chat.setThreadContext(id, [
        'Offline Knowledge mode.',
        'Use the read-only Offline Library tools for factual answers and cite local evidence URIs.',
        'Use approved public database schema metadata only when useful; never request rows, private data, web search, or remote fallback.',
      ].join(' '));
      root.router.goThread(id);
      root.ui.focusComposer();
    };
    const shortcutState = (state: GlobalShortcutStatus): void => {
      root.ui.setGlobalShortcutStatus(state.available ? null : state.reason ?? 'shortcut unavailable');
    };
    const knowledgeShortcutState = (state: GlobalShortcutStatus): void => {
      root.offlineLibrary.setKnowledgeShortcutStatus(
        state.available && state.enabled,
        state.available ? null : state.reason ?? 'shortcut unavailable',
      );
    };

    const handleSummon = () => summon();
    const handleNewConversation = () => newConversation();
    const handleKnowledge = () => knowledge();
    const handleShortcutState = (event: Event) => {
      const detail = (event as CustomEvent<GlobalShortcutStatus>).detail;
      if (detail) shortcutState(detail);
    };
    const handleKnowledgeShortcutState = (event: Event) => {
      const detail = (event as CustomEvent<GlobalShortcutStatus>).detail;
      if (detail) knowledgeShortcutState(detail);
    };

    target.addEventListener(DESKTOP_SUMMON_DOM_EVENT, handleSummon);
    target.addEventListener(DESKTOP_NEW_CONVERSATION_DOM_EVENT, handleNewConversation);
    target.addEventListener(DESKTOP_KNOWLEDGE_DOM_EVENT, handleKnowledge);
    target.addEventListener(DESKTOP_SHORTCUT_STATE_DOM_EVENT, handleShortcutState);
    target.addEventListener(DESKTOP_KNOWLEDGE_SHORTCUT_STATE_DOM_EVENT, handleKnowledgeShortcutState);

    let disposed = false;
    let unlistenTauri: (() => void) | null = null;
    void listenDesktopAmbient({
      onSummon: summon,
      onKnowledge: knowledge,
      onNewConversation: newConversation,
      onShortcutState: shortcutState,
      onKnowledgeShortcutState: knowledgeShortcutState,
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
    void getKnowledgeShortcutState().then(knowledgeShortcutState);

    return () => {
      disposed = true;
      unlistenTauri?.();
      disposePrefs();
      target.removeEventListener(DESKTOP_SUMMON_DOM_EVENT, handleSummon);
      target.removeEventListener(DESKTOP_NEW_CONVERSATION_DOM_EVENT, handleNewConversation);
      target.removeEventListener(DESKTOP_KNOWLEDGE_DOM_EVENT, handleKnowledge);
      target.removeEventListener(DESKTOP_SHORTCUT_STATE_DOM_EVENT, handleShortcutState);
      target.removeEventListener(DESKTOP_KNOWLEDGE_SHORTCUT_STATE_DOM_EVENT, handleKnowledgeShortcutState);
    };
  }, [root, target]);
}

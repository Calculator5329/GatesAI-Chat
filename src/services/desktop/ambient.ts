import { isTauri } from '../../core/runtime';

export const DESKTOP_SUMMON_DOM_EVENT = 'gatesai:summon';
export const DESKTOP_NEW_CONVERSATION_DOM_EVENT = 'gatesai:new-conversation';
export const DESKTOP_SHORTCUT_STATE_DOM_EVENT = 'gatesai:global-shortcut-state';

const SUMMON_TAURI_EVENT = 'gatesai://summon';
const NEW_CONVERSATION_TAURI_EVENT = 'gatesai://new-conversation';
const SHORTCUT_STATE_TAURI_EVENT = 'gatesai://global-shortcut-state';

export interface GlobalShortcutStatus {
  enabled: boolean;
  chord: string | null;
  available: boolean;
  reason: string | null;
}

export interface DesktopAmbientHandlers {
  onSummon: () => void;
  onNewConversation: () => void;
  onShortcutState: (state: GlobalShortcutStatus) => void;
}

export const UNSUPPORTED_SHORTCUT_STATUS: GlobalShortcutStatus = {
  enabled: false,
  chord: null,
  available: false,
  reason: 'desktop shell unavailable',
};

export async function setGlobalShortcut(chord: string | null): Promise<GlobalShortcutStatus> {
  if (!isTauri()) return UNSUPPORTED_SHORTCUT_STATUS;
  const { invoke } = await import('@tauri-apps/api/core');
  return await invoke<GlobalShortcutStatus>('set_global_shortcut', { chord });
}

export async function setCloseToTray(enabled: boolean): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('set_close_to_tray', { enabled });
}

export async function listenDesktopAmbient(handlers: DesktopAmbientHandlers): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await Promise.all([
    listen(SUMMON_TAURI_EVENT, () => handlers.onSummon()),
    listen(NEW_CONVERSATION_TAURI_EVENT, () => handlers.onNewConversation()),
    listen<GlobalShortcutStatus>(SHORTCUT_STATE_TAURI_EVENT, event => handlers.onShortcutState(event.payload)),
  ]);
  return () => {
    for (const dispose of unlisten) dispose();
  };
}

// App-wide keyboard shortcut dispatcher.
// Called by App through a small action interface so the dispatcher stays
// unit-testable and free of UI/store dependencies.

export interface KeyboardShortcutActions {
  paletteOpen: () => boolean;
  togglePalette: () => void;
  closePalette: () => void;
  newConversation: () => void;
  focusComposer: () => void;
  toggleSettings: () => void;
  menuOpen: () => boolean;
  closeMenu: () => void;
  undo: () => void;
  toggleFullscreen: () => void;
  localEscapeOverlayOpen?: () => boolean;
}

export function installKeyboardShortcuts(actions: KeyboardShortcutActions, target?: Window): () => void {
  const win = target ?? (typeof window !== 'undefined' ? window : null);
  if (!win) return () => undefined;
  const handler = createKeyboardShortcutHandler(actions);
  win.addEventListener('keydown', handler);
  return () => win.removeEventListener('keydown', handler);
}

export function createKeyboardShortcutHandler(actions: KeyboardShortcutActions): (event: KeyboardEvent) => void {
  return (event: KeyboardEvent) => {
    dispatchKeyboardShortcut(event, actions);
  };
}

export function dispatchKeyboardShortcut(event: KeyboardEvent, actions: KeyboardShortcutActions): boolean {
  if (event.key === 'Escape') {
    if (actions.paletteOpen()) {
      handleEvent(event);
      event.stopImmediatePropagation();
      actions.closePalette();
      return true;
    }
    if (actions.localEscapeOverlayOpen?.()) return false;
    if (actions.menuOpen()) {
      handleEvent(event);
      actions.closeMenu();
      return true;
    }
    return false;
  }

  // F11 is the platform fullscreen convention (Linux/Windows) — no modifier,
  // and it works even from editable controls since it never types anything.
  if (event.key === 'F11' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    handleEvent(event);
    actions.toggleFullscreen();
    return true;
  }

  const hasShortcutModifier = event.ctrlKey || event.metaKey;
  if (!hasShortcutModifier || event.altKey) return false;

  const key = event.key.toLowerCase();
  if (key === 'k') {
    handleEvent(event);
    actions.togglePalette();
    return true;
  }

  if (isEditableShortcutTarget(event.target)) return false;

  if (key === 'z' && !event.shiftKey) {
    handleEvent(event);
    actions.undo();
    return true;
  }

  if (key === 'n') {
    handleEvent(event);
    actions.newConversation();
    return true;
  }

  if (key === 'l') {
    handleEvent(event);
    actions.focusComposer();
    return true;
  }

  if (event.key === ',') {
    handleEvent(event);
    actions.toggleSettings();
    return true;
  }

  return false;
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  let current: Element | null = target;
  while (current) {
    const tag = current.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (current instanceof HTMLElement && current.isContentEditable) return true;
    if (current.getAttribute('contenteditable') === 'true') return true;
    current = current.parentElement;
  }
  return false;
}

export function localEscapeOverlayOpen(doc: Document = document): boolean {
  return Boolean(doc.querySelector([
    '[data-gates-lightbox-backdrop]',
    '.html-artifact-fullscreen',
    '[data-local-runtime-log-modal]',
  ].join(',')));
}

function handleEvent(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

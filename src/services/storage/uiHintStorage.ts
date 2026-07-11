// Persistence for one-time UI discovery cues (e.g. the first-run animation that
// teaches users where the menu lives). Lives in the storage service layer so UI
// reaches it through a store facade instead of touching localStorage directly.
import { logger } from '../diagnostics/logger';

const MENU_HINT_KEY = 'gatesai.menuHintSeen.v1';

/** True once the user has opened the menu via the brand wordmark at least once. */
export function loadMenuHintSeen(): boolean {
  if (typeof localStorage === 'undefined') return true;
  try {
    return localStorage.getItem(MENU_HINT_KEY) === '1';
  } catch (err) {
    // Storage blocked (private mode, etc.) — treat as seen so we never nag.
    logger.warn('persistence', 'Menu hint flag load failed', { key: MENU_HINT_KEY, err });
    return true;
  }
}

export function saveMenuHintSeen(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(MENU_HINT_KEY, '1');
  } catch (err) {
    logger.warn('persistence', 'Menu hint flag save failed', { key: MENU_HINT_KEY, err });
  }
}

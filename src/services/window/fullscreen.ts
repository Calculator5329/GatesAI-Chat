// Fullscreen toggle for the whole app window, runtime-gated.
// Called from the keyboard shortcut wiring and the command palette; depends
// only on core/runtime detection and the Tauri window API on desktop.
// Invariant: never throws — a failed toggle logs and leaves the window as-is.
import { isTauri } from '../../core/runtime';
import { logger } from '../diagnostics/logger';

/**
 * Toggle app fullscreen. Desktop uses the Tauri window (true OS fullscreen,
 * needs `core:window:allow-set-fullscreen` in the capability file); Web Lite
 * falls back to the browser Fullscreen API on the document element.
 * Returns the new fullscreen state, or null if the toggle failed.
 */
export async function toggleFullscreen(): Promise<boolean | null> {
  try {
    if (isTauri()) {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      const next = !(await win.isFullscreen());
      await win.setFullscreen(next);
      return next;
    }
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return false;
    }
    await document.documentElement.requestFullscreen();
    return true;
  } catch (err) {
    logger.warn('window', 'fullscreen toggle failed', err);
    return null;
  }
}

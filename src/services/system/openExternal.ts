/**
 * openExternal — open a filesystem path with the OS default handler.
 *
 * In the desktop build this calls a custom Tauri command (`open_path`)
 * which delegates to the `open` crate (Windows `start`, macOS `open`,
 * Linux `xdg-open`). In the dev/web build there is no host that can
 * launch external apps, so we no-op with a console warning instead of
 * throwing — that lets UI affordances render the same in both modes.
 */

import { invoke } from '@tauri-apps/api/core';

export async function openExternal(absolutePath: string): Promise<void> {
  if (!isTauri()) {
    console.warn('[openExternal] not running in Tauri, ignoring', absolutePath);
    return;
  }
  await invoke('open_path', { path: absolutePath });
}

export function isTauri(): boolean {
  return typeof window !== 'undefined'
    && typeof (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== 'undefined';
}

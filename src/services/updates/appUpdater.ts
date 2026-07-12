// Desktop auto-update client over tauri-plugin-updater.
// Called by UpdateStore only; depends on core/runtime detection and the
// Tauri updater/process plugins (dynamically imported so Web Lite never
// loads them).
// Invariant: every function is a no-op (null/false) outside the Tauri shell
// and never throws — update plumbing must not destabilize the app.
import { isTauri } from '../../core/runtime';
import { logger } from '../diagnostics/logger';

export interface AvailableUpdate {
  version: string;
  currentVersion: string;
  notes?: string;
  /** Download + install the update. Resolves when staged for restart. */
  install(onProgress?: (downloaded: number, total: number | null) => void): Promise<void>;
}

/**
 * Ask the updater endpoint whether a newer build exists. Returns null when
 * up-to-date, not on desktop, or on any failure (offline, endpoint missing —
 * both are normal early in a release cycle and are logged at warn).
 */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!isTauri()) return null;
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (!update) return null;
    logger.info('updates', `update available: ${update.currentVersion} -> ${update.version}`);
    return {
      version: update.version,
      currentVersion: update.currentVersion,
      notes: update.body,
      install: async (onProgress) => {
        let downloaded = 0;
        let total: number | null = null;
        await update.downloadAndInstall((event) => {
          if (event.event === 'Started') {
            total = event.data.contentLength ?? null;
          } else if (event.event === 'Progress') {
            downloaded += event.data.chunkLength;
          }
          onProgress?.(downloaded, total);
        });
        logger.info('updates', `update ${update.version} downloaded and staged`);
      },
    };
  } catch (err) {
    logger.warn('updates', 'update check failed', err);
    return null;
  }
}

/** Relaunch the app so a staged update applies. */
export async function relaunchApp(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  } catch (err) {
    logger.warn('updates', 'relaunch failed; user can restart manually', err);
  }
}

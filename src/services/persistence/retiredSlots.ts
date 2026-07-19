// One-time cleanup for localStorage slots owned by features that have been
// removed from the product. Nothing reads these keys anymore, so we drop them
// on boot to keep the persistence floor clean and avoid confusing future
// storage audits. Adding a key here is safe and idempotent.
import { logger } from '../diagnostics/logger';

/** localStorage keys for archived/removed subsystems. Kept as a plain list. */
export const RETIRED_LOCAL_SLOTS: readonly string[] = [
  'gatesai.mcp.v1',            // MCP (managed code providers) — parked
  'gatesai.offlineLibrary.v1', // Offline knowledge library — archived
  'gatesai.schedules.v1',      // Schedules (legacy) — archived
  'gatesai.schedules.v2',      // Schedules (legacy) — archived
];

/**
 * Remove every retired slot from local storage. Idempotent and best-effort:
 * missing keys and quota/privacy-mode failures are ignored.
 */
export function purgeRetiredLocalSlots(): void {
  for (const key of RETIRED_LOCAL_SLOTS) {
    try {
      localStorage.removeItem(key);
    } catch (err) {
      logger.warn('persistence', 'retired slot cleanup failed', { key, err });
    }
  }
}

// One-time cleanup for localStorage slots and secrets owned by features that
// have been removed from the product. Nothing reads these keys anymore, so we
// drop them on boot to keep the persistence floor clean and avoid confusing
// future storage audits. Adding an entry here is safe and idempotent.
import { logger } from '../diagnostics/logger';
import { deleteSecret } from '../secretStorage';

/** localStorage keys for archived/removed subsystems. Kept as a plain list. */
export const RETIRED_LOCAL_SLOTS: readonly string[] = [
  'gatesai.mcp.v1',            // MCP (managed code providers) — parked
  'gatesai.offlineLibrary.v1', // Offline knowledge library — archived
  'gatesai.schedules.v1',      // Schedules (legacy) — archived
  'gatesai.schedules.v2',      // Schedules (legacy) — archived
];

/** Secret names for removed providers, deleted from keychain/local fallback. */
export const RETIRED_SECRET_NAMES: readonly string[] = [
  'openai-compat.api-key',     // Custom OpenAI-compatible endpoint — removed
];

/**
 * Remove every retired slot from local storage and every retired secret from
 * the secret backend. Idempotent and best-effort: missing keys and
 * quota/privacy-mode/keychain failures are ignored.
 */
export function purgeRetiredLocalSlots(): void {
  for (const key of RETIRED_LOCAL_SLOTS) {
    try {
      localStorage.removeItem(key);
    } catch (err) {
      logger.warn('persistence', 'retired slot cleanup failed', { key, err });
    }
  }
  for (const name of RETIRED_SECRET_NAMES) {
    void deleteSecret(name).catch(err => {
      logger.warn('persistence', 'retired secret cleanup failed', { name, err });
    });
  }
}

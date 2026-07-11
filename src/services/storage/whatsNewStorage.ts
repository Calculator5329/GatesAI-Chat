// Persists the last app version acknowledged by the user.
// Called only through WhatsNewStore; keeps browser storage out of stores/UI.
import { createJsonPersistenceProvider } from './persistenceProvider';

export interface WhatsNewSnapshot {
  lastSeenVersion?: string;
}

const KEY = 'gatesai.whatsNew.v1';

export const whatsNewPersistence = createJsonPersistenceProvider<WhatsNewSnapshot>({
  key: KEY,
  parse: raw => {
    const parsed = raw && typeof raw === 'object' ? raw as Partial<WhatsNewSnapshot> : {};
    return typeof parsed.lastSeenVersion === 'string' && parsed.lastSeenVersion.trim().length > 0
      ? { lastSeenVersion: parsed.lastSeenVersion }
      : {};
  },
});

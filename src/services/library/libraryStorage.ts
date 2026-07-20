import type { LibrarySnapshot } from './types';
import { librarySourceId, normalizeLibraryPath, sourceKindForPath } from './librarySourceService';
import {
  createJsonPersistenceProvider,
  type KeyValuePersistence,
  type PersistenceProvider,
} from '../storage/persistenceProvider';

export const LIBRARY_STORAGE_KEY = 'gatesai.library.v1';

export function createLibraryPersistence(
  storage?: KeyValuePersistence,
): PersistenceProvider<LibrarySnapshot> {
  return createJsonPersistenceProvider({
    key: LIBRARY_STORAGE_KEY,
    storage,
    parse: parseLibrarySnapshot,
  });
}

function parseLibrarySnapshot(value: unknown): LibrarySnapshot {
  const parsed = value && typeof value === 'object' ? value as Partial<LibrarySnapshot> : {};
  if (!Array.isArray(parsed.sources)) return { sources: [] };
  const sources: LibrarySnapshot['sources'] = [];
  for (const source of parsed.sources) {
    if (!source || typeof source.path !== 'string') continue;
    try {
      const path = normalizeLibraryPath(source.path);
      sources.push({
        id: typeof source.id === 'string' ? source.id : librarySourceId(path),
        path,
        title: typeof source.title === 'string' && source.title.trim()
          ? source.title.trim()
          : path.split('/').pop() ?? path,
        kind: sourceKindForPath(path),
        enabled: source.enabled !== false,
        addedAt: typeof source.addedAt === 'number' ? source.addedAt : Date.now(),
      });
    } catch {
      // Keep valid registrations even when one persisted entry is stale or unsafe.
    }
  }
  return { sources };
}

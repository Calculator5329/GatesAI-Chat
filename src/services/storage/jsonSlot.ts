import { createJsonPersistenceProvider, type KeyValuePersistence, type PersistenceProvider } from './persistenceProvider';

/**
 * Compatibility helper for legacy storage modules. New storage slots should
 * prefer `createJsonPersistenceProvider` directly so their persistence port
 * is explicit and injectable in tests.
 */
export type JsonSlot<T> = PersistenceProvider<T>;

export function jsonSlot<T>(
  key: string,
  parse: (raw: unknown) => T,
  storage?: KeyValuePersistence,
): JsonSlot<T> {
  return createJsonPersistenceProvider({ key, parse, storage });
}

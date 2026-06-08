import { logger } from '../diagnostics/logger';

export interface KeyValuePersistence {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PersistenceProvider<T> {
  load(): T;
  save(value: T): void;
  clear(): void;
}

export interface JsonPersistenceOptions<T> {
  key: string;
  parse(raw: unknown): T;
  storage?: KeyValuePersistence;
}

export function browserLocalStorage(): KeyValuePersistence {
  return {
    getItem: key => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
    removeItem: key => localStorage.removeItem(key),
  };
}

export function createJsonPersistenceProvider<T>(
  options: JsonPersistenceOptions<T>,
): PersistenceProvider<T> {
  const storage = options.storage ?? browserLocalStorage();
  return {
    load(): T {
      try {
        const raw = storage.getItem(options.key);
        if (raw == null) return options.parse(undefined);
        return options.parse(JSON.parse(raw));
      } catch (err) {
        logger.warn('persistence', 'localStorage load failed; using defaults', {
          key: options.key,
          err,
        });
        return options.parse(undefined);
      }
    },
    save(value: T): void {
      try {
        storage.setItem(options.key, JSON.stringify(value));
      } catch (err) {
        logger.warn('persistence', 'localStorage save failed', { key: options.key, err });
      }
    },
    clear(): void {
      try {
        storage.removeItem(options.key);
      } catch (err) {
        logger.warn('persistence', 'localStorage clear failed', { key: options.key, err });
      }
    },
  };
}

const GATESAI_STORAGE_PREFIX = 'gatesai.';

export type MultiTabWriteHandler = (key: string) => void;

let multiTabWriteHandler: MultiTabWriteHandler | null = null;

/**
 * Register a callback when another tab mutates GatesAI localStorage keys.
 * `ChatStore` wires this for `gatesai.state.v1` to pause autosave and show a
 * composer banner; other keys log only (no merge — last-write-wins risk).
 */
export function setMultiTabWriteHandler(handler: MultiTabWriteHandler | null): void {
  multiTabWriteHandler = handler;
}

/** Log cross-tab writes and invoke {@link setMultiTabWriteHandler} when registered. */
export function installMultiTabStorageListener(): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (event: StorageEvent) => {
    if (!event.key?.startsWith(GATESAI_STORAGE_PREFIX)) return;
    if (event.newValue === event.oldValue) return;
    logger.warn('persistence', 'another browser tab modified localStorage', {
      key: event.key,
      hadPrevious: event.oldValue != null,
    });
    if (event.key) multiTabWriteHandler?.(event.key);
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

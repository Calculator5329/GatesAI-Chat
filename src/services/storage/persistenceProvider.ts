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
      } catch {
        return options.parse(undefined);
      }
    },
    save(value: T): void {
      try {
        storage.setItem(options.key, JSON.stringify(value));
      } catch {
        // ignore quota / privacy-mode failures
      }
    },
    clear(): void {
      try {
        storage.removeItem(options.key);
      } catch {
        // ignore
      }
    },
  };
}

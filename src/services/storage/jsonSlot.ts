/**
 * Tiny localStorage helper. Each slot owns one key and (optionally) a parser
 * that hardens stored data against shape drift. The save/clear paths swallow
 * quota and privacy-mode errors uniformly so callers don't sprinkle empty
 * try/catch blocks all over the codebase.
 */
export interface JsonSlot<T> {
  load(): T;
  save(value: T): void;
  clear(): void;
}

export function jsonSlot<T>(key: string, parse: (raw: unknown) => T): JsonSlot<T> {
  return {
    load(): T {
      try {
        const raw = localStorage.getItem(key);
        if (raw == null) return parse(undefined);
        return parse(JSON.parse(raw));
      } catch {
        return parse(undefined);
      }
    },
    save(value: T): void {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // ignore quota / privacy-mode failures
      }
    },
    clear(): void {
      try {
        localStorage.removeItem(key);
      } catch {
        // ignore
      }
    },
  };
}

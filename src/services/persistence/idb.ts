// Tiny promise wrapper around the IndexedDB thread archive.
// Keep this dependency-free so Web Lite and desktop use the same browser API.
import type { Thread } from '../../core/types';

export const THREAD_ARCHIVE_DB_NAME = 'gatesai-chat';
export const THREAD_ARCHIVE_STORE_NAME = 'threads';

export interface ThreadArchiveStats {
  entries: number;
  bytes: number;
  truncated: boolean;
}

export const MAX_THREAD_ARCHIVE_STATS_ENTRIES = 500;

export interface ThreadArchiveStore {
  getThread(id: string): Promise<Thread | null>;
  usage(): Promise<ThreadArchiveStats>;
  putThread(thread: Thread): Promise<void>;
  deleteThread(id: string): Promise<void>;
}

export function createIndexedDbThreadArchiveStore(
  factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB,
): ThreadArchiveStore {
  let dbPromise: Promise<IDBDatabase> | null = null;

  const db = (): Promise<IDBDatabase> => {
    if (!factory) return Promise.reject(new Error('IndexedDB is unavailable.'));
    dbPromise ??= openThreadArchiveDb(factory);
    return dbPromise;
  };

  return {
    async getThread(id: string): Promise<Thread | null> {
      const database = await db();
      return requestToPromise<Thread | undefined>(
        database.transaction(THREAD_ARCHIVE_STORE_NAME, 'readonly')
          .objectStore(THREAD_ARCHIVE_STORE_NAME)
          .get(id),
      ).then(thread => thread ?? null);
    },

    async usage(): Promise<ThreadArchiveStats> {
      if (!factory) throw new Error('IndexedDB is unavailable.');
      const database = await openExistingThreadArchiveDb(factory);
      try {
        const request = database.transaction(THREAD_ARCHIVE_STORE_NAME, 'readonly')
          .objectStore(THREAD_ARCHIVE_STORE_NAME)
          .openCursor();
        return await cursorStats(request);
      } finally {
        database.close();
      }
    },

    async putThread(thread: Thread): Promise<void> {
      const database = await db();
      await requestToPromise(
        database.transaction(THREAD_ARCHIVE_STORE_NAME, 'readwrite')
          .objectStore(THREAD_ARCHIVE_STORE_NAME)
          .put(thread),
      );
    },

    async deleteThread(id: string): Promise<void> {
      const database = await db();
      await requestToPromise(
        database.transaction(THREAD_ARCHIVE_STORE_NAME, 'readwrite')
          .objectStore(THREAD_ARCHIVE_STORE_NAME)
          .delete(id),
      );
    },
  };
}

function cursorStats(request: IDBRequest<IDBCursorWithValue | null>): Promise<ThreadArchiveStats> {
  return new Promise((resolve, reject) => {
    let entries = 0;
    let bytes = 0;
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve({ entries, bytes, truncated: false });
        return;
      }
      if (entries >= MAX_THREAD_ARCHIVE_STATS_ENTRIES) {
        resolve({ entries, bytes, truncated: true });
        return;
      }
      try {
        entries += 1;
        bytes += new TextEncoder().encode(JSON.stringify(cursor.value)).byteLength;
        cursor.continue();
      } catch (err) {
        reject(err);
      }
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB cursor failed.'));
  });
}

function openExistingThreadArchiveDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(THREAD_ARCHIVE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      // Opening a missing database would otherwise create it. Abort so the
      // stats path remains observational on fresh profiles.
      request.transaction?.abort();
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB archive does not exist.'));
    request.onblocked = () => reject(new Error('IndexedDB open blocked by another tab.'));
  });
}

function openThreadArchiveDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(THREAD_ARCHIVE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(THREAD_ARCHIVE_STORE_NAME)) {
        database.createObjectStore(THREAD_ARCHIVE_STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed.'));
    request.onblocked = () => reject(new Error('IndexedDB open blocked by another tab.'));
  });
}

function requestToPromise<T = unknown>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

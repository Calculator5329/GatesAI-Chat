export type RagSourceType = 'message' | 'note' | 'memory';

export interface RagChunk {
  id: string;
  sourceType: RagSourceType;
  sourceId: string;
  threadId?: string;
  text: string;
  vector: Float32Array;
  updatedAt: number;
  model: string;
}

export interface StoredRagChunk extends Omit<RagChunk, 'vector'> {
  vector: ArrayBuffer;
}

export interface RagSearchResult {
  chunk: RagChunk;
  score: number;
}

export interface RagChunkPersistence {
  all(): Promise<StoredRagChunk[]>;
  putMany(chunks: StoredRagChunk[]): Promise<void>;
  deleteIds(ids: string[]): Promise<void>;
  clear(): Promise<void>;
  count(): Promise<number>;
}

export const RAG_DB_NAME = 'gatesai-rag';
export const RAG_CHUNKS_STORE_NAME = 'chunks';

export class RagVectorStore {
  private readonly persistence: RagChunkPersistence;
  private cache: RagChunk[] | null = null;

  constructor(persistence: RagChunkPersistence = createIndexedDbRagChunkPersistence()) {
    this.persistence = persistence;
  }

  async putMany(chunks: RagChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    await this.persistence.putMany(chunks.map(toStoredChunk));
    this.cache = null;
  }

  async deleteBySource(sourceType: RagSourceType, sourceId: string): Promise<void> {
    const chunks = await this.loadAll();
    const ids = chunks
      .filter(chunk => chunk.sourceType === sourceType && chunk.sourceId === sourceId)
      .map(chunk => chunk.id);
    if (ids.length === 0) return;
    await this.persistence.deleteIds(ids);
    this.cache = null;
  }

  async deleteByThread(threadId: string): Promise<void> {
    const chunks = await this.loadAll();
    const ids = chunks
      .filter(chunk => chunk.threadId === threadId)
      .map(chunk => chunk.id);
    if (ids.length === 0) return;
    await this.persistence.deleteIds(ids);
    this.cache = null;
  }

  async clear(): Promise<void> {
    await this.persistence.clear();
    this.cache = null;
  }

  async count(model?: string): Promise<number> {
    if (!model) return this.persistence.count();
    return (await this.loadAll()).filter(chunk => chunk.model === model).length;
  }

  async search(query: Float32Array, model: string, k: number): Promise<RagSearchResult[]> {
    const chunks = (await this.loadAll()).filter(chunk => chunk.model === model);
    const scored: RagSearchResult[] = [];
    for (const chunk of chunks) {
      const score = dot(query, chunk.vector);
      scored.push({ chunk, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.max(0, k));
  }

  private async loadAll(): Promise<RagChunk[]> {
    this.cache ??= (await this.persistence.all()).map(fromStoredChunk);
    return this.cache;
  }
}

export function createIndexedDbRagChunkPersistence(
  factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB,
): RagChunkPersistence {
  let dbPromise: Promise<IDBDatabase> | null = null;

  const db = (): Promise<IDBDatabase> => {
    if (!factory) return Promise.reject(new Error('IndexedDB is unavailable.'));
    dbPromise ??= openRagDb(factory);
    return dbPromise;
  };

  return {
    async all(): Promise<StoredRagChunk[]> {
      const database = await db();
      return requestToPromise<StoredRagChunk[]>(
        database.transaction(RAG_CHUNKS_STORE_NAME, 'readonly')
          .objectStore(RAG_CHUNKS_STORE_NAME)
          .getAll(),
      );
    },

    async putMany(chunks: StoredRagChunk[]): Promise<void> {
      const database = await db();
      const tx = database.transaction(RAG_CHUNKS_STORE_NAME, 'readwrite');
      const store = tx.objectStore(RAG_CHUNKS_STORE_NAME);
      for (const chunk of chunks) store.put(chunk);
      await transactionDone(tx);
    },

    async deleteIds(ids: string[]): Promise<void> {
      if (ids.length === 0) return;
      const database = await db();
      const tx = database.transaction(RAG_CHUNKS_STORE_NAME, 'readwrite');
      const store = tx.objectStore(RAG_CHUNKS_STORE_NAME);
      for (const id of ids) store.delete(id);
      await transactionDone(tx);
    },

    async clear(): Promise<void> {
      const database = await db();
      await requestToPromise(
        database.transaction(RAG_CHUNKS_STORE_NAME, 'readwrite')
          .objectStore(RAG_CHUNKS_STORE_NAME)
          .clear(),
      );
    },

    async count(): Promise<number> {
      const database = await db();
      return requestToPromise<number>(
        database.transaction(RAG_CHUNKS_STORE_NAME, 'readonly')
          .objectStore(RAG_CHUNKS_STORE_NAME)
          .count(),
      );
    },
  };
}

function openRagDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(RAG_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(RAG_CHUNKS_STORE_NAME)) {
        database.createObjectStore(RAG_CHUNKS_STORE_NAME, { keyPath: 'id' });
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

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed.'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted.'));
  });
}

function toStoredChunk(chunk: RagChunk): StoredRagChunk {
  const vector = new ArrayBuffer(chunk.vector.byteLength);
  new Uint8Array(vector).set(new Uint8Array(
    chunk.vector.buffer,
    chunk.vector.byteOffset,
    chunk.vector.byteLength,
  ));
  return {
    ...chunk,
    vector,
  };
}

function fromStoredChunk(chunk: StoredRagChunk): RagChunk {
  return {
    ...chunk,
    vector: new Float32Array(chunk.vector),
  };
}

function dot(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let score = 0;
  for (let i = 0; i < len; i += 1) score += a[i] * b[i];
  return score;
}

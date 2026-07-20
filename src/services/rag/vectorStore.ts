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
  generationId?: string;
  role?: 'user' | 'assistant';
  sourceTitle?: string;
  chunkOrdinal?: number;
  fingerprint?: string;
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
  getActiveManifest?(): Promise<RagIndexManifest | null>;
  replaceGeneration?(manifest: RagIndexManifest, chunks: StoredRagChunk[]): Promise<void>;
}

export interface RagIndexManifest {
  schemaVersion: 2;
  generationId: string;
  embeddingModel: string;
  vectorDimensions: number;
  chunkPolicyVersion: number;
  startedAt: number;
  completedAt: number;
  sourceCount: number;
  chunkCount: number;
}

export const RAG_DB_NAME = 'gatesai-rag';
export const RAG_CHUNKS_STORE_NAME = 'chunks';
export const RAG_MANIFESTS_STORE_NAME = 'manifests';
export const RAG_ACTIVE_MANIFEST_ID = 'active';
export const RAG_INDEX_SCHEMA_VERSION = 2;
export const RAG_CHUNK_POLICY_VERSION = 2;

export class RagVectorStore {
  private readonly persistence: RagChunkPersistence;
  private cache: RagChunk[] | null = null;
  private manifestCache: RagIndexManifest | null | undefined;

  constructor(persistence: RagChunkPersistence = createIndexedDbRagChunkPersistence()) {
    this.persistence = persistence;
  }

  async putMany(chunks: RagChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    await this.persistence.putMany(chunks.map(toStoredChunk));
    this.cache = null;
  }

  async replaceGeneration(manifest: RagIndexManifest, chunks: RagChunk[]): Promise<void> {
    validateGeneration(manifest, chunks);
    if (this.persistence.replaceGeneration) {
      await this.persistence.replaceGeneration(manifest, chunks.map(toStoredChunk));
    } else {
      await this.persistence.clear();
      await this.persistence.putMany(chunks.map(toStoredChunk));
    }
    this.cache = null;
    this.manifestCache = manifest;
  }

  async activeManifest(): Promise<RagIndexManifest | null> {
    if (this.manifestCache !== undefined) return this.manifestCache;
    this.manifestCache = this.persistence.getActiveManifest
      ? await this.persistence.getActiveManifest()
      : null;
    return this.manifestCache;
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
    this.manifestCache = null;
  }

  async count(model?: string): Promise<number> {
    if (!model) return this.persistence.count();
    return (await this.loadAll()).filter(chunk => chunk.model === model).length;
  }

  async search(query: Float32Array, model: string, k: number): Promise<RagSearchResult[]> {
    const manifest = await this.activeManifest();
    if (manifest && (manifest.embeddingModel !== model || query.length !== manifest.vectorDimensions)) return [];
    const chunks = (await this.loadAll()).filter(chunk => (
      chunk.model === model
      && (!manifest || (
        chunk.generationId === manifest.generationId
        && chunk.vector.length === manifest.vectorDimensions
      ))
    ));
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

    async getActiveManifest(): Promise<RagIndexManifest | null> {
      const database = await db();
      const value = await requestToPromise<RagIndexManifest | undefined>(
        database.transaction(RAG_MANIFESTS_STORE_NAME, 'readonly')
          .objectStore(RAG_MANIFESTS_STORE_NAME)
          .get(RAG_ACTIVE_MANIFEST_ID),
      );
      return value ?? null;
    },

    async replaceGeneration(manifest: RagIndexManifest, chunks: StoredRagChunk[]): Promise<void> {
      const database = await db();
      const tx = database.transaction([RAG_CHUNKS_STORE_NAME, RAG_MANIFESTS_STORE_NAME], 'readwrite');
      const chunkStore = tx.objectStore(RAG_CHUNKS_STORE_NAME);
      const existing = await requestToPromise<StoredRagChunk[]>(chunkStore.getAll());
      for (const chunk of chunks) chunkStore.put(chunk);
      tx.objectStore(RAG_MANIFESTS_STORE_NAME).put({ ...manifest, id: RAG_ACTIVE_MANIFEST_ID });
      for (const chunk of existing) {
        if (chunk.generationId !== manifest.generationId) chunkStore.delete(chunk.id);
      }
      await transactionDone(tx);
    },
  };
}

function openRagDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(RAG_DB_NAME, RAG_INDEX_SCHEMA_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(RAG_CHUNKS_STORE_NAME)) {
        database.createObjectStore(RAG_CHUNKS_STORE_NAME, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(RAG_MANIFESTS_STORE_NAME)) {
        database.createObjectStore(RAG_MANIFESTS_STORE_NAME, { keyPath: 'id' });
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
  if (a.length !== b.length) throw new Error(`RAG vector dimension mismatch: ${a.length} != ${b.length}`);
  let score = 0;
  for (let i = 0; i < a.length; i += 1) score += a[i] * b[i];
  return score;
}

function validateGeneration(manifest: RagIndexManifest, chunks: RagChunk[]): void {
  if (manifest.schemaVersion !== RAG_INDEX_SCHEMA_VERSION) throw new Error('Unsupported RAG index schema.');
  if (manifest.chunkPolicyVersion !== RAG_CHUNK_POLICY_VERSION) throw new Error('Unsupported RAG chunk policy.');
  if (chunks.length !== manifest.chunkCount) throw new Error('RAG manifest chunk count mismatch.');
  for (const chunk of chunks) {
    if (chunk.generationId !== manifest.generationId) throw new Error('RAG chunk generation mismatch.');
    if (chunk.model !== manifest.embeddingModel) throw new Error('RAG chunk model mismatch.');
    if (chunk.vector.length !== manifest.vectorDimensions) throw new Error('RAG chunk vector dimension mismatch.');
  }
}

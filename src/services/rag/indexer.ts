import type { Thread } from '../../core/types';
import type { Note } from '../../core/notes';
import type { RagEmbedder } from './embeddings';
import {
  RAG_CHUNK_POLICY_VERSION,
  RAG_INDEX_SCHEMA_VERSION,
  type RagChunk,
  type RagIndexManifest,
  type RagSourceType,
} from './vectorStore';
import type { RagVectorStore } from './vectorStore';
import { messageText } from '../../core/messageParts';

export interface RagSource {
  sourceType: RagSourceType;
  sourceId: string;
  threadId?: string;
  text: string;
  updatedAt: number;
  role?: 'user' | 'assistant';
  sourceTitle?: string;
}

export interface RagSourceSnapshot {
  threads: Thread[];
  notes: Note[];
  facts: string[];
}

export interface RagWatermark {
  hash: string;
  updatedAt: number;
  model: string;
}

export interface RagWatermarkStore {
  load(): Record<string, RagWatermark>;
  save(watermarks: Record<string, RagWatermark>): void;
  clear(): void;
}

export interface RagIndexerDeps {
  vectorStore: RagVectorStore;
  embedder: RagEmbedder;
  getSources(): RagSourceSnapshot | Promise<RagSourceSnapshot>;
  getModel(): string;
  getActive(): boolean;
  isStreaming(): boolean;
  watermarkStore?: RagWatermarkStore;
  onProgress?(progress: RagIndexerProgress): void;
}

export interface RagIndexerProgress {
  phase: 'scanning' | 'embedding' | 'committing';
  sourcesCompleted: number;
  sourcesTotal: number;
  chunksCompleted: number;
  chunksTotal: number;
}

export const RAG_WATERMARK_STORAGE_KEY = 'gatesai.rag.watermarks.v1';

export class RagIndexer {
  private readonly vectorStore: RagVectorStore;
  private readonly embedder: RagEmbedder;
  private readonly getSources: () => RagSourceSnapshot | Promise<RagSourceSnapshot>;
  private readonly getModel: () => string;
  private readonly getActive: () => boolean;
  private readonly isStreaming: () => boolean;
  private readonly watermarks: RagWatermarkStore;
  private readonly onProgress?: (progress: RagIndexerProgress) => void;
  private inFlight = false;

  constructor(deps: RagIndexerDeps) {
    this.vectorStore = deps.vectorStore;
    this.embedder = deps.embedder;
    this.getSources = deps.getSources;
    this.getModel = deps.getModel;
    this.getActive = deps.getActive;
    this.isStreaming = deps.isStreaming;
    this.watermarks = deps.watermarkStore ?? createLocalStorageRagWatermarkStore();
    this.onProgress = deps.onProgress;
  }

  async tick(signal?: AbortSignal): Promise<{ indexed: number; skipped: number; purged: number }> {
    if (this.inFlight || !this.getActive() || this.isStreaming()) return { indexed: 0, skipped: 0, purged: 0 };
    this.inFlight = true;
    try {
      const model = this.getModel();
      const snapshot = await this.getSources();
      const sources = collectRagSources(snapshot);
      const liveKeys = new Set(sources.map(sourceKey));
      const watermarks = this.watermarks.load();
      this.report('scanning', 0, sources.length, 0, 0);
      let skipped = 0;
      const unchanged = sources.every(source => {
        const existing = watermarks[sourceKey(source)];
        const hash = contentHash(source.text);
        if (existing?.hash === hash && existing.model === model && existing.updatedAt === source.updatedAt) {
          skipped += 1;
          return true;
        }
        return false;
      }) && Object.keys(watermarks).every(key => liveKeys.has(key));
      if (unchanged && await this.vectorStore.activeManifest()) return { indexed: 0, skipped, purged: 0 };
      return await this.buildGeneration(sources, model, watermarks, signal);
    } finally {
      this.inFlight = false;
    }
  }

  async rebuild(signal?: AbortSignal): Promise<void> {
    if (this.inFlight || !this.getActive() || this.isStreaming()) return;
    this.inFlight = true;
    try {
      const model = this.getModel();
      const snapshot = await this.getSources();
      await this.buildGeneration(collectRagSources(snapshot), model, {}, signal);
    } finally {
      this.inFlight = false;
    }
  }

  clearWatermarks(): void {
    this.watermarks.clear();
  }

  private async buildGeneration(
    sources: RagSource[],
    model: string,
    previousWatermarks: Record<string, RagWatermark>,
    signal?: AbortSignal,
  ): Promise<{ indexed: number; skipped: number; purged: number }> {
    throwIfPaused(signal, this.getActive, this.isStreaming);
    const startedAt = Date.now();
    const generationId = `${startedAt.toString(36)}-${contentHash(sources.map(sourceKey).join('|'))}`;
    const prepared = sources.flatMap(source => {
      const fingerprint = contentHash(source.text);
      return chunkText(source.text).map((text, chunkOrdinal) => ({ source, text, chunkOrdinal, fingerprint }));
    });
    this.report('embedding', 0, sources.length, 0, prepared.length);
    const vectors = await this.embedder.embed(prepared.map(item => item.text), model, signal);
    throwIfPaused(signal, this.getActive, this.isStreaming);
    if (vectors.length !== prepared.length) throw new Error('RAG embedding count mismatch.');
    const vectorDimensions = vectors[0]?.length ?? 0;
    if (prepared.length > 0 && vectorDimensions === 0) throw new Error('RAG embedding vector is empty.');
    if (vectors.some(vector => vector.length !== vectorDimensions)) throw new Error('RAG embedding dimensions are inconsistent.');
    const chunks: RagChunk[] = prepared.map((item, index) => ({
      id: `${generationId}:${item.source.sourceType}:${item.source.sourceId}:${item.fingerprint}:${item.chunkOrdinal}`,
      generationId,
      sourceType: item.source.sourceType,
      sourceId: item.source.sourceId,
      ...(item.source.threadId ? { threadId: item.source.threadId } : {}),
      ...(item.source.role ? { role: item.source.role } : {}),
      ...(item.source.sourceTitle ? { sourceTitle: item.source.sourceTitle } : {}),
      text: item.text,
      vector: vectors[index],
      updatedAt: item.source.updatedAt,
      model,
      chunkOrdinal: item.chunkOrdinal,
      fingerprint: item.fingerprint,
    }));
    this.report('committing', sources.length, sources.length, chunks.length, chunks.length);
    const manifest: RagIndexManifest = {
      schemaVersion: RAG_INDEX_SCHEMA_VERSION,
      generationId,
      embeddingModel: model,
      vectorDimensions,
      chunkPolicyVersion: RAG_CHUNK_POLICY_VERSION,
      startedAt,
      completedAt: Date.now(),
      sourceCount: sources.length,
      chunkCount: chunks.length,
    };
    await this.vectorStore.replaceGeneration(manifest, chunks);
    const nextWatermarks: Record<string, RagWatermark> = {};
    for (const source of sources) nextWatermarks[sourceKey(source)] = {
      hash: contentHash(source.text),
      updatedAt: source.updatedAt,
      model,
    };
    this.watermarks.save(nextWatermarks);
    const purged = Object.keys(previousWatermarks).filter(key => !(key in nextWatermarks)).length;
    return { indexed: chunks.length, skipped: 0, purged };
  }

  private report(
    phase: RagIndexerProgress['phase'],
    sourcesCompleted: number,
    sourcesTotal: number,
    chunksCompleted: number,
    chunksTotal: number,
  ): void {
    this.onProgress?.({ phase, sourcesCompleted, sourcesTotal, chunksCompleted, chunksTotal });
  }
}

export function collectRagSources(snapshot: RagSourceSnapshot): RagSource[] {
  const sources: RagSource[] = [];
  for (const thread of snapshot.threads) {
    if (thread.deletedAt != null) continue;
    for (const message of thread.messages) {
      const text = messageText(message).trim();
      if (!text) continue;
      sources.push({
        sourceType: 'message',
        sourceId: message.id,
        threadId: thread.id,
        text,
        updatedAt: message.createdAt,
        role: message.role === 'assistant' ? 'assistant' : 'user',
        sourceTitle: thread.title,
      });
    }
  }
  for (const note of snapshot.notes) {
    const text = [`# ${note.title.trim()}`, note.body.trim()].filter(Boolean).join('\n\n');
    if (!text.trim()) continue;
    sources.push({
      sourceType: 'note',
      sourceId: note.id,
      text,
      updatedAt: note.updatedAt,
      sourceTitle: note.title,
    });
  }
  snapshot.facts.forEach(fact => {
    const text = fact.trim();
    if (!text) return;
    sources.push({
      sourceType: 'memory',
      sourceId: `memory-${contentHash(text.toLowerCase().replace(/\s+/g, ' '))}`,
      text,
      updatedAt: contentHash(text).split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0),
    });
  });
  return sources;
}

export function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (!clean) return [];
  if (clean.length <= 1200) return [clean];

  const paragraphs = clean.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > 1000) {
      chunks.push(current.trim());
      const overlap = current.slice(Math.max(0, current.length - 100)).trim();
      current = overlap ? `${overlap}\n\n${paragraph}` : paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  const final: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= 1300) {
      final.push(chunk);
      continue;
    }
    for (let start = 0; start < chunk.length; start += 900) {
      final.push(chunk.slice(Math.max(0, start - 100), start + 900).trim());
    }
  }
  return final;
}

export function createLocalStorageRagWatermarkStore(
  key = RAG_WATERMARK_STORAGE_KEY,
  storage: Storage | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
): RagWatermarkStore {
  return {
    load() {
      if (!storage) return {};
      try {
        const raw = storage.getItem(key);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object') return {};
        return parsed as Record<string, RagWatermark>;
      } catch {
        return {};
      }
    },
    save(watermarks) {
      if (!storage) return;
      storage.setItem(key, JSON.stringify(watermarks));
    },
    clear() {
      storage?.removeItem(key);
    },
  };
}

function sourceKey(source: RagSource): string {
  return source.threadId
    ? `${source.sourceType}:${source.threadId}:${source.sourceId}`
    : `${source.sourceType}:${source.sourceId}`;
}

export function contentHash(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function throwIfPaused(
  signal: AbortSignal | undefined,
  getActive: () => boolean,
  isStreaming: () => boolean,
): void {
  if (signal?.aborted || !getActive() || isStreaming()) throw new DOMException('RAG indexing paused.', 'AbortError');
}

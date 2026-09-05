import type { Thread } from '../../core/types';
import type { Note } from '../../core/notes';
import type { LibraryDocument } from '../library/types';
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
  embeddingText?: string;
  updatedAt: number;
  role?: 'user' | 'assistant';
  sourceTitle?: string;
}

export interface RagSourceSnapshot {
  threads: Thread[];
  notes: Note[];
  facts: string[];
  library?: LibraryDocument[];
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
      const watermarks = this.watermarks.load();
      this.report('scanning', 0, sources.length, 0, 0);
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
      await this.buildGeneration(collectRagSources(snapshot), model, {}, signal, true);
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
    forceRefresh = false,
  ): Promise<{ indexed: number; skipped: number; purged: number }> {
    throwIfPaused(signal, this.getActive, this.isStreaming);
    const startedAt = Date.now();
    const generationId = Array.from(crypto.getRandomValues(new Uint32Array(4)), word => word.toString(16).padStart(8, '0')).join('');
    const prepared = sources.flatMap(source => {
      const fingerprint = contentHash(source.embeddingText ?? source.text);
      const displayPieces = chunkText(source.text);
      return displayPieces.map((text, chunkOrdinal) => ({
        source,
        text,
        embeddingText: boundedEmbeddingText(source.embeddingText ?? text, text),
        chunkOrdinal,
        fingerprint,
      }));
    });
    const activeManifest = await this.vectorStore.activeManifest();
    const compatible = !forceRefresh && activeManifest?.schemaVersion === RAG_INDEX_SCHEMA_VERSION
      && activeManifest.embeddingModel === model
      && activeManifest.chunkPolicyVersion === RAG_CHUNK_POLICY_VERSION;
    const previousChunks = compatible ? await this.vectorStore.activeChunks(model) : [];
    const previousByKey = new Map(previousChunks.map(chunk => [chunkKey(chunk, chunk.chunkOrdinal), chunk]));
    const reused = prepared.map(item => {
      const previous = previousByKey.get(chunkKey(item.source, item.chunkOrdinal));
      return previous?.embeddingInput === item.embeddingText && previous.vector.length > 0
        && previous.vector.every(Number.isFinite) ? previous : undefined;
    });
    const unchanged = compatible && activeManifest.chunkCount === prepared.length
      && activeManifest.sourceCount === sources.length && previousChunks.length === prepared.length
      && prepared.every((item, index) => {
        const previous = reused[index];
        return previous && previous.text === item.text && previous.updatedAt === item.source.updatedAt
          && previous.sourceTitle === item.source.sourceTitle && previous.role === item.source.role
          && previous.fingerprint === item.fingerprint;
      });
    throwIfPaused(signal, this.getActive, this.isStreaming);
    if (unchanged) return { indexed: 0, skipped: sources.length, purged: 0 };
    const pending = prepared.filter((_, index) => !reused[index]);
    this.report('embedding', 0, sources.length, prepared.length - pending.length, prepared.length);
    const freshVectors = pending.length > 0
      ? await this.embedder.embed(pending.map(item => item.embeddingText), model, signal) : [];
    throwIfPaused(signal, this.getActive, this.isStreaming);
    if (freshVectors.length !== pending.length) throw new Error('RAG embedding count mismatch.');
    let freshIndex = 0;
    const vectors = prepared.map((_, index) => reused[index]?.vector ?? freshVectors[freshIndex++]);
    const vectorDimensions = vectors[0]?.length ?? 0;
    if (prepared.length > 0 && vectorDimensions === 0) throw new Error('RAG embedding vector is empty.');
    if (compatible && activeManifest.vectorDimensions > 0 && prepared.length > 0
      && vectorDimensions !== activeManifest.vectorDimensions) throw new Error('RAG embedding dimensions changed; rebuild required.');
    if (vectors.some(vector => vector.length !== vectorDimensions)) throw new Error('RAG embedding dimensions are inconsistent.');
    if (vectors.some(vector => !vector.every(Number.isFinite))) throw new Error('RAG embedding vector contains non-finite values.');
    const chunks: RagChunk[] = prepared.map((item, index) => ({
      id: `${generationId}:${item.source.sourceType}:${item.source.sourceId}:${item.fingerprint}:${item.chunkOrdinal}`,
      generationId,
      sourceType: item.source.sourceType,
      sourceId: item.source.sourceId,
      ...(item.source.threadId ? { threadId: item.source.threadId } : {}),
      ...(item.source.role ? { role: item.source.role } : {}),
      ...(item.source.sourceTitle ? { sourceTitle: item.source.sourceTitle } : {}),
      text: item.text,
      embeddingInput: item.embeddingText,
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
      hash: contentHash(source.embeddingText ?? source.text),
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
    for (let index = 0; index < thread.messages.length; index += 1) {
      const message = thread.messages[index];
      const text = messageText(message).trim();
      if (!text) continue;
      const previous = index > 0 ? messageText(thread.messages[index - 1]).trim() : '';
      const next = index + 1 < thread.messages.length ? messageText(thread.messages[index + 1]).trim() : '';
      const adjacent = message.role === 'user'
        ? (thread.messages[index + 1]?.role === 'assistant' ? next : previous)
        : (thread.messages[index - 1]?.role === 'user' ? previous : next);
      const role = message.role === 'assistant' ? 'assistant' : 'user';
      sources.push({
        sourceType: 'message',
        sourceId: message.id,
        threadId: thread.id,
        text,
        embeddingText: [
          thread.title?.trim() ? `Thread: ${thread.title.trim()}` : '',
          adjacent ? `${role === 'user' ? 'Following assistant' : 'Previous user'}: ${adjacent.slice(0, 900)}` : '',
          `${role === 'user' ? 'User' : 'Assistant'}: ${text}`,
        ].filter(Boolean).join('\n'),
        updatedAt: message.createdAt,
        role,
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
  for (const document of snapshot.library ?? []) {
    const text = document.text.trim();
    if (!text) continue;
    sources.push({
      sourceType: 'library',
      sourceId: document.id,
      text,
      embeddingText: [`Library source: ${document.title}`, `Path: ${document.path}`, text].join('\n'),
      updatedAt: document.updatedAt,
      sourceTitle: document.title,
    });
  }
  return sources;
}

function boundedEmbeddingText(context: string, display: string): string {
  if (context.length <= 2_400) return context;
  const room = Math.max(0, 2_400 - display.length - 2);
  return `${context.slice(0, room)}\n${display}`.slice(-2_400);
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

function chunkKey(source: Pick<RagChunk, 'sourceType' | 'threadId' | 'sourceId'>, ordinal: number | undefined): string {
  return JSON.stringify([source.sourceType, source.threadId ?? null, source.sourceId, ordinal ?? null]);
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

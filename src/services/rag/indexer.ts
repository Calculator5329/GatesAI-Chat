import type { Thread } from '../../core/types';
import type { Note } from '../../core/notes';
import type { RagEmbedder } from './embeddings';
import type { RagChunk, RagSourceType } from './vectorStore';
import type { RagVectorStore } from './vectorStore';
import { messageText } from '../../core/messageParts';

export interface RagSource {
  sourceType: RagSourceType;
  sourceId: string;
  threadId?: string;
  text: string;
  updatedAt: number;
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
  getSources(): RagSourceSnapshot;
  getModel(): string;
  getActive(): boolean;
  isStreaming(): boolean;
  watermarkStore?: RagWatermarkStore;
}

export const RAG_WATERMARK_STORAGE_KEY = 'gatesai.rag.watermarks.v1';

export class RagIndexer {
  private readonly vectorStore: RagVectorStore;
  private readonly embedder: RagEmbedder;
  private readonly getSources: () => RagSourceSnapshot;
  private readonly getModel: () => string;
  private readonly getActive: () => boolean;
  private readonly isStreaming: () => boolean;
  private readonly watermarks: RagWatermarkStore;
  private inFlight = false;

  constructor(deps: RagIndexerDeps) {
    this.vectorStore = deps.vectorStore;
    this.embedder = deps.embedder;
    this.getSources = deps.getSources;
    this.getModel = deps.getModel;
    this.getActive = deps.getActive;
    this.isStreaming = deps.isStreaming;
    this.watermarks = deps.watermarkStore ?? createLocalStorageRagWatermarkStore();
  }

  async tick(signal?: AbortSignal): Promise<{ indexed: number; skipped: number; purged: number }> {
    if (this.inFlight || !this.getActive() || this.isStreaming()) return { indexed: 0, skipped: 0, purged: 0 };
    this.inFlight = true;
    try {
      const model = this.getModel();
      const snapshot = this.getSources();
      const sources = collectRagSources(snapshot);
      const liveKeys = new Set(sources.map(sourceKey));
      const watermarks = this.watermarks.load();
      let purged = await this.purgeDeletedSources(watermarks, liveKeys, snapshot.threads);
      let skipped = 0;
      let indexed = 0;

      for (const source of sources) {
        if (signal?.aborted || !this.getActive() || this.isStreaming()) break;
        const key = sourceKey(source);
        const hash = contentHash(source.text);
        const existing = watermarks[key];
        if (existing && existing.hash === hash && existing.model === model && existing.updatedAt === source.updatedAt) {
          skipped += 1;
          continue;
        }
        await this.vectorStore.deleteBySource(source.sourceType, source.sourceId);
        const pieces = chunkText(source.text);
        if (pieces.length > 0) {
          const vectors = await this.embedder.embed(pieces, model, signal);
          const chunks: RagChunk[] = pieces.map((text, index) => ({
            id: `${source.sourceType}:${source.sourceId}:${model}:${index}`,
            sourceType: source.sourceType,
            sourceId: source.sourceId,
            ...(source.threadId ? { threadId: source.threadId } : {}),
            text,
            vector: vectors[index],
            updatedAt: source.updatedAt,
            model,
          }));
          await this.vectorStore.putMany(chunks);
          indexed += chunks.length;
        }
        watermarks[key] = { hash, updatedAt: source.updatedAt, model };
        this.watermarks.save(watermarks);
      }

      purged += await this.purgeMissingWatermarks(watermarks, liveKeys);
      return { indexed, skipped, purged };
    } finally {
      this.inFlight = false;
    }
  }

  async rebuild(): Promise<void> {
    await this.vectorStore.clear();
    this.watermarks.clear();
    await this.tick();
  }

  clearWatermarks(): void {
    this.watermarks.clear();
  }

  private async purgeDeletedSources(
    watermarks: Record<string, RagWatermark>,
    liveKeys: Set<string>,
    threads: Thread[],
  ): Promise<number> {
    let purged = 0;
    for (const thread of threads) {
      if (thread.deletedAt == null) continue;
      await this.vectorStore.deleteByThread(thread.id);
      for (const key of Object.keys(watermarks)) {
        if (key.startsWith(`message:${thread.id}:`)) {
          delete watermarks[key];
          purged += 1;
        }
      }
    }
    purged += await this.purgeMissingWatermarks(watermarks, liveKeys);
    if (purged > 0) this.watermarks.save(watermarks);
    return purged;
  }

  private async purgeMissingWatermarks(watermarks: Record<string, RagWatermark>, liveKeys: Set<string>): Promise<number> {
    let purged = 0;
    for (const key of Object.keys(watermarks)) {
      if (liveKeys.has(key)) continue;
      const parsed = parseSourceKey(key);
      if (parsed) await this.vectorStore.deleteBySource(parsed.sourceType, parsed.sourceId);
      delete watermarks[key];
      purged += 1;
    }
    if (purged > 0) this.watermarks.save(watermarks);
    return purged;
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
    });
  }
  snapshot.facts.forEach((fact, index) => {
    const text = fact.trim();
    if (!text) return;
    sources.push({
      sourceType: 'memory',
      sourceId: `memory-${index}`,
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

function parseSourceKey(key: string): { sourceType: RagSourceType; sourceId: string } | null {
  const parts = key.split(':');
  const sourceType = parts[0] as RagSourceType;
  if (sourceType !== 'message' && sourceType !== 'note' && sourceType !== 'memory') return null;
  const sourceId = sourceType === 'message' ? parts[2] : parts[1];
  return sourceId ? { sourceType, sourceId } : null;
}

function contentHash(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

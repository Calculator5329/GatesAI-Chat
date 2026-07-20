import type { RagEmbedder } from '../../../src/services/rag/embeddings';
import type { RagChunkPersistence, RagIndexManifest, StoredRagChunk } from '../../../src/services/rag/vectorStore';

export class MemoryRagPersistence implements RagChunkPersistence {
  readonly chunks = new Map<string, StoredRagChunk>();
  manifest: RagIndexManifest | null = null;

  async all(): Promise<StoredRagChunk[]> {
    return [...this.chunks.values()];
  }

  async putMany(chunks: StoredRagChunk[]): Promise<void> {
    for (const chunk of chunks) this.chunks.set(chunk.id, chunk);
  }

  async deleteIds(ids: string[]): Promise<void> {
    for (const id of ids) this.chunks.delete(id);
  }

  async clear(): Promise<void> {
    this.chunks.clear();
    this.manifest = null;
  }

  async count(): Promise<number> {
    return this.chunks.size;
  }

  async getActiveManifest(): Promise<RagIndexManifest | null> {
    return this.manifest;
  }

  async replaceGeneration(manifest: RagIndexManifest, chunks: StoredRagChunk[]): Promise<void> {
    this.chunks.clear();
    chunks.forEach(chunk => this.chunks.set(chunk.id, chunk));
    this.manifest = manifest;
  }
}

export class FakeEmbedder implements RagEmbedder {
  calls: string[][] = [];

  async embed(input: string[]): Promise<Float32Array[]> {
    this.calls.push([...input]);
    return input.map(text => vectorForText(text));
  }
}

export function vectorForText(text: string): Float32Array {
  const lower = text.toLowerCase();
  if (lower.includes('alpha')) return new Float32Array([1, 0, 0]);
  if (lower.includes('beta')) return new Float32Array([0, 1, 0]);
  if (lower.includes('gamma')) return new Float32Array([0, 0, 1]);
  let a = 1;
  let b = 1;
  let c = 1;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    a += code % 7;
    b += code % 11;
    c += code % 13;
  }
  const norm = Math.sqrt(a * a + b * b + c * c);
  return new Float32Array([a / norm, b / norm, c / norm]);
}

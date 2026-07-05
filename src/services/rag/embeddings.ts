export const DEFAULT_RAG_EMBEDDING_MODEL = 'nomic-embed-text';
export const RAG_EMBED_BATCH_SIZE = 16;
export const RAG_EMBED_TIMEOUT_MS = 15_000;

export type RagEmbeddingErrorCode = 'unavailable' | 'http_error' | 'invalid_response' | 'aborted';

export class RagEmbeddingError extends Error {
  readonly code: RagEmbeddingErrorCode;

  constructor(code: RagEmbeddingErrorCode, message: string) {
    super(message);
    this.name = 'RagEmbeddingError';
    this.code = code;
  }
}

export interface RagEmbedder {
  embed(input: string[], model: string, signal?: AbortSignal): Promise<Float32Array[]>;
}

export interface OllamaEmbeddingClientOptions {
  getBaseUrl(): string;
  getApiKey?(): string | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  batchSize?: number;
}

export class OllamaEmbeddingClient implements RagEmbedder {
  private readonly getBaseUrl: () => string;
  private readonly getApiKey: () => string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly batchSize: number;

  constructor(options: OllamaEmbeddingClientOptions) {
    this.getBaseUrl = options.getBaseUrl;
    this.getApiKey = options.getApiKey ?? (() => undefined);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? RAG_EMBED_TIMEOUT_MS;
    this.batchSize = options.batchSize ?? RAG_EMBED_BATCH_SIZE;
  }

  async embed(input: string[], model: string, signal?: AbortSignal): Promise<Float32Array[]> {
    const texts = input.map(text => text.trim()).filter(Boolean);
    if (texts.length === 0) return [];
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      if (signal?.aborted) throw new RagEmbeddingError('aborted', 'Embedding request aborted.');
      const batch = texts.slice(i, i + this.batchSize);
      out.push(...await this.embedBatch(batch, model, signal));
    }
    return out;
  }

  private async embedBatch(input: string[], model: string, signal?: AbortSignal): Promise<Float32Array[]> {
    const baseUrl = this.getBaseUrl().replace(/\/+$/, '');
    if (!baseUrl) throw new RagEmbeddingError('unavailable', 'Ollama base URL is not configured.');

    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.timeoutMs);
    const onAbort = () => timeout.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const apiKey = this.getApiKey();
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const resp = await this.fetchImpl(`${baseUrl}/api/embed`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, input }),
        signal: timeout.signal,
      });
      if (!resp.ok) {
        throw new RagEmbeddingError('http_error', `Ollama embed failed with HTTP ${resp.status}.`);
      }
      const json = await resp.json();
      if (!isEmbeddingResponse(json) || json.embeddings.length !== input.length) {
        throw new RagEmbeddingError('invalid_response', 'Ollama embed returned an invalid response.');
      }
      return json.embeddings.map(vector => normalizeVector(vector));
    } catch (err) {
      if (timeout.signal.aborted || signal?.aborted) {
        throw new RagEmbeddingError('aborted', 'Embedding request aborted.');
      }
      if (err instanceof RagEmbeddingError) throw err;
      throw new RagEmbeddingError('unavailable', err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}

export function normalizeVector(values: number[]): Float32Array {
  let norm = 0;
  for (const value of values) norm += value * value;
  norm = Math.sqrt(norm);
  if (!Number.isFinite(norm) || norm <= 0) return new Float32Array(values.length);
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i += 1) out[i] = values[i] / norm;
  return out;
}

function isEmbeddingResponse(value: unknown): value is { embeddings: number[][] } {
  if (!value || typeof value !== 'object') return false;
  const embeddings = (value as { embeddings?: unknown }).embeddings;
  return Array.isArray(embeddings)
    && embeddings.every(row => Array.isArray(row) && row.every(n => typeof n === 'number' && Number.isFinite(n)));
}

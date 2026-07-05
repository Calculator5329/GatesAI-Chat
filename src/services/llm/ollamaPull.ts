import { ensureOk } from './sse';
import { finiteNumber, isRecord, readUtf8Lines } from './streamCore';

export interface OllamaPullProgress {
  phase: string;
  percent: number;
}

export interface OllamaPullCallbacks {
  baseUrl: string;
  apiKey?: string;
  onProgress?: (progress: OllamaPullProgress) => void;
}

interface OllamaPullFrame {
  status?: string;
  digest?: string;
  total?: number;
  completed?: number;
  error?: string;
}

interface LayerProgress {
  total: number;
  completed: number;
}

export async function pullModel(
  name: string,
  callbacks: OllamaPullCallbacks,
  signal: AbortSignal,
): Promise<void> {
  const model = name.trim();
  if (!model) throw new Error('Choose an Ollama model to pull.');

  callbacks.onProgress?.({ phase: 'Starting pull', percent: 0 });
  const response = await fetch(`${normalizeBaseUrl(callbacks.baseUrl)}/api/pull`, {
    method: 'POST',
    headers: headersFor(callbacks.apiKey),
    body: JSON.stringify({ model, stream: true }),
    signal,
  });
  await ensureOk(response, 'Ollama pull');
  if (!response.body) throw new Error('Ollama pull: empty response body');

  const progress = createProgressTracker(callbacks.onProgress);
  for await (const line of readUtf8Lines(response.body, signal)) {
    let frame: OllamaPullFrame;
    try {
      frame = parsePullFrame(JSON.parse(line));
    } catch {
      continue;
    }
    if (frame.error) throw new Error(frame.error);
    progress.consume(frame);
  }
  if (signal.aborted) throw abortError();
  progress.finish();
}

export async function deleteModel(
  name: string,
  opts: { baseUrl: string; apiKey?: string },
): Promise<void> {
  const model = name.trim();
  if (!model) throw new Error('Choose an Ollama model to delete.');
  const response = await fetch(`${normalizeBaseUrl(opts.baseUrl)}/api/delete`, {
    method: 'DELETE',
    headers: headersFor(opts.apiKey),
    body: JSON.stringify({ model }),
  });
  await ensureOk(response, 'Ollama delete');
}

function createProgressTracker(onProgress: ((progress: OllamaPullProgress) => void) | undefined) {
  const layers = new Map<string, LayerProgress>();
  let maxPercent = 0;
  let lastPhase = 'Starting pull';

  return {
    consume(frame: OllamaPullFrame): void {
      const phase = frame.status?.trim() || lastPhase;
      lastPhase = phase;
      const digest = frame.digest?.trim();
      if (digest && frame.total !== undefined) {
        const previous = layers.get(digest) ?? { total: 0, completed: 0 };
        const total = Math.max(previous.total, frame.total);
        const completed = Math.max(previous.completed, Math.min(frame.completed ?? previous.completed, total));
        layers.set(digest, { total, completed });
      }

      const computed = computeLayerPercent(layers);
      if (phase.toLowerCase() === 'success') maxPercent = 100;
      else if (computed !== null) maxPercent = Math.max(maxPercent, computed);
      onProgress?.({ phase, percent: maxPercent });
    },

    finish(): void {
      maxPercent = 100;
      onProgress?.({ phase: lastPhase.toLowerCase() === 'success' ? lastPhase : 'Complete', percent: 100 });
    },
  };
}

function computeLayerPercent(layers: Map<string, LayerProgress>): number | null {
  let completed = 0;
  let total = 0;
  for (const layer of layers.values()) {
    if (layer.total <= 0) continue;
    completed += Math.min(layer.completed, layer.total);
    total += layer.total;
  }
  if (total <= 0) return null;
  return Math.max(0, Math.min(99, Math.floor((completed / total) * 100)));
}

function parsePullFrame(value: unknown): OllamaPullFrame {
  if (!isRecord(value)) return {};
  return {
    status: typeof value.status === 'string' ? value.status : undefined,
    digest: typeof value.digest === 'string' ? value.digest : undefined,
    total: finiteNumber(value.total, 0),
    completed: finiteNumber(value.completed, 0),
    error: typeof value.error === 'string' ? value.error : undefined,
  };
}

function headersFor(apiKey: string | undefined): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function abortError(): Error {
  try {
    return new DOMException('The Ollama pull was cancelled.', 'AbortError');
  } catch {
    const err = new Error('The Ollama pull was cancelled.');
    err.name = 'AbortError';
    return err;
  }
}

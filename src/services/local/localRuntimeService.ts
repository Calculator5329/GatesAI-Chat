// Reads from local runtimes that GatesAI finds but never starts, plus the native file picker.
// fetchOllamaTags goes through localFetch (Rust `local_http_request` on desktop, window.fetch in Web Lite);
// pickFile invokes `pick_file` in src-tauri/src/local_runtime.rs.
// Called by LocalRuntimeStore (Ollama probe) and LibraryStore (pickAndAdd).
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '../../core/runtime';
import { localFetch } from './localHttp';
import { parseOllamaShowNumCtx } from '../llm/ollamaCatalog';

const TAGS_TIMEOUT_MS = 8_000;

export type LocalRuntimeId = 'ollama' | 'comfyui';

export interface LocalRuntimeService {
  /** GET `${baseUrl}/api/tags` from any http(s) Ollama host; rejects on a non-2xx status or after 8 s. */
  fetchOllamaTags(baseUrl: string, apiKey?: string): Promise<unknown>;
  /**
   * POST `${baseUrl}/api/show` for one tag and returns the `num_ctx` its
   * Modelfile sets: the window Ollama loads it with. Undefined when the
   * Modelfile sets none; rejects on a non-2xx status or after 8 s.
   */
  fetchOllamaNumCtx(baseUrl: string, tag: string, apiKey?: string): Promise<number | undefined>;
  /** Native open-file dialog; null when cancelled or outside the desktop app. */
  pickFile(): Promise<string | null>;
}

export const localRuntimeService: LocalRuntimeService = {
  async fetchOllamaTags(baseUrl, apiKey) {
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    return await withTimeout<unknown>(TAGS_TIMEOUT_MS, async signal => {
      const resp = await localFetch(`${baseUrl.trim().replace(/\/+$/, '')}/api/tags`, { headers, signal });
      if (!resp.ok) throw new Error(`Ollama ${resp.status}`);
      return await resp.json();
    });
  },

  async fetchOllamaNumCtx(baseUrl, tag, apiKey) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    return await withTimeout<number | undefined>(TAGS_TIMEOUT_MS, async signal => {
      const resp = await localFetch(`${baseUrl.trim().replace(/\/+$/, '')}/api/show`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: tag }),
        signal,
      });
      if (!resp.ok) throw new Error(`Ollama ${resp.status}`);
      return parseOllamaShowNumCtx(await resp.json());
    });
  },

  async pickFile() {
    if (!isTauri()) return null;
    return await invoke<string | null>('pick_file');
  },
};

/** Runs `work` with a signal that aborts after `ms`, so a host that accepts but never answers cannot hang a probe. */
async function withTimeout<T>(ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await work(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

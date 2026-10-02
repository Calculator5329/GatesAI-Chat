// Manages local-runtime discovery, process control, or persistence for localRuntimeService.
// Called by LocalRuntimeStore and menu controls; depends on bridge/system APIs and runtime ids.
// Invariant: runtime state is stored separately from detection/probe side effects.
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '../../core/runtime';
import { localFetch } from './localHttp';

const PROBE_TIMEOUT_MS = 4_000;
const TAGS_TIMEOUT_MS = 8_000;

export type LocalRuntimeId = 'ollama' | 'comfyui';
export type LocalRuntimeStatus = 'stopped' | 'starting' | 'online' | 'offline' | 'crashed';

export interface RuntimeStartOptions {
  installPath: string;
}

export interface RuntimeStatusSnapshot {
  running: boolean;
  pid?: number;
  uptimeMs?: number;
  status: LocalRuntimeStatus;
  logs: string[];
  lastError?: string;
}

export interface LocalRuntimeService {
  startRuntime(id: LocalRuntimeId, options: RuntimeStartOptions): Promise<void>;
  stopRuntime(id: LocalRuntimeId): Promise<void>;
  getRuntimeStatus(id: LocalRuntimeId): Promise<RuntimeStatusSnapshot>;
  /** GET an Ollama/ComfyUI health URL; rejects on a non-2xx status or after 4 s. */
  probeHttp(url: string): Promise<void>;
  /** GET `${baseUrl}/api/tags` from any http(s) Ollama host; rejects on a non-2xx status or after 8 s. */
  fetchOllamaTags(baseUrl: string, apiKey?: string): Promise<unknown>;
  pathExists(path: string): Promise<boolean>;
  pickDirectory(): Promise<string | null>;
  pickFile(): Promise<string | null>;
  getCandidatePaths(): Promise<RuntimeCandidatePaths | null>;
}

export interface RuntimeCandidatePaths {
  platform: string;
  homeDir: string;
  localAppData: string;
  comfyCandidates: string[];
}

export const localRuntimeService: LocalRuntimeService = {
  async startRuntime(id, options) {
    ensureTauri('start local runtimes');
    await invoke('spawn_runtime', { id, installPath: options.installPath });
  },

  async stopRuntime(id) {
    ensureTauri('stop local runtimes');
    await invoke('stop_runtime', { id });
  },

  async getRuntimeStatus(id) {
    ensureTauri('read local runtime status');
    return await invoke<RuntimeStatusSnapshot>('runtime_status', { id });
  },

  async probeHttp(url) {
    await withTimeout(PROBE_TIMEOUT_MS, async signal => {
      const resp = await localFetch(url, { signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status} from ${url}`);
    });
  },

  async fetchOllamaTags(baseUrl, apiKey) {
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    return await withTimeout<unknown>(TAGS_TIMEOUT_MS, async signal => {
      const resp = await localFetch(`${baseUrl.trim().replace(/\/+$/, '')}/api/tags`, { headers, signal });
      if (!resp.ok) throw new Error(`Ollama ${resp.status}`);
      return await resp.json();
    });
  },

  async pathExists(path) {
    if (!isTauri()) return false;
    return await invoke<boolean>('path_exists', { path });
  },

  async pickDirectory() {
    if (!isTauri()) return null;
    return await invoke<string | null>('pick_directory');
  },

  async pickFile() {
    if (!isTauri()) return null;
    return await invoke<string | null>('pick_file');
  },

  async getCandidatePaths() {
    if (!isTauri()) return null;
    return await invoke<RuntimeCandidatePaths>('runtime_candidate_paths');
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

function ensureTauri(action: string): void {
  if (!isTauri()) {
    throw new Error(`Cannot ${action} outside the GatesAI desktop app.`);
  }
}

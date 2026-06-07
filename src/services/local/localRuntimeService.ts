// Manages local-runtime discovery, process control, or persistence for localRuntimeService.
// Called by LocalRuntimeStore and menu controls; depends on bridge/system APIs and runtime ids.
// Invariant: runtime state is stored separately from detection/probe side effects.
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '../../core/runtime';

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
  probeHttp(url: string): Promise<void>;
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
    if (!isTauri()) {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status} from ${url}`);
      return;
    }
    await invoke('probe_http', { url });
  },

  async fetchOllamaTags(baseUrl, apiKey) {
    if (!isTauri()) {
      const headers: Record<string, string> = {};
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const resp = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/tags`, { headers });
      if (!resp.ok) throw new Error(`Ollama ${resp.status}`);
      return await resp.json();
    }
    return await invoke('ollama_tags', { baseUrl, apiKey });
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

function ensureTauri(action: string): void {
  if (!isTauri()) {
    throw new Error(`Cannot ${action} outside the GatesAI desktop app.`);
  }
}

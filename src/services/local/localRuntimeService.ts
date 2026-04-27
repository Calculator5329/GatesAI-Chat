import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '../system/openExternal';

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

import type { Model } from '../core/types';

const KEY = 'gatesai.ollama.v1';

export interface OllamaPersistedConfig {
  apiKey?: string;
  toolsEnabled: boolean;
  catalog: Model[];
  lastRefreshAt: number | null;
}

export const OLLAMA_DEFAULTS: OllamaPersistedConfig = {
  apiKey: undefined,
  toolsEnabled: true,
  catalog: [],
  lastRefreshAt: null,
};

export function loadOllamaConfig(): OllamaPersistedConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...OLLAMA_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<OllamaPersistedConfig>;
    return { ...OLLAMA_DEFAULTS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch {
    return { ...OLLAMA_DEFAULTS };
  }
}

export function saveOllamaConfig(c: OllamaPersistedConfig): void {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* ignore */ }
}

export function clearOllamaConfig(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

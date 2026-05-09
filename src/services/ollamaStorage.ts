import type { Model } from '../core/types';
import { jsonSlot } from './storage/jsonSlot';

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

const slot = jsonSlot<OllamaPersistedConfig>('gatesai.ollama.v1', raw => {
  const r = raw && typeof raw === 'object' ? raw : {};
  return { ...OLLAMA_DEFAULTS, ...r };
});

export const loadOllamaConfig = slot.load;
export const saveOllamaConfig = slot.save;
export const clearOllamaConfig = slot.clear;

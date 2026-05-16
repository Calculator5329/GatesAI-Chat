import { jsonSlot } from './storage/jsonSlot';

export interface SearchPersistedConfig {
  brave?: {
    apiKey?: string;
  };
}

export const searchPersistence = jsonSlot<SearchPersistedConfig>('gatesai.search.v1', raw => {
  if (!raw || typeof raw !== 'object') return {};
  const brave = (raw as Record<string, unknown>).brave;
  if (!brave || typeof brave !== 'object') return {};
  const apiKey = (brave as Record<string, unknown>).apiKey;
  return typeof apiKey === 'string' && apiKey.trim()
    ? { brave: { apiKey: apiKey.trim() } }
    : {};
});

export const loadSearchConfig = searchPersistence.load;
export const saveSearchConfig = searchPersistence.save;


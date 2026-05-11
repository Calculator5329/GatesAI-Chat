import type { Model } from '../core/types';
import { jsonSlot } from './storage/jsonSlot';

export interface OpenRouterCacheSnapshot {
  fetchedAt: number;
  models: Model[];
}

export const openRouterCachePersistence = jsonSlot<OpenRouterCacheSnapshot | null>('gatesai.openrouter.catalog.v1', raw => {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<OpenRouterCacheSnapshot>;
  if (typeof r.fetchedAt !== 'number' || !Array.isArray(r.models)) return null;
  return { fetchedAt: r.fetchedAt, models: r.models };
});

export const loadOpenRouterCache = openRouterCachePersistence.load;
export const saveOpenRouterCache = openRouterCachePersistence.save;
export const clearOpenRouterCache = openRouterCachePersistence.clear;

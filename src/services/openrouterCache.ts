import type { Model } from '../core/types';

const KEY = 'gatesai.openrouter.catalog.v1';

export interface OpenRouterCacheSnapshot {
  fetchedAt: number;
  models: Model[];
}

export function loadOpenRouterCache(): OpenRouterCacheSnapshot | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OpenRouterCacheSnapshot>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.fetchedAt !== 'number' || !Array.isArray(parsed.models)) return null;
    return { fetchedAt: parsed.fetchedAt, models: parsed.models };
  } catch {
    return null;
  }
}

export function saveOpenRouterCache(snap: OpenRouterCacheSnapshot): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(snap));
  } catch {
    // ignore quota / privacy-mode failures
  }
}

export function clearOpenRouterCache(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

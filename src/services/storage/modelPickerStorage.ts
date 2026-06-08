// Persistence for model-picker UI preferences (source filter + recently used
// models). Lives in the storage service layer so UI reaches it through a store
// facade instead of touching localStorage directly.
import type { ModelPickerSource } from '../../core/modelPickerAvailability';
import { logger } from '../diagnostics/logger';

export type { ModelPickerSource };

const SOURCE_KEY = 'gatesai.modelPicker.source.v1';
const RECENT_KEY = 'gatesai.modelPicker.recent.v1';
const FAVORITES_KEY = 'gatesai.modelPicker.favorites.v1';
const MAX_RECENT_MODELS = 6;

export function loadModelPickerSource(): ModelPickerSource {
  try {
    const raw = localStorage.getItem(SOURCE_KEY);
    if (raw === 'auto' || raw === 'cloud' || raw === 'local' || raw === 'image') return raw;
  } catch (err) {
    logger.warn('persistence', 'Model picker preference load failed', { key: SOURCE_KEY, err });
  }
  return 'auto';
}

export function saveModelPickerSource(next: ModelPickerSource): void {
  try {
    localStorage.setItem(SOURCE_KEY, next);
  } catch (err) {
    logger.warn('persistence', 'Model picker preference save failed', { key: SOURCE_KEY, err });
  }
}

export function loadRecentModelIds(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    if (Array.isArray(parsed)) {
      return parsed.filter((id): id is string => typeof id === 'string').slice(0, MAX_RECENT_MODELS);
    }
  } catch (err) {
    logger.warn('persistence', 'Model picker preference load failed', { key: RECENT_KEY, err });
  }
  return [];
}

/** Move `modelId` to the front of the recents list and persist; returns the new list. */
export function pushRecentModelId(modelId: string): string[] {
  const next = [modelId, ...loadRecentModelIds().filter(id => id !== modelId)].slice(0, MAX_RECENT_MODELS);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch (err) {
    logger.warn('persistence', 'Model picker preference save failed', { key: RECENT_KEY, err });
  }
  return next;
}

/** User-pinned favorite model ids, in the order they were starred (oldest first). */
export function loadFavoriteModelIds(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
    if (Array.isArray(parsed)) {
      return parsed.filter((id): id is string => typeof id === 'string');
    }
  } catch (err) {
    logger.warn('persistence', 'Model picker preference load failed', { key: FAVORITES_KEY, err });
  }
  return [];
}

/** Toggle `modelId` in the favorites list and persist; returns the new list. */
export function toggleFavoriteModelId(modelId: string): string[] {
  const current = loadFavoriteModelIds();
  const next = current.includes(modelId)
    ? current.filter(id => id !== modelId)
    : [...current, modelId];
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
  } catch (err) {
    logger.warn('persistence', 'Model picker preference save failed', { key: FAVORITES_KEY, err });
  }
  return next;
}

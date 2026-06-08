// Persistence for model-picker UI preferences (source filter + recently used
// models). Lives in the storage service layer so UI reaches it through a store
// facade instead of touching localStorage directly.
export type ModelPickerSource = 'auto' | 'cloud' | 'local' | 'image';

const SOURCE_KEY = 'gatesai.modelPicker.source.v1';
const RECENT_KEY = 'gatesai.modelPicker.recent.v1';
const FAVORITES_KEY = 'gatesai.modelPicker.favorites.v1';
const MAX_RECENT_MODELS = 6;

export function loadModelPickerSource(): ModelPickerSource {
  try {
    const raw = localStorage.getItem(SOURCE_KEY);
    if (raw === 'auto' || raw === 'cloud' || raw === 'local' || raw === 'image') return raw;
  } catch { /* ignore */ }
  return 'auto';
}

export function saveModelPickerSource(next: ModelPickerSource): void {
  try {
    localStorage.setItem(SOURCE_KEY, next);
  } catch { /* ignore */ }
}

export function loadRecentModelIds(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    if (Array.isArray(parsed)) {
      return parsed.filter((id): id is string => typeof id === 'string').slice(0, MAX_RECENT_MODELS);
    }
  } catch { /* ignore */ }
  return [];
}

/** Move `modelId` to the front of the recents list and persist; returns the new list. */
export function pushRecentModelId(modelId: string): string[] {
  const next = [modelId, ...loadRecentModelIds().filter(id => id !== modelId)].slice(0, MAX_RECENT_MODELS);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* ignore */ }
  return next;
}

/** User-pinned favorite model ids, in the order they were starred (oldest first). */
export function loadFavoriteModelIds(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
    if (Array.isArray(parsed)) {
      return parsed.filter((id): id is string => typeof id === 'string');
    }
  } catch { /* ignore */ }
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
  } catch { /* ignore */ }
  return next;
}

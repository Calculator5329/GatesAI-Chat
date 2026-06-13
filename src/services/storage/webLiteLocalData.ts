// Provides storage adapter behavior for webLiteLocalData.
// Called by persistence-facing services and stores; depends on slot names and browser/local bridge availability.
// Invariant: callers see parsed snapshots while corrupt/missing data falls back safely.
// Web Lite clear removes all non-credential slots then reloads the page so in-memory stores reset.
import { logger } from '../diagnostics/logger';
export interface LocalDataSlot {
  key: string;
  label: string;
  credential?: boolean;
}

export interface LocalDataSlotUsage extends LocalDataSlot {
  bytes: number;
  present: boolean;
}

export const LOCAL_DATA_SLOTS: LocalDataSlot[] = [
  { key: 'gatesai.state.v1', label: 'Conversations' },
  { key: 'gatesai.profile.v1', label: 'Memories and system prompt' },
  { key: 'gatesai.notes.v1', label: 'Notes' },
  { key: 'gatesai.uiprefs.v1', label: 'UI preferences' },
  { key: 'gatesai.openrouter.catalog.v1', label: 'OpenRouter model catalog' },
  { key: 'gatesai.ollama.v1', label: 'Ollama settings' },
  { key: 'gatesai.imagegen.v1', label: 'Image generation settings' },
  { key: 'gatesai.imagejobs.v1', label: 'Image job history' },
  { key: 'gatesai.local.v1', label: 'Local runtime settings' },
  { key: 'gatesai.modelPicker.source.v1', label: 'Model picker source' },
  { key: 'gatesai.modelPicker.recent.v1', label: 'Recent models' },
  { key: 'gatesai.modelPicker.favorites.v1', label: 'Favorite models' },
  { key: 'gatesai.userGuide.opened.v1', label: 'Guide opened flag' },
  { key: 'gatesai.menuHintSeen.v1', label: 'Menu hint seen flag' },
  { key: 'gatesai.providers.v1', label: 'Provider API keys', credential: true },
  { key: 'gatesai.search.v1', label: 'Web search API key', credential: true },
];

/** Matches quarantined snapshots like `gatesai.state.v1.corrupt-1717…`. */
const CORRUPT_KEY_PATTERN = /^gatesai\..*\.corrupt-\d+$/;

function corruptSnapshotKeys(): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && CORRUPT_KEY_PATTERN.test(key)) keys.push(key);
    }
  } catch (err) {
    logger.warn('persistence', 'Web Lite localStorage key scan failed', { err });
  }
  return keys;
}

export function readLocalDataUsage(): LocalDataSlotUsage[] {
  return LOCAL_DATA_SLOTS.map(slot => {
    const value = safeGet(slot.key);
    return {
      ...slot,
      present: value !== null,
      bytes: value ? new Blob([value]).size : 0,
    };
  });
}

export function clearLocalDataExceptCredentials(): void {
  const keys = [
    ...LOCAL_DATA_SLOTS.filter(slot => !slot.credential).map(slot => slot.key),
    ...corruptSnapshotKeys(),
  ];
  for (const key of keys) {
    try {
      localStorage.removeItem(key);
    } catch (err) {
      logger.warn('persistence', 'Web Lite localStorage clear failed', { key, err });
    }
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (err) {
    logger.warn('persistence', 'Web Lite localStorage read failed', { key, err });
    return null;
  }
}


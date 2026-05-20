// Provides storage adapter behavior for webLiteLocalData.
// Called by persistence-facing services and stores; depends on slot names and browser/local bridge availability.
// Invariant: callers see parsed snapshots while corrupt/missing data falls back safely.
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
  { key: 'gatesai.userGuide.opened.v1', label: 'Guide opened flag' },
  { key: 'gatesai.providers.v1', label: 'Provider API keys', credential: true },
];

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
  for (const slot of LOCAL_DATA_SLOTS) {
    if (slot.credential) continue;
    try {
      localStorage.removeItem(slot.key);
    } catch {
      // Ignore storage errors in private/quota-restricted browsers.
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
  } catch {
    return null;
  }
}


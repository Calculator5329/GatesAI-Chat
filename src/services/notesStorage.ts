import type { NotesSnapshot } from '../core/notes';

const STORAGE_KEY = 'gatesai.notes.v1';

export function loadNotes(): NotesSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NotesSnapshot;
    if (!parsed || !Array.isArray(parsed.notes)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveNotes(snapshot: NotesSnapshot): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // ignore (quota / private mode)
  }
}

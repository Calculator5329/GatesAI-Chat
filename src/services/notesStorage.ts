import type { NotesSnapshot } from '../core/notes';
import { jsonSlot } from './storage/jsonSlot';

export const notesPersistence = jsonSlot<NotesSnapshot | null>('gatesai.notes.v1', raw => {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<NotesSnapshot>;
  if (!Array.isArray(r.notes)) return null;
  return r as NotesSnapshot;
});

export const loadNotes = notesPersistence.load;
export const saveNotes = notesPersistence.save;

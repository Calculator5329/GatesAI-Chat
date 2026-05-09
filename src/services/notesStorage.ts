import type { NotesSnapshot } from '../core/notes';
import { jsonSlot } from './storage/jsonSlot';

const slot = jsonSlot<NotesSnapshot | null>('gatesai.notes.v1', raw => {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<NotesSnapshot>;
  if (!Array.isArray(r.notes)) return null;
  return r as NotesSnapshot;
});

export const loadNotes = slot.load;
export const saveNotes = slot.save;

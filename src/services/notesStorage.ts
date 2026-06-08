import type { NotesSnapshot } from '../core/notes';
import { logger } from './diagnostics/logger';
import { browserLocalStorage, type KeyValuePersistence } from './storage/persistenceProvider';

// Notes persistence with quarantine parity to chat snapshots: corrupt
// `gatesai.notes.v1` is moved to `gatesai.notes.v1.corrupt-<timestamp>` and
// surfaced via `consumeNotesLoadError()` on boot.
const NOTES_KEY = 'gatesai.notes.v1';
const CORRUPT_NOTES_KEY_PREFIX = `${NOTES_KEY}.corrupt`;

let notesLoadError: string | null = null;

export function consumeNotesLoadError(): string | null {
  const message = notesLoadError;
  notesLoadError = null;
  return message;
}

function parseNotesShape(value: unknown): NotesSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Partial<NotesSnapshot>;
  if (!Array.isArray(r.notes)) return null;
  return r as NotesSnapshot;
}

function quarantineUnreadableNotes(storage: KeyValuePersistence, raw: string, reason: string): void {
  notesLoadError = `${reason} A recovery copy was saved in localStorage.`;
  try {
    storage.setItem(`${CORRUPT_NOTES_KEY_PREFIX}-${Date.now()}`, raw);
  } catch (err) {
    logger.error('persistence', 'failed to save corrupt notes recovery copy', err);
    notesLoadError = `${reason} A recovery copy could not be saved: ${(err as Error).message}`;
  }
}

export function createNotesPersistenceProvider(
  storage: KeyValuePersistence = browserLocalStorage(),
) {
  return {
    load(): NotesSnapshot | null {
      notesLoadError = null;
      let raw: string | null = null;
      try {
        raw = storage.getItem(NOTES_KEY);
        if (!raw) return null;
        const parsed = parseNotesShape(JSON.parse(raw));
        if (!parsed) {
          const reason = 'Saved notes had an invalid shape.';
          logger.warn('persistence', 'quarantined corrupt notes snapshot', { reason });
          quarantineUnreadableNotes(storage, raw, reason);
          return null;
        }
        return parsed;
      } catch (err) {
        if (raw) {
          const reason = `Saved notes were unreadable: ${(err as Error).message}`;
          logger.warn('persistence', 'quarantined unreadable notes snapshot', { reason });
          quarantineUnreadableNotes(storage, raw, reason);
        }
        return null;
      }
    },
    save(value: NotesSnapshot | null): void {
      try {
        if (!value) {
          storage.removeItem(NOTES_KEY);
          return;
        }
        storage.setItem(NOTES_KEY, JSON.stringify(value));
      } catch (err) {
        logger.warn('persistence', 'localStorage save failed', { key: NOTES_KEY, err });
      }
    },
    clear(): void {
      try {
        storage.removeItem(NOTES_KEY);
      } catch (err) {
        logger.warn('persistence', 'localStorage clear failed', { key: NOTES_KEY, err });
      }
    },
  };
}

export const notesPersistence = createNotesPersistenceProvider();

export const loadNotes = notesPersistence.load;
export const saveNotes = notesPersistence.save;

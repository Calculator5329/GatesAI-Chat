/**
 * A long-form note. The companion to `bio` facts:
 *   - facts (memory)  → atomic, durable claims about the user
 *   - notes           → titled documents the user wants to keep
 *
 * Stored separately so the model can search and read documents without
 * polluting its system prompt every turn (only facts go there).
 */
export interface Note {
  id: string;
  title: string;
  body: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

/** Per-note body cap to avoid silent localStorage exhaustion. */
export const MAX_NOTE_BODY_CHARS = 32_000;
export const MAX_NOTE_TITLE_CHARS = 200;

export interface NotesSnapshot {
  notes: Note[];
}

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

export interface NotesSnapshot {
  notes: Note[];
}

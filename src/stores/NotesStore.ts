// Owns observable NotesStore state and actions for the app runtime.
// Called by RootStore, React context hooks, and service callbacks; depends on services/core contracts.
// Invariant: mutations happen through store actions so UI derivations stay consistent.
import { autorun, makeAutoObservable, toJS } from 'mobx';
import type { Note, NotesSnapshot } from '../core/notes';
import { MAX_NOTE_BODY_CHARS, MAX_NOTE_TITLE_CHARS } from '../core/notes';
import { consumeNotesLoadError, loadNotes, saveNotes } from '../services/notesStorage';

function newId(): string {
  return `n-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Long-form notes the model can read and write on the user's behalf.
 *
 * Distinct from `UserProfileStore` (which stores atomic facts injected
 * into every system prompt) — notes are searched on demand by the
 * `notes` tool. This keeps the system prompt small while letting the
 * model retain arbitrary amounts of project context, meeting summaries,
 * and reference material.
 *
 * Persisted to its own localStorage key (`gatesai.notes.v1`) so a notes
 * dump doesn't bloat the chat snapshot, and so future migration to
 * IndexedDB only touches one file. Body/title length is capped at
 * `MAX_NOTE_*`; corrupt snapshots are quarantined like chat state.
 */
export class NotesStore {
  notes: Note[] = [];
  loadError: string | null = null;

  constructor() {
    const snap = loadNotes();
    if (snap) this.notes = snap.notes;
    this.loadError = consumeNotesLoadError();
    makeAutoObservable(this);
    autorun(() => saveNotes(toJS({ notes: this.notes })));
  }

  get snapshot(): NotesSnapshot {
    return { notes: this.notes };
  }

  /** Most-recently-updated first. */
  get sortedByRecency(): Note[] {
    return [...this.notes].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  findById(id: string): Note | null {
    return this.notes.find(n => n.id === id) ?? null;
  }

  /**
   * Substring-match across title, body, and tags. Case-insensitive.
   * Returns recency-sorted results.
   */
  search(query: string): Note[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hit = (n: Note): boolean =>
      n.title.toLowerCase().includes(q) ||
      n.body.toLowerCase().includes(q) ||
      (n.tags ?? []).some(t => t.toLowerCase().includes(q));
    return this.sortedByRecency.filter(hit);
  }

  create(input: { title: string; body: string; tags?: string[] }): Note {
    const title = input.title.trim().slice(0, MAX_NOTE_TITLE_CHARS) || 'Untitled';
    const body = input.body.slice(0, MAX_NOTE_BODY_CHARS);
    const now = Date.now();
    const note: Note = {
      id: newId(),
      title,
      body,
      tags: input.tags && input.tags.length > 0 ? [...input.tags] : undefined,
      createdAt: now,
      updatedAt: now,
    };
    this.notes.unshift(note);
    return note;
  }

  /**
   * Patch any subset of mutable fields. Returns the updated note, or null
   * if the id doesn't exist. `updatedAt` is bumped on any change.
   */
  update(id: string, patch: { title?: string; body?: string; tags?: string[] }): Note | null {
    const note = this.findById(id);
    if (!note) return null;
    if (patch.title !== undefined) {
      note.title = patch.title.trim().slice(0, MAX_NOTE_TITLE_CHARS) || 'Untitled';
    }
    if (patch.body !== undefined) note.body = patch.body.slice(0, MAX_NOTE_BODY_CHARS);
    if (patch.tags !== undefined) note.tags = patch.tags.length > 0 ? [...patch.tags] : undefined;
    note.updatedAt = Date.now();
    return note;
  }

  remove(id: string): Note | null {
    const idx = this.notes.findIndex(n => n.id === id);
    if (idx === -1) return null;
    const [removed] = this.notes.splice(idx, 1);
    return removed;
  }

  clear(): void {
    this.notes = [];
  }
}

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_NOTE_BODY_CHARS, MAX_NOTE_TITLE_CHARS } from '../../src/core/notes';
import { NotesStore } from '../../src/stores/NotesStore';
import { clearAppStorage } from '../helpers/storage';

describe('NotesStore', () => {
  beforeEach(() => clearAppStorage());
  afterEach(() => clearAppStorage());

  it('quarantines corrupt notes and preserves a recovery copy instead of wiping silently', () => {
    localStorage.setItem('gatesai.notes.v1', '{not-json');
    const store = new NotesStore();
    expect(store.notes).toEqual([]);
    expect(store.loadError).toMatch(/recovery copy/i);
    const recoveryKey = Object.keys(localStorage).find(key => key.startsWith('gatesai.notes.v1.corrupt-'));
    expect(recoveryKey).toBeDefined();
    expect(localStorage.getItem(recoveryKey!)).toBe('{not-json');
  });

  it('still loads healthy notes when storage is valid', () => {
    localStorage.setItem('gatesai.notes.v1', JSON.stringify({
      notes: [{
        id: 'n1',
        title: 'Saved note',
        body: 'Body',
        createdAt: 1,
        updatedAt: 1,
      }],
    }));
    const store = new NotesStore();
    expect(store.notes).toHaveLength(1);
    expect(store.notes[0].title).toBe('Saved note');
    expect(store.loadError).toBeNull();
  });

  it('truncates oversized titles and bodies on create and update (Batch E)', () => {
    const store = new NotesStore();
    const longTitle = 'T'.repeat(MAX_NOTE_TITLE_CHARS + 50);
    const longBody = 'B'.repeat(MAX_NOTE_BODY_CHARS + 1000);

    const created = store.create({ title: longTitle, body: longBody });
    expect(created.title.length).toBe(MAX_NOTE_TITLE_CHARS);
    expect(created.body.length).toBe(MAX_NOTE_BODY_CHARS);

    const updated = store.update(created.id, { title: longTitle, body: longBody });
    expect(updated?.title.length).toBe(MAX_NOTE_TITLE_CHARS);
    expect(updated?.body.length).toBe(MAX_NOTE_BODY_CHARS);
  });

  it('round-trips notes through localStorage', () => {
    const store = new NotesStore();
    store.create({ title: 'Title', body: 'Body', tags: ['tag'] });
    const store2 = new NotesStore();
    expect(store2.notes).toHaveLength(1);
    expect(store2.notes[0].title).toBe('Title');
  });
});

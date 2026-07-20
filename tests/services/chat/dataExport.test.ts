import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatSnapshot } from '../../../src/core/types';
import { DEFAULT_UI_PREFS } from '../../../src/services/uiPrefsStorage';
import { flushPendingSnapshot } from '../../../src/services/persistence';
import {
  createDataExportEnvelope,
  importDataFromJson,
  serializeDataExport,
} from '../../../src/services/chat/dataExport';
import { RootStore } from '../../../src/stores/RootStore';
import { clearAppStorage } from '../../helpers/storage';

let roots: RootStore[] = [];

function makeRoot(): RootStore {
  const root = new RootStore();
  roots.push(root);
  return root;
}

function releaseRoot(root: RootStore): void {
  root.dispose();
  roots = roots.filter(item => item !== root);
}

describe('chat data export/import', () => {
  beforeEach(() => {
    flushPendingSnapshot();
    clearAppStorage();
    roots = [];
  });

  afterEach(() => {
    while (roots.length > 0) roots.pop()?.dispose();
    flushPendingSnapshot();
    clearAppStorage();
  });

  it('round-trips exported data into an empty app state', () => {
    const source = makeRoot();
    seedRoot(source);
    const raw = serializeDataExport(source, new Date('2026-07-02T12:00:00.000Z'));
    releaseRoot(source);
    flushPendingSnapshot();
    clearAppStorage();

    const target = makeRoot();
    const result = importDataFromJson(target, raw, 'replace');
    flushPendingSnapshot();

    expect(result).toMatchObject({ threadsImported: 2, threadsSkipped: 0 });
    expect(target.chat.threads.map(thread => thread.title)).toEqual(['Alpha project', 'Beta notes']);
    expect(target.chat.threads.map(thread => thread.messages.length)).toEqual([2, 1]);
    expect(target.chat.threads[0].summary).toBe('Alpha summary');
    expect(target.profile.facts).toEqual(['Likes TypeScript', 'Uses GatesAI']);
    expect(target.profile.defaultSystemPrompt).toBe('Be concise.');
    expect(target.notes.notes.map(note => note.title)).toEqual(['Planning note', 'Research note']);
    expect(target.library.sources.map(source => source.path)).toEqual(['/workspace/notes/reference.md']);
    expect(target.ui.theme).toBe('light');

    const persisted = JSON.parse(localStorage.getItem('gatesai.state.v1') ?? '{}') as ChatSnapshot;
    expect(persisted.threads.map(thread => thread.title)).toEqual(['Alpha project', 'Beta notes']);
  });

  it('merges threads by id and skips duplicate memory and note content', () => {
    const source = makeRoot();
    seedRoot(source, {
      bio: '· Shared memory\n· New memory',
      notesBodies: ['duplicate body', 'new body'],
    });
    const raw = serializeDataExport(source);
    releaseRoot(source);
    flushPendingSnapshot();
    clearAppStorage();

    const target = makeRoot();
    target.chat.applyImportedSnapshot({
      activeThreadId: 't-existing',
      threads: [
        {
          id: 't-alpha',
          title: 'Existing alpha wins',
          subtitle: '',
          createdAt: 10,
          updatedAt: 10,
          pinned: false,
          modelId: 'or-gpt-5.4-mini',
          messages: [],
        },
        {
          id: 't-existing',
          title: 'Existing only',
          subtitle: '',
          createdAt: 11,
          updatedAt: 11,
          pinned: false,
          modelId: 'or-gpt-5.4-mini',
          messages: [],
        },
      ],
    });
    target.profile.applyImportedProfile({
      bio: '· Existing memory\n· Shared memory',
      defaultSystemPrompt: 'Old prompt.',
    });
    target.notes.applyImportedNotes({
      notes: [{
        id: 'n-existing',
        title: 'Existing note',
        body: 'duplicate body',
        createdAt: 1,
        updatedAt: 1,
      }],
    });
    target.library.applyImportedSnapshot({ sources: [{
      id: 'existing-reference',
      path: '/workspace/notes/reference.md',
      title: 'Existing reference',
      kind: 'document',
      enabled: true,
      addedAt: 1,
    }] });

    const result = importDataFromJson(target, raw, 'merge');

    expect(result).toMatchObject({
      threadsImported: 1,
      threadsSkipped: 1,
      memoriesImported: 1,
      memoriesSkipped: 1,
      notesImported: 1,
      notesSkipped: 1,
      librarySourcesImported: 0,
      librarySourcesSkipped: 1,
    });
    expect(target.chat.threads.map(thread => thread.title)).toEqual([
      'Existing alpha wins',
      'Existing only',
      'Beta notes',
    ]);
    expect(target.profile.facts).toEqual(['Existing memory', 'Shared memory', 'New memory']);
    expect(target.profile.defaultSystemPrompt).toBe('Be concise.');
    expect(target.notes.notes.map(note => note.body)).toEqual(['duplicate body', 'new body']);
  });

  it.each([
    ['wrong format', (raw: string) => JSON.stringify({ ...JSON.parse(raw), format: 'wrong' }), /Unsupported export format/],
    ['wrong version', (raw: string) => JSON.stringify({ ...JSON.parse(raw), formatVersion: 99 }), /Unsupported export version/],
    ['malformed JSON', () => '{not-json', /malformed JSON/],
  ])('rejects %s with a readable error and leaves state untouched', (_label, mutate, errorPattern) => {
    const root = makeRoot();
    seedRoot(root);
    const valid = serializeDataExport(root);
    const before = captureState(root);

    expect(() => importDataFromJson(root, mutate(valid), 'replace')).toThrow(errorPattern);
    expect(captureState(root)).toBe(before);
  });

  it('excludes provider and search secrets from exported blobs', () => {
    const root = makeRoot();
    root.providers.setKey('openrouter', 'sk-openrouter-secret');
    root.search.setBraveKey('brave-secret');
    root.ollama.setKey('ollama-secret');

    const raw = serializeDataExport(root);

    expect(raw).not.toContain('sk-openrouter-secret');
    expect(raw).not.toContain('brave-secret');
    expect(raw).not.toContain('ollama-secret');
    expect(raw).not.toMatch(/"apiKey"|"apiKeys"|"openRouterApiKey"|"openrouterApiKey"/);
    // First-run state includes the bundled welcome tour alongside the fresh
    // writable thread; both are ordinary persisted/exported threads.
    expect(createDataExportEnvelope(root).data.threads).toHaveLength(2);
  });

  it('preserves Offline Library citations through export, import, and persistence', () => {
    const citations = [
      'kiwix://archlinux/pacman-hooks',
      'library://books/handbook/chapter-2',
      'man:pacman.8',
      'db://public/schema',
    ];
    const source = makeRoot();
    source.chat.applyImportedSnapshot({
      activeThreadId: 't-library',
      threads: [{
        id: 't-library',
        title: 'Offline research',
        subtitle: '',
        createdAt: 1,
        updatedAt: 2,
        pinned: false,
        modelId: 'ollama-phi4',
        messages: [{
          id: 'a-library',
          role: 'assistant',
          createdAt: 2,
          parts: [{
            type: 'tool',
            result: {
              toolCallId: 'library-search-1',
              toolName: 'library_search',
              content: JSON.stringify({ citations }),
              ok: true,
              ranAt: 2,
            },
          }, {
            type: 'text',
            text: citations.map(citation => `[source](${citation})`).join(' '),
          }],
        }],
      }],
    });
    const raw = serializeDataExport(source);
    releaseRoot(source);
    flushPendingSnapshot();
    clearAppStorage();

    for (const citation of citations) expect(raw).toContain(citation);

    const target = makeRoot();
    importDataFromJson(target, raw, 'replace');
    flushPendingSnapshot();

    const restored = JSON.stringify(target.chat.snapshot);
    const persisted = localStorage.getItem('gatesai.state.v1') ?? '';
    for (const citation of citations) {
      expect(restored).toContain(citation);
      expect(persisted).toContain(citation);
    }
  });
});

function seedRoot(
  root: RootStore,
  opts: { bio?: string; notesBodies?: [string, string] } = {},
): void {
  root.chat.applyImportedSnapshot(sampleSnapshot());
  root.profile.applyImportedProfile({
    bio: opts.bio ?? '· Likes TypeScript\n· Uses GatesAI',
    defaultSystemPrompt: 'Be concise.',
  });
  const noteBodies = opts.notesBodies ?? ['Plan the alpha release.', 'Collect beta research.'];
  root.notes.applyImportedNotes({
    notes: [
      {
        id: 'n-planning',
        title: 'Planning note',
        body: noteBodies[0],
        tags: ['planning'],
        createdAt: 100,
        updatedAt: 101,
      },
      {
        id: 'n-research',
        title: 'Research note',
        body: noteBodies[1],
        createdAt: 102,
        updatedAt: 103,
      },
    ],
  });
  root.library.applyImportedSnapshot({ sources: [{
    id: 'library-reference',
    path: '/workspace/notes/reference.md',
    title: 'Reference notes',
    kind: 'document',
    enabled: true,
    addedAt: 104,
  }] });
  root.ui.applyImportedPrefs({ ...DEFAULT_UI_PREFS, animationsEnabled: false, theme: 'light' });
}

function sampleSnapshot(): ChatSnapshot {
  return {
    activeThreadId: 't-alpha',
    threads: [
      {
        id: 't-alpha',
        title: 'Alpha project',
        subtitle: '',
        createdAt: 1,
        updatedAt: 3,
        pinned: false,
        modelId: 'or-gpt-5.4-mini',
        summary: 'Alpha summary',
        summaryUpdatedAt: 4,
        summaryMessageCount: 2,
        threadContext: 'Alpha thread context',
        messages: [
          { id: 'u-alpha', role: 'user', content: 'Hello alpha', createdAt: 1 },
          { id: 'a-alpha', role: 'assistant', content: 'Alpha reply', createdAt: 2 },
        ],
      },
      {
        id: 't-beta',
        title: 'Beta notes',
        subtitle: '',
        createdAt: 5,
        updatedAt: 6,
        pinned: false,
        modelId: 'or-gpt-5.4-mini',
        messages: [
          { id: 'u-beta', role: 'user', content: 'Hello beta', createdAt: 5 },
        ],
      },
    ],
  };
}

function captureState(root: RootStore): string {
  return JSON.stringify({
    chat: root.chat.snapshot,
    profile: root.profile.snapshot,
    notes: root.notes.snapshot,
    library: root.library.snapshot,
    ui: root.ui.prefsSnapshot,
  });
}

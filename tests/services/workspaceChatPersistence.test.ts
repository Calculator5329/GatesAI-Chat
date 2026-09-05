import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatSnapshot } from '../../src/core/types';
import type { BridgeClientFacade } from '../../src/services/tools/types';
import {
  createWorkspaceChatPersistence,
  WORKSPACE_CHAT_LIBRARY_INDEX_PATH,
  WORKSPACE_CHAT_STATE_PATH,
} from '../../src/services/workspaceChatPersistence';
import { assistantMessageParts, userMessageParts } from '../../src/core/messageParts';
import { CURRENT_CHAT_SCHEMA_VERSION } from '../../src/services/persistence/migrations';

describe('workspace chat persistence', () => {
  it('round-trips a workspace snapshot envelope', async () => {
    const bridge = memoryBridge();
    const persistence = createWorkspaceChatPersistence(bridge);
    const snapshot = sampleSnapshot('t1', 'Workspace state');

    await persistence.save(snapshot);
    const loaded = await persistence.load();

    expect(loaded.kind).toBe('loaded');
    if (loaded.kind !== 'loaded') throw new Error('expected loaded');
    expect(loaded.snapshot).toMatchObject(snapshot);
    expect(loaded.envelope).toMatchObject({
      version: 1,
      source: 'workspace',
    });
    expect(JSON.parse(bridge.files.get(WORKSPACE_CHAT_STATE_PATH) ?? '{}')).toHaveProperty('savedAt');
  });

  it('writes a readable HTML and Markdown chat library alongside the JSON snapshot', async () => {
    const bridge = memoryBridge();
    const persistence = createWorkspaceChatPersistence(bridge);
    const snapshot = sampleSnapshot('t1', 'Workspace state');
    const firstMessage = snapshot.threads[0].messages[0];
    if (firstMessage.role !== 'user') throw new Error('expected user message');
    snapshot.threads[0].messages[0] = {
      ...firstMessage,
      parts: userMessageParts('hello', [{
        path: '/workspace/attachments/sketch.png',
        name: 'sketch.png',
        mime: 'image/png',
        size: 2048,
      }]),
    };
    snapshot.threads[0].messages.push({
      id: 'm2',
      role: 'assistant',
      parts: assistantMessageParts({
        text: 'Generated an image.',
        toolResults: [{
          toolCallId: 'c1',
          toolName: 'image_generate',
          content: 'Saved /workspace/artifacts/images/local/render.png',
          ranAt: 5,
          artifacts: [{ kind: 'image', path: '/workspace/artifacts/images/local/render.png', mime: 'image/png' }],
        }],
      }),
      createdAt: 4,
    });

    await persistence.save(snapshot);

    const index = bridge.files.get(WORKSPACE_CHAT_LIBRARY_INDEX_PATH) ?? '';
    const html = bridge.files.get('/workspace/chat-history/conversations/workspace-state-t1.html') ?? '';
    const markdown = bridge.files.get('/workspace/chat-history/conversations/workspace-state-t1.md') ?? '';

    expect(index).toContain('Chat History');
    expect(index).toContain('Workspace state');
    expect(index).toContain('conversations/workspace-state-t1.html');
    expect(index).toContain('data-search=');
    expect(html).toContain('<h1>Workspace state</h1>');
    expect(html).toContain('Raw transcript');
    expect(html).toContain('#0 user m1');
    expect(html).toContain('Attachments');
    expect(html).toContain('../../attachments/sketch.png');
    expect(html).toContain('Generated files');
    expect(html).toContain('../../artifacts/images/local/render.png');
    expect(markdown).toContain('# Workspace state');
    expect(markdown).toContain('hello');
    expect(markdown).toContain('Attachments:');
    expect(markdown).toContain('/workspace/attachments/sketch.png');
    expect(markdown).toContain('Generated files:');
    expect(markdown).toContain('/workspace/artifacts/images/local/render.png');
  });

  it('omits deleted threads from the readable library', async () => {
    const bridge = memoryBridge();
    const snapshot = sampleSnapshot('t1', 'Visible thread');
    snapshot.threads.push({
      ...sampleSnapshot('t2', 'Deleted thread').threads[0],
      deletedAt: 4,
    });

    await createWorkspaceChatPersistence(bridge).save(snapshot);

    const index = bridge.files.get(WORKSPACE_CHAT_LIBRARY_INDEX_PATH) ?? '';
    expect(index).toContain('Visible thread');
    expect(index).not.toContain('Deleted thread');
    expect(bridge.files.has('/workspace/chat-history/conversations/deleted-thread-t2.html')).toBe(false);
  });

  it('migrates legacy snapshot shapes inside the envelope', async () => {
    const bridge = memoryBridge({
      [WORKSPACE_CHAT_STATE_PATH]: JSON.stringify({
        version: 1,
        savedAt: '2026-05-12T00:00:00.000Z',
        snapshot: {
          activeThreadId: 't1',
          threads: [{
            id: 't1',
            title: 'Legacy',
            subtitle: '',
            pinned: false,
            modelId: 'claude-sonnet-4.5',
            createdAt: 1,
            updatedAt: 2,
            messages: [],
          }],
        },
      }),
    });

    const loaded = await createWorkspaceChatPersistence(bridge).load();

    expect(loaded.kind).toBe('loaded');
    if (loaded.kind !== 'loaded') throw new Error('expected loaded');
    expect(loaded.snapshot.threads[0].modelId).toBe('or-nemotron-3-ultra-free');
  });

  it('reports missing state without writing over local fallback', async () => {
    const bridge = memoryBridge();
    const loaded = await createWorkspaceChatPersistence(bridge).load();

    expect(loaded).toEqual({ kind: 'missing' });
    expect(bridge.files.has(WORKSPACE_CHAT_STATE_PATH)).toBe(false);
  });

  it('fails closed on non-missing workspace read errors', async () => {
    const bridge = {
      async request<T = unknown>(op: string): Promise<T> {
        if (op === 'fs.mkdir') return {} as T;
        if (op === 'fs.read') throw new Error('read limited at 32769 bytes');
        throw new Error(`unexpected op ${op}`);
      },
    };

    await expect(createWorkspaceChatPersistence(bridge).load()).rejects.toThrow(/read limited/);
  });

  it('backs up malformed workspace JSON before replacement', async () => {
    const bridge = memoryBridge({ [WORKSPACE_CHAT_STATE_PATH]: '{not json' });
    const persistence = createWorkspaceChatPersistence(bridge);

    const loaded = await persistence.load();
    expect(loaded.kind).toBe('malformed');
    if (loaded.kind !== 'malformed') throw new Error('expected malformed');
    const backupPath = await persistence.backupMalformed(loaded.raw);
    await persistence.save(sampleSnapshot('fallback', 'Fallback'), 'localStorage-migration');

    expect(bridge.files.get(backupPath)).toBe('{not json');
    expect(JSON.parse(bridge.files.get(WORKSPACE_CHAT_STATE_PATH) ?? '{}')).toMatchObject({
      source: 'localStorage-migration',
    });
  });

  it('retains stale and unrecognized files while the index follows current conversations', async () => {
    const bridge = memoryBridge({
      '/workspace/chat-history/conversations/owner-notes.md': 'foreign owner draft',
      '/workspace/chat-history/conversations/custom-report.html': '<article>foreign report</article>',
      '/workspace/chat-history/conversations/old-title-t1.html': 'old html',
      '/workspace/chat-history/conversations/old-title-t1.md': 'old markdown',
      '/workspace/chat-history/conversations/deleted-thread-t2.html': 'deleted html',
      '/workspace/chat-history/conversations/deleted-thread-t2.md': 'deleted markdown',
    });
    const snapshot = sampleSnapshot('t1', 'New title');
    snapshot.threads.push({
      ...sampleSnapshot('t2', 'Deleted thread').threads[0],
      deletedAt: 4,
    });

    await createWorkspaceChatPersistence(bridge).save(snapshot);

    expect(bridge.files.get('/workspace/chat-history/conversations/old-title-t1.html')).toBe('old html');
    expect(bridge.files.get('/workspace/chat-history/conversations/old-title-t1.md')).toBe('old markdown');
    expect(bridge.files.get('/workspace/chat-history/conversations/deleted-thread-t2.html')).toBe('deleted html');
    expect(bridge.files.get('/workspace/chat-history/conversations/deleted-thread-t2.md')).toBe('deleted markdown');
    expect(bridge.files.has('/workspace/chat-history/conversations/new-title-t1.html')).toBe(true);
    expect(bridge.files.has('/workspace/chat-history/conversations/new-title-t1.md')).toBe(true);
    expect(bridge.files.get('/workspace/chat-history/conversations/owner-notes.md')).toBe('foreign owner draft');
    expect(bridge.files.get('/workspace/chat-history/conversations/custom-report.html')).toBe('<article>foreign report</article>');
    const index = bridge.files.get(WORKSPACE_CHAT_LIBRARY_INDEX_PATH) ?? '';
    expect(index).toContain('new-title-t1.html');
    expect(index).not.toContain('old-title-t1');
    expect(index).not.toContain('deleted-thread-t2');
    expect(index).not.toContain('owner-notes');

  });
});

describe('incremental readable library', () => {
  afterEach(() => vi.useRealTimers());
  it('skips unchanged pairs and rewrites an edit without updatedAt changing', async () => {
    const bridge = measuredBridge();
    const persistence = createWorkspaceChatPersistence(bridge);
    const snapshot = sampleSnapshot('t1', 'Visible thread');
    await persistence.save(snapshot);
    bridge.writes.length = 0;
    await persistence.save(snapshot);
    expect(bridge.writes.filter(path => path.includes('/conversations/'))).toEqual([]);
    snapshot.threads[0].messages[0].parts = [{ type: 'text', text: 'edited with same timestamp' }];
    await persistence.save(snapshot);
    expect(bridge.writes.filter(path => path.includes('/conversations/'))).toHaveLength(2);
  });
  it('preserves last-write behavior when thread names collide after path normalization', async () => {
    const bridge = measuredBridge();
    const persistence = createWorkspaceChatPersistence(bridge);
    const snapshot = sampleSnapshot('A', 'Same');
    snapshot.threads[0].messages[0].parts = [{ type: 'text', text: 'FIRST THREAD' }];
    const second = sampleSnapshot('a', 'Same').threads[0];
    second.messages[0].parts = [{ type: 'text', text: 'SECOND THREAD' }];
    snapshot.threads.push(second);
    await persistence.save(snapshot);
    const path = '/workspace/chat-history/conversations/same-a.md';
    expect(bridge.files.get(path)).toContain('SECOND THREAD');
    bridge.writes.length = 0;
    await persistence.save(snapshot);
    expect(bridge.files.get(path)).toContain('SECOND THREAD');
    expect(bridge.files.get(path)).not.toContain('FIRST THREAD');
    expect(conversationWrites(bridge)).toHaveLength(4);
  });

  it('keeps the pair write timestamp while refreshing the index and detects nested attachment changes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T10:00:00Z'));
    const bridge = measuredBridge();
    const persistence = createWorkspaceChatPersistence(bridge);
    const snapshot = sampleSnapshot('t1', 'Visible thread');
    await persistence.save(snapshot);
    const path = '/workspace/chat-history/conversations/visible-thread-t1.md';
    const original = bridge.files.get(path);
    vi.setSystemTime(new Date('2026-09-05T10:01:00Z'));
    await persistence.save(snapshot);
    expect(bridge.files.get(path)).toBe(original);
    expect(bridge.files.get(WORKSPACE_CHAT_LIBRARY_INDEX_PATH)).toContain('2026-09-05T10:01:00.000Z');
    snapshot.threads[0].messages[0].parts = userMessageParts('hello', [{
      name: 'notes.txt', mime: 'text/plain', size: 10, path: '/workspace/attachments/notes.txt',
    }]);
    bridge.writes.length = 0;
    await persistence.save(snapshot);
    expect(conversationWrites(bridge)).toHaveLength(2);
    expect(bridge.files.get(path)).toContain('2026-09-05T10:01:00.000Z');
    expect(bridge.files.get(path)).toContain('notes.txt');
    bridge.writes.length = 0;
    vi.setSystemTime(new Date('2026-09-06T10:01:00Z'));
    await persistence.save(snapshot);
    expect(conversationWrites(bridge)).toHaveLength(2);
  });

  it('detects nested tool result edits and does not claim integrity of external edits', async () => {
    const bridge = measuredBridge();
    const persistence = createWorkspaceChatPersistence(bridge);
    const snapshot = sampleSnapshot('t1', 'Visible thread');
    snapshot.threads[0].messages.push({
      id: 'm2', role: 'assistant', createdAt: 4,
      parts: assistantMessageParts({ text: 'Generated', toolResults: [{
        toolCallId: 'c1', toolName: 'generate', content: 'before', ranAt: 5,
        artifacts: [{ kind: 'image', path: '/workspace/artifacts/before.png', mime: 'image/png' }],
      }] }),
    });
    await persistence.save(snapshot);
    const path = '/workspace/chat-history/conversations/visible-thread-t1.md';
    bridge.files.set(path, 'external edit');
    bridge.writes.length = 0;
    await persistence.save(snapshot);
    expect(conversationWrites(bridge)).toHaveLength(0);
    expect(bridge.files.get(path)).toBe('external edit');
    const result = snapshot.threads[0].messages[1].parts?.find(part => part.type === 'tool');
    if (!result || result.type !== 'tool' || !result.result) throw new Error('expected tool result');
    result.result.content = 'after';
    await persistence.save(snapshot);
    expect(conversationWrites(bridge)).toHaveLength(2);
    expect(bridge.files.get(path)).toContain('after');
  });

  it('refreshes missing pairs, connection changes, and new workspace instances', async () => {
    const bridge = measuredBridge();
    const persistence = createWorkspaceChatPersistence(bridge);
    const snapshot = sampleSnapshot('t1', 'Visible thread');
    await persistence.save(snapshot);
    bridge.files.delete('/workspace/chat-history/conversations/visible-thread-t1.md');
    bridge.writes.length = 0;
    await persistence.save(snapshot);
    expect(conversationWrites(bridge)).toHaveLength(2);
    bridge.connectionEpoch++;
    bridge.writes.length = 0;
    await persistence.save(snapshot);
    expect(conversationWrites(bridge)).toHaveLength(2);
    bridge.writes.length = 0;
    await createWorkspaceChatPersistence(bridge).save(snapshot);
    expect(conversationWrites(bridge)).toHaveLength(2);
  });

  it.each(['failed', 'truncated', 'malformed'] as const)('does not promote cache after a %s listing', async mode => {
    const bridge = measuredBridge();
    const persistence = createWorkspaceChatPersistence(bridge);
    const snapshot = sampleSnapshot('t1', 'Visible thread');
    await persistence.save(snapshot);
    bridge.listingMode = mode;
    bridge.writes.length = 0;
    await persistence.save(snapshot);
    expect(conversationWrites(bridge)).toHaveLength(2);
    bridge.listingMode = 'complete';
    bridge.writes.length = 0;
    await persistence.save(snapshot);
    expect(conversationWrites(bridge)).toHaveLength(2);
    bridge.writes.length = 0;
    await persistence.save(snapshot);
    expect(conversationWrites(bridge)).toHaveLength(0);
  });

  it('clears all entries after partial writes and never promotes across an epoch change', async () => {
    const bridge = measuredBridge();
    const persistence = createWorkspaceChatPersistence(bridge);
    const snapshot = sampleSnapshot('t1', 'Visible thread');
    snapshot.threads.push(sampleSnapshot('t2', 'Second').threads[0]);
    await persistence.save(snapshot);
    snapshot.threads[0].title = 'Changed';
    bridge.failWrite = '/workspace/chat-history/conversations/changed-t1.md';
    await expect(persistence.save(snapshot)).resolves.toBeUndefined();
    expect(bridge.files.get(WORKSPACE_CHAT_STATE_PATH)).toContain('Changed');
    bridge.failWrite = undefined;
    bridge.writes.length = 0;
    await persistence.save(snapshot);
    expect(conversationWrites(bridge)).toHaveLength(4);
    bridge.bumpEpochOnWrite = true;
    await persistence.save(snapshot);
    bridge.writes.length = 0;
    await persistence.save(snapshot);
    expect(conversationWrites(bridge)).toHaveLength(4);
  });

  it('keeps unknown facades uncached and leaves retired names in place', async () => {
    const bridge = measuredBridge();
    const facade = { request: bridge.request.bind(bridge) };
    const persistence = createWorkspaceChatPersistence(facade);
    const snapshot = sampleSnapshot('t1', 'Old');
    await persistence.save(snapshot);
    bridge.writes.length = 0;
    await persistence.save(snapshot);
    expect(conversationWrites(bridge)).toHaveLength(2);
    const cached = createWorkspaceChatPersistence(bridge);
    await cached.save(snapshot);
    snapshot.threads[0].title = 'New';
    await cached.save(snapshot);
    expect(bridge.files.has('/workspace/chat-history/conversations/old-t1.md')).toBe(true);
    snapshot.threads[0].deletedAt = 4;
    bridge.writes.length = 0;
    await cached.save(snapshot);
    expect(conversationWrites(bridge)).toHaveLength(0);
    expect(bridge.files.get(WORKSPACE_CHAT_LIBRARY_INDEX_PATH)).not.toContain('new-t1.html');
    expect(bridge.files.has('/workspace/chat-history/conversations/new-t1.md')).toBe(true);
  });

});

function measuredBridge() {
  const base = memoryBridge();
  const writes: string[] = [];
  return {
    ...base,
    connectionEpoch: 1,
    writes,
    listingMode: 'complete' as 'complete' | 'failed' | 'truncated' | 'malformed',
    failWrite: undefined as string | undefined,
    bumpEpochOnWrite: false,
    async request<T = unknown>(op: string, data: unknown): Promise<T> {
      if (op === 'fs.list') {
        if (this.listingMode === 'failed') throw new Error('injected listing failure');
        if (this.listingMode === 'truncated') return { path: '/workspace/chat-history/conversations', entries: [], truncated: true } as T;
        if (this.listingMode === 'malformed') return { entries: null } as T;
      }
      if (op === 'fs.write') {
        const path = (data as { path: string }).path;
        writes.push(path);
        if (this.bumpEpochOnWrite && path === WORKSPACE_CHAT_LIBRARY_INDEX_PATH) { this.connectionEpoch++; this.bumpEpochOnWrite = false; }
        if (path === this.failWrite) throw new Error('injected write failure');
      }
      return base.request<T>(op, data);
    },
  };
}

function conversationWrites(bridge: { writes: string[] }) {
  return bridge.writes.filter(path => path.includes('/conversations/'));
}

function sampleSnapshot(id: string, title: string): ChatSnapshot {
  return {
    schemaVersion: CURRENT_CHAT_SCHEMA_VERSION,
    activeThreadId: id,
    threads: [{
      id,
      title,
      subtitle: '',
      pinned: false,
      modelId: 'or-gpt-5.4-mini',
      createdAt: 1,
      updatedAt: 2,
      messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello' }], createdAt: 3 }],
    }],
  };
}

function memoryBridge(initial: Record<string, string> = {}): BridgeClientFacade & { files: Map<string, string> } {
  const files = new Map(Object.entries(initial));
  return {
    files,
    async request<T = unknown>(op: string, data: unknown): Promise<T> {
      const args = data as Record<string, string>;
      switch (op) {
        case 'fs.mkdir':
          return {} as T;
        case 'fs.read': {
          const value = files.get(args.path);
          if (value == null) throw new Error('not found');
          return {
            path: args.path,
            content: value,
            encoding: 'utf8',
            size: value.length,
            mime: 'application/json',
          } as T;
        }
        case 'fs.write':
          files.set(args.path, args.content ?? '');
          return { path: args.path, bytes: (args.content ?? '').length } as T;
        case 'fs.list': {
          const prefix = args.path.replace(/\/+$/, '');
          return {
            path: prefix,
            entries: [...files.keys()]
              .filter(path => path.startsWith(`${prefix}/`))
              .map(path => ({
                path,
                name: path.slice(prefix.length + 1),
                kind: 'file',
                size: files.get(path)?.length ?? 0,
                mtime: 1,
              })),
          } as T;
        }
        case 'fs.delete':
          files.delete(args.path);
          return {} as T;
        case 'fs.move': {
          const value = files.get(args.from);
          if (value == null) throw new Error('not found');
          files.set(args.to, value);
          files.delete(args.from);
          return {} as T;
        }
        default:
          throw new Error(`unexpected op ${op}`);
      }
    },
  };
}


describe('workspace persistence publication authority', () => {
  it('allows a read-only missing-state load without creating a directory', async () => {
    const calls: string[] = [];
    const persistence = createWorkspaceChatPersistence({ request: async (op: string) => {
      calls.push(op); throw new Error('not found');
    } }, () => false);
    expect(await persistence.load()).toEqual({ kind: 'missing' });
    expect(calls).toEqual(['fs.read']);
    await expect(persistence.backupMalformed('bad')).rejects.toThrow('authority expired');
    await expect(persistence.save(sampleSnapshot('t1', 'Read only'))).rejects.toThrow('authority expired');
    expect(calls).toEqual(['fs.read']);
  });

  for (const deferredOp of ['fs.mkdir', 'fs.write', 'fs.move'] as const) {
    it(`does not start another mutation after authority expires during ${deferredOp}`, async () => {
      let allowed = true;
      let release: (() => void) | undefined;
      let arrived: (() => void) | undefined;
      const started = new Promise<void>(resolve => { arrived = resolve; });
      const hold = new Promise<void>(resolve => { release = resolve; });
      const calls: string[] = [];
      const persistence = createWorkspaceChatPersistence({ async request<T>(op: string): Promise<T> {
        calls.push(op);
        if (op === deferredOp) { arrived?.(); await hold; }
        if (op === 'fs.move') throw new Error('synthetic move failure');
        return {} as T;
      } }, () => allowed);
      const save = persistence.save(sampleSnapshot('t1', 'Authority'));
      await started;
      allowed = false;
      const before = [...calls];
      release?.();
      await expect(save).rejects.toThrow('authority expired');
      expect(calls).toEqual(before);
    });
  }
});

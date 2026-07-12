import { describe, expect, it } from 'vitest';
import type { ChatSnapshot } from '../../src/core/types';
import type { BridgeClientFacade } from '../../src/services/tools/types';
import {
  createWorkspaceChatPersistence,
  WORKSPACE_CHAT_LIBRARY_INDEX_PATH,
  WORKSPACE_CHAT_STATE_PATH,
} from '../../src/services/workspaceChatPersistence';
import { assistantMessageParts, userMessageParts } from '../../src/core/messageParts';

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

  it('prunes stale readable conversation exports after rename or delete', async () => {
    const bridge = memoryBridge({
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

    expect(bridge.files.has('/workspace/chat-history/conversations/old-title-t1.html')).toBe(false);
    expect(bridge.files.has('/workspace/chat-history/conversations/old-title-t1.md')).toBe(false);
    expect(bridge.files.has('/workspace/chat-history/conversations/deleted-thread-t2.html')).toBe(false);
    expect(bridge.files.has('/workspace/chat-history/conversations/deleted-thread-t2.md')).toBe(false);
    expect(bridge.files.has('/workspace/chat-history/conversations/new-title-t1.html')).toBe(true);
    expect(bridge.files.has('/workspace/chat-history/conversations/new-title-t1.md')).toBe(true);
  });
});

function sampleSnapshot(id: string, title: string): ChatSnapshot {
  return {
    schemaVersion: 3,
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

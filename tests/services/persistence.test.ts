import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSnapshot, saveSnapshot } from '../../src/services/persistence';
import { clearAppStorage } from '../helpers/storage';

describe('persistence', () => {
  beforeEach(() => clearAppStorage());
  afterEach(() => {
    vi.restoreAllMocks();
    clearAppStorage();
  });

  it('returns null when nothing is stored', () => {
    expect(loadSnapshot()).toBeNull();
  });

  it('round-trips a snapshot', () => {
    const snapshot = {
      threads: [{
        id: 't1', title: 'hi', subtitle: '', pinned: false,
        modelId: 'or-gpt-5.4-mini',
        createdAt: 1, updatedAt: 2,
        messages: [{ id: 'm1', role: 'user' as const, content: 'yo', createdAt: 3 }],
      }],
      activeThreadId: 't1',
    };
    saveSnapshot(snapshot);
    expect(loadSnapshot()).toEqual(snapshot);
  });

  it('returns null on malformed JSON', () => {
    localStorage.setItem('gatesai.state.v1', '{not json');
    expect(loadSnapshot()).toBeNull();
  });

  it('returns null when threads is not an array', () => {
    localStorage.setItem('gatesai.state.v1', JSON.stringify({ threads: 'nope' }));
    expect(loadSnapshot()).toBeNull();
  });

  it('migrates legacy role:"tool" messages and folds same-turn assistant rounds into one', () => {
    // Snapshot shape we shipped while tool results were their own row AND
    // each model→tool round trip was its own assistant message.
    // Migration should produce ONE assistant message per turn with both
    // calls/results accumulated and the final round's prose as content.
    const legacy = {
      threads: [{
        id: 't1', title: 'memory chat', subtitle: '', pinned: false,
        modelId: 'claude-sonnet-4.5', createdAt: 1, updatedAt: 5,
        messages: [
          { id: 'u1', role: 'user', content: 'remember jazz', createdAt: 1 },
          {
            id: 'a1', role: 'assistant', content: '', createdAt: 2,
            model: 'claude-sonnet-4.5',
            toolCalls: [{ id: 'call_1', name: 'memory', arguments: { action: 'add', fact: 'jazz' } }],
          },
          {
            id: 'tool_1', role: 'tool', content: 'Saved.', createdAt: 3,
            toolCallId: 'call_1', toolName: 'memory',
          },
          { id: 'a2', role: 'assistant', content: 'done — saved.', createdAt: 4 },
        ],
      }],
      activeThreadId: 't1',
    };
    localStorage.setItem('gatesai.state.v1', JSON.stringify(legacy));

    const loaded = loadSnapshot();
    expect(loaded).not.toBeNull();
    const msgs = loaded!.threads[0].messages;
    expect(msgs.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(loaded!.threads[0].modelId).toBe('or-gemini-3-flash');
    const a = msgs[1];
    if (a.role !== 'assistant') throw new Error('expected assistant');
    // Identity comes from the first round's message (so external refs survive).
    expect(a.id).toBe('a1');
    expect(a.toolCalls).toHaveLength(1);
    expect(a.toolCalls?.[0].id).toBe('call_1');
    expect(a.toolResults).toHaveLength(1);
    expect(a.toolResults?.[0].content).toBe('Saved.');
    // Final round's prose wins.
    expect(a.content).toBe('done — saved.');
  });

  it('preserves dynamic OpenRouter and Ollama model ids across migration', () => {
    const snapshot = {
      threads: [
        {
          id: 'or-dynamic', title: 'OpenRouter dynamic', subtitle: '', pinned: false,
          modelId: 'or-live-google_gemini-3-flash-preview',
          createdAt: 1, updatedAt: 2,
          messages: [],
        },
        {
          id: 'ollama-dynamic', title: 'Ollama dynamic', subtitle: '', pinned: false,
          modelId: 'ollama-llama3.2:latest',
          createdAt: 1, updatedAt: 2,
          messages: [],
        },
      ],
      activeThreadId: 'or-dynamic',
    };
    localStorage.setItem('gatesai.state.v1', JSON.stringify(snapshot));

    const loaded = loadSnapshot();

    expect(loaded?.threads.map(thread => thread.modelId)).toEqual([
      'or-live-google_gemini-3-flash-preview',
      'ollama-llama3.2:latest',
    ]);
  });

  it('migration is idempotent on already-clean snapshots', () => {
    const clean = {
      threads: [{
        id: 't1', title: 'x', subtitle: '', pinned: false,
        modelId: 'or-gpt-5.4-mini', createdAt: 1, updatedAt: 2,
        messages: [
          { id: 'u', role: 'user' as const, content: 'hi', createdAt: 1 },
          {
            id: 'a', role: 'assistant' as const, content: 'hello', createdAt: 2,
            toolCalls: [{ id: 'c1', name: 'memory', arguments: {} }],
            toolResults: [{ toolCallId: 'c1', toolName: 'memory', content: 'ok', ranAt: 3 }],
          },
        ],
      }],
      activeThreadId: 't1',
    };
    saveSnapshot(clean);
    expect(loadSnapshot()).toEqual(clean);
  });

  it('keeps conversation messages saved when oversized tool results exceed localStorage quota', () => {
    mockChatStorageQuota(2_000);

    const snapshot = {
      threads: [{
        id: 't1', title: 'migration work', subtitle: '', pinned: false,
        modelId: 'or-gpt-5.4-mini', createdAt: 1, updatedAt: 2,
        messages: [
          { id: 'u', role: 'user' as const, content: 'convert this csv for migration', createdAt: 1 },
          {
            id: 'a', role: 'assistant' as const, content: 'I wrote the structured JSON artifact.',
            createdAt: 2,
            toolCalls: [{ id: 'c1', name: 'fs', arguments: { action: 'read', path: '/workspace/artifacts/huge.json' } }],
            toolResults: [{
              toolCallId: 'c1',
              toolName: 'fs',
              content: 'path: /workspace/artifacts/huge.json\n' + 'x'.repeat(20_000),
              ranAt: 3,
            }],
          },
        ],
      }],
      activeThreadId: 't1',
    };

    saveSnapshot(snapshot);

    const loaded = loadSnapshot();
    expect(loaded?.threads[0].messages).toHaveLength(2);
    const assistant = loaded?.threads[0].messages[1];
    expect(assistant).toMatchObject({
      role: 'assistant',
      content: 'I wrote the structured JSON artifact.',
    });
    if (assistant?.role !== 'assistant') throw new Error('expected assistant');
    expect(assistant.toolResults?.[0].content).toContain('[persisted tool result compacted]');
    expect(assistant.toolResults?.[0].content).toContain('/workspace/artifacts/huge.json');
  });

  it('keeps conversation messages saved when oversized tool call arguments exceed localStorage quota', () => {
    mockChatStorageQuota(2_000);

    const snapshot = {
      threads: [{
        id: 't1', title: 'artifact write', subtitle: '', pinned: false,
        modelId: 'or-gpt-5.4-mini', createdAt: 1, updatedAt: 2,
        messages: [
          { id: 'u', role: 'user' as const, content: 'write the migration json', createdAt: 1 },
          {
            id: 'a', role: 'assistant' as const, content: 'I wrote the artifact.',
            createdAt: 2,
            toolCalls: [{
              id: 'c1',
              name: 'fs',
              arguments: {
                action: 'write',
                path: '/workspace/artifacts/migration.json',
                content: '{"rows":[' + '1,'.repeat(20_000) + ']}',
              },
            }],
            toolResults: [{
              toolCallId: 'c1',
              toolName: 'fs',
              content: 'Wrote 40010 bytes to /workspace/artifacts/migration.json',
              ranAt: 3,
            }],
          },
        ],
      }],
      activeThreadId: 't1',
    };

    saveSnapshot(snapshot);

    const loaded = loadSnapshot();
    expect(loaded?.threads[0].messages).toHaveLength(2);
    const assistant = loaded?.threads[0].messages[1];
    if (assistant?.role !== 'assistant') throw new Error('expected assistant');
    expect(assistant.content).toBe('I wrote the artifact.');
    expect(assistant.toolCalls?.[0].arguments.content).toContain('[persisted tool argument compacted]');
    expect(assistant.toolCalls?.[0].arguments.content).toContain('/workspace/artifacts/migration.json');
    expect(assistant.toolResults?.[0].content).toContain('Wrote 40010 bytes');
  });
});

function mockChatStorageQuota(maxChars: number): void {
  const originalSetItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItemWithQuota(this: Storage, key, value) {
    if (key === 'gatesai.state.v1' && value.length > maxChars) {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    }
    return originalSetItem.call(this, key, value);
  });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
}

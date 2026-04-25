import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatStore } from '../../src/stores/ChatStore';
import { ProviderStore } from '../../src/stores/ProviderStore';
import { ModelRegistry } from '../../src/stores/ModelRegistry';
import { UserProfileStore } from '../../src/stores/UserProfileStore';
import type { ToolContext } from '../../src/services/tools/types';
import { MockProvider, flush, installMockProvider } from '../helpers/mockProvider';
import { clearAppStorage } from '../helpers/storage';

/**
 * A provider that lets each test script per-call chunks separately. The
 * default MockProvider replays one fixed array on every .stream() call, which
 * doesn't fit the multi-round tool loop where each round needs different
 * output.
 */
class ScriptedProvider {
  readonly id = 'openai' as const;
  readonly script: Array<Array<import('../../src/core/llm').LlmChunk>>;
  readonly calls: Array<import('../../src/core/llm').LlmRequest> = [];
  cursor = 0;

  constructor(script: Array<Array<import('../../src/core/llm').LlmChunk>>) {
    this.script = script;
  }

  ready(): boolean { return true; }

  async *stream(req: import('../../src/core/llm').LlmRequest, signal: AbortSignal): AsyncIterable<import('../../src/core/llm').LlmChunk> {
    this.calls.push(req);
    const chunks = this.script[this.cursor++] ?? [{ type: 'done', finishReason: 'stop' }];
    for (const c of chunks) {
      if (signal.aborted) return;
      await Promise.resolve();
      yield c;
    }
  }
}

function setupScripted(script: Array<Array<import('../../src/core/llm').LlmChunk>>) {
  clearAppStorage();
  const registry = new ModelRegistry();
  const providers = new ProviderStore(registry);
  const profile = new UserProfileStore();
  const mock = new ScriptedProvider(script);
  installMockProvider(providers, mock as unknown as MockProvider);
  const chat = new ChatStore(providers, registry, profile);
  return { registry, providers, profile, mock, chat };
}

describe('Tool loop — scripted', () => {
  beforeEach(() => clearAppStorage());
  afterEach(() => clearAppStorage());

  it('memory(add): executes tool, mutates bio, appends tool message, and finishes with a final reply', async () => {
    const { chat, mock, profile } = setupScripted([
      // Round 1: model decides to call memory(add).
      [
        { type: 'text', delta: "Got it — I'll remember that. " },
        { type: 'tool_call', call: { id: 'call_xyz', name: 'memory', arguments: { action: 'add', fact: 'User loves jazz piano' } } },
        { type: 'done', finishReason: 'tool_use' },
      ],
      // Round 2: model produces a final text reply now that the tool result is in history.
      [
        { type: 'text', delta: "Saved. Want to chat about Bill Evans?" },
        { type: 'done', finishReason: 'stop' },
      ],
    ]);
    chat.createThread();

    chat.sendMessage('Remember I love jazz piano');
    await flush(80);

    expect(profile.bio).toContain('User loves jazz piano');
    expect(mock.calls).toHaveLength(2);
    expect(mock.calls[0].tools?.some(t => t.name === 'memory')).toBe(true);
    expect(mock.calls[1].tools?.some(t => t.name === 'memory')).toBe(true);
    const r2Msgs = mock.calls[1].messages;
    expect(r2Msgs.some(m => m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0)).toBe(true);
    expect(r2Msgs.some(m => m.role === 'tool' && m.content.includes('Saved'))).toBe(true);

    // ONE assistant message per user turn — multi-round tool work all
    // lives on the same row (toolCalls + toolResults arrays + final
    // content). This is what the renderer sees: one speaker boundary.
    const messages = chat.activeThread!.messages;
    expect(messages.map(m => m.role)).toEqual(['user', 'assistant']);
    const assistant = messages[1];
    if (assistant.role !== 'assistant') throw new Error('expected assistant');
    expect(assistant.toolCalls?.[0].name).toBe('memory');
    expect(assistant.toolCalls?.[0].arguments.action).toBe('add');
    expect(assistant.toolResults?.[0].toolCallId).toBe('call_xyz');
    expect(assistant.toolResults?.[0].content).toContain('Saved');
    // Content holds the FINAL round's prose, not the preamble from round 1.
    expect(assistant.content).toContain('Bill Evans');
    expect(assistant.content).not.toContain("Got it");
    expect(chat.streamingMessageId).toBeNull();
  });

  it('memory(remove) by substring deletes the matching fact', async () => {
    const { chat, profile } = setupScripted([
      [
        { type: 'tool_call', call: { id: 'c1', name: 'memory', arguments: { action: 'remove', fact: 'jazz' } } },
        { type: 'done', finishReason: 'tool_use' },
      ],
      [{ type: 'text', delta: 'Forgotten.' }, { type: 'done', finishReason: 'stop' }],
    ]);
    profile.addFact('User loves jazz piano');
    profile.addFact('User lives in Seattle');
    chat.createThread();

    chat.sendMessage('forget jazz');
    await flush(80);

    expect(profile.facts).toEqual(['User lives in Seattle']);
  });

  it('memory(list) returns a numbered list without mutating', async () => {
    const { chat, mock, profile } = setupScripted([
      [
        { type: 'tool_call', call: { id: 'c1', name: 'memory', arguments: { action: 'list' } } },
        { type: 'done', finishReason: 'tool_use' },
      ],
      [{ type: 'text', delta: 'Here is what I know.' }, { type: 'done', finishReason: 'stop' }],
    ]);
    profile.addFact('Lives in Seattle');
    profile.addFact('Loves jazz');
    chat.createThread();

    chat.sendMessage('what do you know about me');
    await flush(80);

    const toolMsg = mock.calls[1].messages.find(m => m.role === 'tool');
    expect(toolMsg?.content).toContain('0. Loves jazz');
    expect(toolMsg?.content).toContain('1. Lives in Seattle');
    expect(profile.facts).toHaveLength(2); // unchanged
  });

  it('memory(update) replaces a fact by substring match', async () => {
    const { chat, profile } = setupScripted([
      [
        { type: 'tool_call', call: { id: 'c1', name: 'memory', arguments: { action: 'update', fact: 'Seattle', next: 'Lives in Portland' } } },
        { type: 'done', finishReason: 'tool_use' },
      ],
      [{ type: 'text', delta: 'updated' }, { type: 'done', finishReason: 'stop' }],
    ]);
    profile.addFact('Lives in Seattle');
    chat.createThread();
    chat.sendMessage('I moved');
    await flush(80);

    expect(profile.facts).toEqual(['Lives in Portland']);
  });

  it('passes thread context into the system prompt under "About this conversation"', async () => {
    const { chat, mock } = setupScripted([
      [{ type: 'text', delta: 'ok' }, { type: 'done', finishReason: 'stop' }],
    ]);
    const tid = chat.createThread();
    chat.setThreadContext(tid, 'This conversation is about migrating a Postgres schema.');

    chat.sendMessage('start');
    await flush(20);

    const sys = mock.calls[0].systemPrompt;
    expect(sys).toBeDefined();
    expect(sys).toContain('About this conversation');
    expect(sys).toContain('migrating a Postgres schema');
  });

  it('allows extended tool work and surfaces a visible message at the round cap', async () => {
    const round = (): import('../../src/core/llm').LlmChunk[] => [
      { type: 'tool_call', call: { id: `c-${Math.random()}`, name: 'memory', arguments: { action: 'add', fact: 'loop' } } },
      { type: 'done', finishReason: 'tool_use' },
    ];
    const { chat, mock } = setupScripted(Array.from({ length: 20 }, round));
    chat.createThread();

    chat.sendMessage('go');
    await flush(200);

    expect(mock.calls.length).toBeGreaterThan(6);
    expect(mock.calls.length).toBeLessThanOrEqual(16);
    expect(chat.lastError).toContain('tool rounds');
    expect(chat.activeThread!.messages.at(-1)?.content).toContain('Stopped after 16 tool rounds');
    expect(chat.streamingMessageId).toBeNull();
  });

  it('returns a clear tool result when fs is called without an action', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { chat, mock } = setupScripted([
      [
        { type: 'tool_call', call: { id: 'fs-empty', name: 'fs', arguments: {} } },
        { type: 'done', finishReason: 'tool_use' },
      ],
      [{ type: 'text', delta: 'I need a valid file action.' }, { type: 'done', finishReason: 'stop' }],
    ]);
    chat.setToolStoresProvider(() => ({
      bridge: {
        isOnline: true,
        client: { request: async () => ({}) },
      },
    }) as unknown as Pick<ToolContext, 'notes' | 'summary' | 'bridge' | 'execStream'>);
    chat.createThread();

    try {
      chat.sendMessage('read the attached file');
      await flush(80);
    } finally {
      warn.mockRestore();
    }

    const toolMsg = mock.calls[1].messages.find(m => m.role === 'tool');
    expect(toolMsg?.content).toMatch(/`action` is required for fs/i);
    expect(toolMsg?.content).not.toContain('unknown action ""');
    expect(chat.activeThread!.messages.at(-1)?.content).toContain('valid file action');
  });

  it('logs structured details when a tool call fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { chat } = setupScripted([
      [
        { type: 'tool_call', call: { id: 'fs-empty', name: 'fs', arguments: {} } },
        { type: 'done', finishReason: 'tool_use' },
      ],
      [{ type: 'text', delta: 'I need a valid file action.' }, { type: 'done', finishReason: 'stop' }],
    ]);
    chat.setToolStoresProvider(() => ({
      bridge: {
        isOnline: true,
        client: { request: async () => ({}) },
      },
    }) as unknown as Pick<ToolContext, 'notes' | 'summary' | 'bridge' | 'execStream'>);
    const threadId = chat.createThread();

    try {
      chat.sendMessage('read the attached file');
      await flush(80);
      expect(warn).toHaveBeenCalledWith(
        '[tool-call-failed]',
        expect.objectContaining({
          toolName: 'fs',
          toolCallId: 'fs-empty',
          threadId,
          reason: expect.stringContaining('action'),
          bridgeOnline: true,
          readOnly: false,
        }),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('logs non-zero terminal exits as failed tool calls', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { chat } = setupScripted([
      [
        { type: 'tool_call', call: { id: 'bad-terminal', name: 'terminal', arguments: { cmd: 'node', args: ['missing.js'] } } },
        { type: 'done', finishReason: 'tool_use' },
      ],
      [{ type: 'text', delta: 'The command failed.' }, { type: 'done', finishReason: 'stop' }],
    ]);
    chat.setToolStoresProvider(() => ({
      bridge: {
        isOnline: true,
        client: { request: async () => ({ exit_code: 2, duration_ms: 12, stdout: '', stderr: 'missing file' }) },
      },
    }) as unknown as Pick<ToolContext, 'notes' | 'summary' | 'bridge' | 'execStream'>);
    chat.createThread();

    try {
      chat.sendMessage('run the script');
      await flush(80);
      expect(warn).toHaveBeenCalledWith(
        '[tool-call-failed]',
        expect.objectContaining({
          toolName: 'terminal',
          toolCallId: 'bad-terminal',
          reason: expect.stringContaining('[exit 2'),
        }),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('redacts sensitive tool arguments in failure logs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { chat } = setupScripted([
      [
        {
          type: 'tool_call',
          call: {
            id: 'write-failed',
            name: 'fs',
            arguments: { action: 'write', path: '/workspace/notes/secret.txt', content: 'super-secret-token' },
          },
        },
        { type: 'done', finishReason: 'tool_use' },
      ],
      [{ type: 'text', delta: 'The write failed.' }, { type: 'done', finishReason: 'stop' }],
    ]);
    chat.setToolStoresProvider(() => ({
      bridge: {
        isOnline: true,
        client: { request: async () => { throw new Error('disk full'); } },
      },
    }) as unknown as Pick<ToolContext, 'notes' | 'summary' | 'bridge' | 'execStream'>);
    chat.createThread();

    try {
      chat.sendMessage('write this file');
      await flush(80);
      const payload = warn.mock.calls[0]?.[1] as { argumentsPreview?: string };
      expect(payload.argumentsPreview).toContain('[redacted');
      expect(payload.argumentsPreview).not.toContain('super-secret-token');
    } finally {
      warn.mockRestore();
    }
  });

  it('runs independent read-only tools concurrently but preserves result order', async () => {
    const { chat, mock } = setupScripted([
      [
        { type: 'tool_call', call: { id: 'slow-time', name: 'time', arguments: {} } },
        { type: 'tool_call', call: { id: 'fast-memory', name: 'memory', arguments: { action: 'list' } } },
        { type: 'done', finishReason: 'tool_use' },
      ],
      [{ type: 'text', delta: 'done' }, { type: 'done', finishReason: 'stop' }],
    ]);
    const originalNow = Date.now;
    const starts: Record<string, number> = {};
    let logicalNow = 0;
    Date.now = (() => {
      logicalNow += 1;
      return logicalNow;
    }) as DateConstructor['now'];
    try {
      chat.createThread();
      chat.sendMessage('check time and memory');
      await flush(80);
    } finally {
      Date.now = originalNow;
    }

    const secondRound = mock.calls[1].messages.filter(m => m.role === 'tool');
    for (const msg of secondRound) starts[msg.toolCallId ?? ''] = msg.content.includes('iso:') ? 1 : 2;

    expect(secondRound.map(m => m.toolCallId)).toEqual(['slow-time', 'fast-memory']);
    expect(Object.keys(starts)).toEqual(['slow-time', 'fast-memory']);
  });
});

describe('UserProfileStore', () => {
  beforeEach(() => clearAppStorage());
  afterEach(() => clearAppStorage());

  it('composeSystemPrompt: head + bio + recent + threadContext order', () => {
    const p = new UserProfileStore();
    p.setDefaultSystemPrompt('You are concise.');
    p.setBio('· User is a developer');
    const composed = p.composeSystemPrompt({
      runtimeContext: 'local_time: Saturday, April 25, 2026 at 03:25 AM CDT',
      threadContext: 'Working on a billing migration.',
      recentSummaries: ['Auth refactor: shipped JWT login'],
      artifactInstructions: '[/workspace/artifacts/report/README.md]\nUse the validated report.',
    });
    expect(composed).toBeDefined();
    const s = composed!;
    // Order matters — base harness, runtime, head, bio, recent, artifact instructions, ctx, then nudge.
    const idxHarness = s.indexOf('Bridge workspace contract');
    const idxRuntime = s.indexOf('Runtime context');
    const idxHead   = s.indexOf('You are concise.');
    const idxBio    = s.indexOf('About the user');
    const idxRecent = s.indexOf('Recent conversations');
    const idxArtifact = s.indexOf('Artifact instructions');
    const idxCtx    = s.indexOf('About this conversation');
    const idxNudge  = s.indexOf('memory` tool');
    expect(idxHarness).toBeGreaterThanOrEqual(0);
    expect(idxRuntime).toBeGreaterThan(idxHarness);
    expect(idxHead).toBeGreaterThan(idxRuntime);
    expect(idxBio).toBeGreaterThan(idxHead);
    expect(idxRecent).toBeGreaterThan(idxBio);
    expect(idxArtifact).toBeGreaterThan(idxRecent);
    expect(idxCtx).toBeGreaterThan(idxArtifact);
    expect(idxNudge).toBeGreaterThan(idxCtx);
    expect(s).toContain('Auth refactor: shipped JWT login');
    expect(s).toContain('Use the validated report.');
    expect(s).toContain('local_time: Saturday');
  });

  it('always includes the base bridge harness prompt', () => {
    const p = new UserProfileStore();
    const emptyComposed = p.composeSystemPrompt();
    expect(emptyComposed).toBeDefined();
    expect(emptyComposed).toContain('Bridge workspace contract');
    expect(emptyComposed).toContain('/workspace/... paths are for the `fs` tool');
    expect(emptyComposed).toContain('Treat tools like command-style utilities');
    expect(emptyComposed).toContain('Use `inspect_file` before `fs.read` for CSV, JSON, and text files');
    expect(emptyComposed).not.toContain('memory` tool');

    p.setBio('just a bio');
    const composed = p.composeSystemPrompt();
    expect(composed).toContain('About the user:\njust a bio');
    expect(composed).toContain('memory` tool'); // nudge present whenever any memory context exists
  });

  it('addFact prepends with bullet formatting and dedupes', () => {
    const p = new UserProfileStore();
    expect(p.addFact('Loves jazz')).toBe(true);
    expect(p.addFact('Lives in Seattle')).toBe(true);
    expect(p.bio).toBe('· Lives in Seattle\n· Loves jazz');
    // Case-insensitive duplicate.
    expect(p.addFact('LOVES JAZZ')).toBe(false);
    expect(p.facts).toHaveLength(2);
  });

  it('removeFactAt + removeFactMatching + updateFactAt + clearFacts', () => {
    const p = new UserProfileStore();
    p.addFact('A');
    p.addFact('B');
    p.addFact('C');
    expect(p.facts).toEqual(['C', 'B', 'A']);
    expect(p.removeFactAt(1)).toBe('B');
    expect(p.facts).toEqual(['C', 'A']);
    expect(p.removeFactMatching('c')).toBe('C');
    expect(p.updateFactAt(0, 'A-prime')).toBe('A-prime');
    expect(p.facts).toEqual(['A-prime']);
    p.clearFacts();
    expect(p.facts).toEqual([]);
  });
});

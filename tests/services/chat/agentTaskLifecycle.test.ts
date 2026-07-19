import { describe, expect, it, vi } from 'vitest';
import {
  AgentTaskLifecycle,
  displayAgentTaskTitle,
  normalizeAgentTaskTitle,
  type AgentTaskLifecycleHost,
} from '../../../src/services/chat/agentTaskLifecycle';
import type { Thread } from '../../../src/core/types';

function makeOrigin(): Thread {
  return {
    id: 'origin',
    title: 'Origin',
    subtitle: '',
    createdAt: 1,
    updatedAt: 1,
    pinned: false,
    modelId: 'or-test',
    messages: [],
  };
}

function makeHost(overrides: Partial<AgentTaskLifecycleHost> = {}): AgentTaskLifecycleHost & {
  threads: Thread[];
} {
  const threads: Thread[] = [makeOrigin()];
  const host: AgentTaskLifecycleHost & { threads: Thread[] } = {
    threads,
    runInAction: fn => fn(),
    newThreadId: () => 'agent-1',
    newMessageId: () => 'm-1',
    findThread: id => threads.find(thread => thread.id === id),
    ensureThreadModel: id => threads.find(thread => thread.id === id) ?? null,
    resolveAgentTaskModelId: () => 'or-test',
    runningAgentTaskCount: () => threads.filter(t => t.agentTask && t.agentTaskStatus === 'running').length,
    unshiftThread: thread => { threads.unshift(thread); },
    schedulePersist: vi.fn(),
    interruptThread: vi.fn(),
    clearStreamingState: vi.fn(),
    setController: vi.fn(),
    getController: vi.fn(),
    setThreadLastError: vi.fn(),
    appendActivityEventToThread: vi.fn(),
    runTurn: vi.fn(async () => undefined),
    getThreads: () => threads,
    ...overrides,
  };
  return host;
}

describe('agentTaskLifecycle helpers', () => {
  it('normalizes and displays agent task titles', () => {
    expect(normalizeAgentTaskTitle('  long   title  ')).toBe('long title');
    expect(displayAgentTaskTitle('Agent: Digest')).toBe('Digest');
    expect(displayAgentTaskTitle('Digest')).toBe('Digest');
  });
});

describe('AgentTaskLifecycle.spawn', () => {
  it('creates a running agent thread and starts a turn', () => {
    const host = makeHost();
    const lifecycle = new AgentTaskLifecycle({ host });
    const result = lifecycle.spawn({
      title: 'Review',
      instructions: 'Check the diff',
    }, 'origin');

    expect(result.ok).toBe(true);
    expect(result.threadId).toBe('agent-1');
    expect(host.threads[0]?.agentTask).toBe(true);
    expect(host.threads[0]?.agentTaskStatus).toBe('running');
    expect(host.runTurn).toHaveBeenCalledOnce();
  });

  it('refuses nested agent tasks', () => {
    const host = makeHost();
    host.threads[0] = { ...host.threads[0], agentTask: true, agentTaskStatus: 'running' };
    const lifecycle = new AgentTaskLifecycle({ host });
    const result = lifecycle.spawn({
      title: 'Nested',
      instructions: 'nope',
    }, 'origin');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/cannot spawn nested/);
  });
});

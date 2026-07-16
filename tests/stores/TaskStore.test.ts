import { describe, expect, it, vi } from 'vitest';
import type { Thread } from '../../src/core/types';
import type { CompletedJob, ImageJob } from '../../src/services/image/jobs/types';
import { TaskStore, type TaskAgentThreadsFacade, type TaskImageJobsFacade } from '../../src/stores/TaskStore';
import type { AgentTaskPolicy } from '../../src/core/agentTaskPolicy';

function imageJob(overrides: Partial<ImageJob> = {}): ImageJob {
  return {
    id: 'image-1',
    threadId: 'origin-image',
    prompt: 'Paint a moonlit observatory',
    count: 1,
    width: 1024,
    height: 1024,
    backend: 'openrouter-image',
    status: 'pending',
    results: [],
    createdAt: 10,
    ...overrides,
  };
}

function agentThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 'agent-1',
    title: 'Agent: Audit workspace',
    subtitle: '',
    createdAt: 20,
    updatedAt: 30,
    pinned: false,
    modelId: 'or-gpt-5.4-mini',
    messages: [{
      id: 'assistant-1',
      role: 'assistant',
      content: 'Audit complete.',
      createdAt: 25,
      usage: [{
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        costUsd: 0.012,
        costSource: 'provider',
      }],
    }],
    agentTask: true,
    agentTaskOriginThreadId: 'origin-agent',
    agentTaskStatus: 'done',
    agentTaskMaxRounds: 6,
    ...overrides,
  };
}

function setup(options: { images?: ImageJob[]; history?: CompletedJob[]; agents?: Thread[] } = {}) {
  const agents = options.agents ?? [];
  const imageJobs: TaskImageJobsFacade = {
    queue: options.images ?? [],
    active: null,
    history: options.history ?? [],
    cancel: vi.fn(),
    retry: vi.fn(),
  };
  const chat: TaskAgentThreadsFacade = {
    visibleAgentTaskThreads: agents,
    streamActivityByThread: {},
    lastErrorByThread: {},
    cancelAgentTask: vi.fn((threadId: string) => {
      const thread = agents.find(candidate => candidate.id === threadId);
      if (!thread) return false;
      thread.agentTaskStatus = 'interrupted';
      return true;
    }),
    retryAgentTask: vi.fn(() => true),
  };
  return { store: new TaskStore(imageJobs, chat), imageJobs, chat };
}

describe('TaskStore unified facade', () => {
  it('mirrors image queue, active progress, history, cost, and result fields', () => {
    const queued = imageJob();
    const active = imageJob({
      id: 'image-active',
      status: 'running',
      progress: { value: 45, max: 100 },
      startedAt: 12,
      costUsd: 0.04,
      results: ['/workspace/partial.png'],
    });
    const done = imageJob({
      id: 'image-done',
      status: 'done',
      completedAt: 40,
      results: ['/workspace/final.png'],
    }) as CompletedJob;
    const { store, imageJobs } = setup({ images: [queued], history: [done] });
    imageJobs.active = active;

    expect(store.pending[0]).toMatchObject({ id: 'image-1', kind: 'image', status: 'pending' });
    expect(store.running[0]).toMatchObject({
      id: 'image-active',
      progress: { value: 45, max: 100 },
      costUsd: 0.04,
      results: ['/workspace/partial.png'],
    });
    expect(store.history[0]).toMatchObject({ id: 'image-done', status: 'done', completedAt: 40 });
  });

  it('maps agent lifecycle, round progress, final result, and LLM cost', () => {
    const running = agentThread({ id: 'agent-running', agentTaskStatus: 'running', updatedAt: 22 });
    const done = agentThread();
    const { store, chat } = setup({ agents: [done, running] });
    chat.streamActivityByThread['agent-running'] = {
      messageId: 'm', phase: 'tooling', startedAt: 20, lastProviderAt: 21, round: 2,
    };

    expect(store.running[0]).toMatchObject({
      id: 'agent-running',
      kind: 'agent',
      title: 'Audit workspace',
      progress: { value: 3, max: 6, label: 'Round 3 of 6' },
    });
    expect(store.history.find(task => task.id === 'agent-1')).toMatchObject({
      status: 'done',
      results: ['Audit complete.'],
      costUsd: 0.012,
    });
  });

  it('surfaces boot-interrupted agents as retryable failures', () => {
    const { store } = setup({ agents: [agentThread({ agentTaskStatus: 'interrupted' })] });
    expect(store.tasks[0]).toMatchObject({ status: 'failed' });
    expect(store.tasks[0].error).toContain('Retry');
  });

  it('delegates cancel/retry to the existing runner owners', () => {
    const failed = imageJob({ id: 'image-failed', status: 'failed', completedAt: 30 }) as CompletedJob;
    const { store, imageJobs, chat } = setup({
      images: [imageJob()],
      history: [failed],
      agents: [agentThread({ id: 'agent-running', agentTaskStatus: 'running' })],
    });

    expect(store.cancel('image-1')).toBe(true);
    expect(imageJobs.cancel).toHaveBeenCalledWith('image-1');
    expect(store.retry('image-failed')).toBe(true);
    expect(imageJobs.retry).toHaveBeenCalledWith('image-failed');
    expect(store.cancel('agent-running')).toBe(true);
    expect(chat.cancelAgentTask).toHaveBeenCalledWith('agent-running');
    expect(store.tasks.find(task => task.id === 'agent-running')?.status).toBe('cancelled');
  });

  it('queues immutable policy snapshots FIFO and enforces the two-slot ceiling', () => {
    const now = 100;
    let id = 0;
    const images: TaskImageJobsFacade = { queue: [], active: null, history: [], cancel: vi.fn(), retry: vi.fn() };
    const chat: TaskAgentThreadsFacade = { visibleAgentTaskThreads: [], streamActivityByThread: {}, lastErrorByThread: {}, cancelAgentTask: vi.fn(), retryAgentTask: vi.fn() };
    const ledger = new TaskStore(images, chat, {
      clock: () => now, idFactory: () => `ledger-${++id}`,
    });
    const policy = agentPolicy();
    const first = ledger.enqueueAgentTask({ title: 'First', instructions: 'Do first.', origin_thread_id: 'origin', policy });
    ledger.enqueueAgentTask({ title: 'Second', instructions: 'Do second.', origin_thread_id: 'origin', policy });
    ledger.enqueueAgentTask({ title: 'Third', instructions: 'Do third.', origin_thread_id: 'origin', policy });
    expect(Object.isFrozen(first.spec.policy)).toBe(true);
    expect(ledger.ledgerPending.map(entry => entry.pending_reason)).toEqual(['ready', 'ready', 'waiting_for_slot']);
    expect(ledger.ledgerPending.map(entry => entry.spec.id)).toEqual(['ledger-1', 'ledger-2', 'ledger-3']);
    expect(ledger.startNextAgentTask()?.task_id).toBe('ledger-1');
    expect(ledger.startNextAgentTask()?.task_id).toBe('ledger-2');
    expect(ledger.startNextAgentTask()).toBeNull();
    expect(ledger.ledgerPending[0]).toMatchObject({ spec: { id: 'ledger-3' }, pending_reason: 'waiting_for_slot' });
  });

  it('links retries to monotonic attempts and preserves partial usage/results', () => {
    let now = 200;
    const images: TaskImageJobsFacade = { queue: [], active: null, history: [], cancel: vi.fn(), retry: vi.fn() };
    const chat: TaskAgentThreadsFacade = { visibleAgentTaskThreads: [], streamActivityByThread: {}, lastErrorByThread: {}, cancelAgentTask: vi.fn(), retryAgentTask: vi.fn() };
    const ledger = new TaskStore(images, chat, { clock: () => now++, idFactory: () => 'ledger-task' });
    ledger.enqueueAgentTask({ title: 'Retry me', instructions: 'Try safely.', origin_thread_id: 'origin', policy: agentPolicy() });
    expect(ledger.startNextAgentTask()?.id).toBe('ledger-task:attempt:1');
    expect(ledger.finishAgentAttempt('ledger-task', { state: 'interrupted', actual_cost_usd: 0.1, used_tokens: 100, result_ref: 'artifact://partial' })).toBe(true);
    expect(ledger.retryLedgerTask('ledger-task')).toBe(true);
    expect(ledger.startNextAgentTask()?.id).toBe('ledger-task:attempt:2');
    expect(ledger.agentLedger[0].attempts[0]).toMatchObject({ state: 'interrupted', result_ref: 'artifact://partial', actual_cost_usd: 0.1 });
  });

  it('fails closed on invalid/cumulative usage and can cancel pending work only', () => {
    const images: TaskImageJobsFacade = { queue: [], active: null, history: [], cancel: vi.fn(), retry: vi.fn() };
    const chat: TaskAgentThreadsFacade = { visibleAgentTaskThreads: [], streamActivityByThread: {}, lastErrorByThread: {}, cancelAgentTask: vi.fn(), retryAgentTask: vi.fn() };
    let id = 0;
    const ledger = new TaskStore(images, chat, { clock: () => 1, idFactory: () => `ledger-${++id}` });
    const first = ledger.enqueueAgentTask({ title: 'Cost', instructions: 'Stay bounded.', origin_thread_id: 'origin', policy: agentPolicy() });
    const second = ledger.enqueueAgentTask({ title: 'Cancel', instructions: 'Wait.', origin_thread_id: 'origin', policy: agentPolicy() });
    ledger.startNextAgentTask();
    expect(ledger.finishAgentAttempt(first.spec.id, { state: 'done', actual_cost_usd: -1, used_tokens: 1 })).toBe(false);
    expect(ledger.finishAgentAttempt(first.spec.id, { state: 'done', actual_cost_usd: 1.1, used_tokens: 1 })).toBe(true);
    expect(ledger.agentLedger[0]).toMatchObject({
      state: 'failed',
      attempts: [{ state: 'failed', actual_cost_usd: 1.1, stop_reason: 'budget_exceeded' }],
    });
    expect(ledger.cancelLedgerTask(second.spec.id)).toBe(true);
    expect(ledger.cancelLedgerTask(first.spec.id)).toBe(false);
  });

  it('exposes frozen attempt projections that cannot mutate ledger authority', () => {
    const images: TaskImageJobsFacade = { queue: [], active: null, history: [], cancel: vi.fn(), retry: vi.fn() };
    const chat: TaskAgentThreadsFacade = { visibleAgentTaskThreads: [], streamActivityByThread: {}, lastErrorByThread: {}, cancelAgentTask: vi.fn(), retryAgentTask: vi.fn() };
    const ledger = new TaskStore(images, chat, { clock: () => 1, idFactory: () => 'ledger-frozen' });
    ledger.enqueueAgentTask({ title: 'Frozen', instructions: 'Do not mutate.', origin_thread_id: 'origin', policy: agentPolicy() });
    const returned = ledger.startNextAgentTask();
    expect(Object.isFrozen(returned)).toBe(true);
    expect(Object.isFrozen(ledger.agentLedger[0])).toBe(true);
    expect(Object.isFrozen(ledger.agentLedger[0].attempts[0])).toBe(true);
  });
});

function agentPolicy(): AgentTaskPolicy {
  return {
    schema_version: 1,
    route: { model_id: 'local-model', provider_id: 'ollama', locality: 'local' },
    requested_tools: [], database_pins: [], max_rounds: 3, max_tokens: 1000,
    max_runtime_ms: 60_000, max_cost_usd: 1, consent_ref: 'consent-1',
  };
}

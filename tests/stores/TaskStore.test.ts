import { describe, expect, it, vi } from 'vitest';
import type { Thread } from '../../src/core/types';
import type { CompletedJob, ImageJob } from '../../src/services/image/jobs/types';
import { TaskStore, type TaskAgentThreadsFacade, type TaskImageJobsFacade } from '../../src/stores/TaskStore';

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
});

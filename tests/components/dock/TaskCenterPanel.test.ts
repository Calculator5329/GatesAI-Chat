import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runInAction } from 'mobx';
import { StoreProvider } from '../../../src/stores/context';
import { TaskCenterPanel } from '../../../src/components/dock/TaskCenterPanel';
import { TaskStore, type TaskAgentThreadsFacade, type TaskImageJobsFacade } from '../../../src/stores/TaskStore';
import type { RootStore } from '../../../src/stores/RootStore';
import type { CompletedJob, ImageJob } from '../../../src/services/image/jobs/types';
import type { Thread } from '../../../src/core/types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

function renderPanel(tasks: TaskStore, goThread = vi.fn()): { rendered: HTMLElement; goThread: ReturnType<typeof vi.fn> } {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const store = { tasks, router: { goThread } } as unknown as RootStore;
  act(() => {
    root!.render(createElement(StoreProvider, {
      store,
      children: createElement(TaskCenterPanel, { params: {} }),
    }));
  });
  return { rendered: host, goThread };
}

function facades(): { images: TaskImageJobsFacade; chat: TaskAgentThreadsFacade } {
  const image: ImageJob = {
    id: 'image-running', threadId: 'origin-image', prompt: 'Render nebula', count: 1,
    width: 512, height: 512, backend: 'openrouter-image', status: 'running',
    results: [], createdAt: 1, startedAt: 2, progress: { value: 50, max: 100 }, costUsd: 0.02,
  };
  const failed = {
    ...image, id: 'image-failed', status: 'failed' as const, active: undefined,
    completedAt: 5, error: 'Provider unavailable', progress: undefined,
  } as CompletedJob;
  const agent: Thread = {
    id: 'agent-done', title: 'Agent: Verify output', subtitle: '', createdAt: 3, updatedAt: 4,
    pinned: false, modelId: 'or-gpt-5.4-mini', messages: [], agentTask: true,
    agentTaskOriginThreadId: 'origin', agentTaskStatus: 'done',
  };
  return {
    images: { queue: [], active: image, history: [failed], cancel: vi.fn(), retry: vi.fn() },
    chat: {
      visibleAgentTaskThreads: [agent], streamActivityByThread: {}, lastErrorByThread: {},
      cancelAgentTask: vi.fn(() => true), retryAgentTask: vi.fn(() => true),
    },
  };
}

describe('TaskCenterPanel', () => {
  it('renders state groups, progress, costs, and task actions', () => {
    const { images, chat } = facades();
    const tasks = new TaskStore(images, chat);
    const { rendered } = renderPanel(tasks);

    expect(rendered.textContent).toContain('Running');
    expect(rendered.textContent).toContain('History');
    expect(rendered.textContent).toContain('Render nebula');
    expect(rendered.textContent).toContain('$0.02');
    expect(rendered.querySelector('[role="progressbar"]')).not.toBeNull();

    const cancel = Array.from(rendered.querySelectorAll('button')).find(button => button.textContent === 'Cancel');
    const retry = Array.from(rendered.querySelectorAll('button')).find(button => button.textContent === 'Retry');
    act(() => cancel?.click());
    act(() => retry?.click());
    expect(images.cancel).toHaveBeenCalledWith('image-running');
    expect(images.retry).toHaveBeenCalledWith('image-failed');
  });

  it('opens the producing thread when a task row is selected', () => {
    const { images, chat } = facades();
    runInAction(() => { images.active = null; images.history = []; });
    const { rendered, goThread } = renderPanel(new TaskStore(images, chat));
    const row = rendered.querySelector<HTMLElement>('[data-task-id="agent-done"]');
    act(() => row?.click());
    expect(goThread).toHaveBeenCalledWith('agent-done');
  });
});

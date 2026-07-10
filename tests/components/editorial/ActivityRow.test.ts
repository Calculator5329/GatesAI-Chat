import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ActivityRow } from '../../../src/components/editorial/activity/ActivityRow';
import { ImageJobStore } from '../../../src/stores/ImageJobStore';
import { BridgeStore } from '../../../src/stores/BridgeStore';
import { UiStore } from '../../../src/stores/UiStore';
import { StoreProvider } from '../../../src/stores/context';
import type { RootStore } from '../../../src/stores/RootStore';
import type { ActivityItem } from '../../../src/core/types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function minimalStore(imageJobs: ImageJobStore, ui: UiStore | RootStore['ui'] = {} as RootStore['ui']): RootStore {
  return {
    registry: {} as RootStore['registry'],
    providers: {} as RootStore['providers'],
    profile: {} as RootStore['profile'],
    chat: {} as RootStore['chat'],
    ui,
    router: {} as RootStore['router'],
    bridge: new BridgeStore(),
    execStream: {} as RootStore['execStream'],
    localRuntime: {} as RootStore['localRuntime'],
    imageJobs,
  } as RootStore;
}

function renderRow(
  item: ActivityItem,
  imageJobs = new ImageJobStore(),
  ui: UiStore | RootStore['ui'] = {} as RootStore['ui'],
  messageId?: string,
): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      createElement(StoreProvider, {
        store: minimalStore(imageJobs, ui),
        children: createElement(ActivityRow, { item, messageId }),
      }),
    );
  });
  return host;
}

beforeEach(() => {
  host = null;
  root = null;
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
});

describe('ActivityRow image-job visibility (Batch D)', () => {
  it('renders image-job cards outside the collapsed activity button', () => {
    const item: ActivityItem = {
      id: 'act-img-1',
      kind: 'image-job',
      state: 'running',
      verb: 'Generating',
      target: '2 images',
      startedAt: Date.now(),
      artifacts: [{ kind: 'image-job', jobId: 'job-abc', count: 2 }],
    };

    const rendered = renderRow(item);

    expect(rendered.querySelector('.activity-row__image-jobs')).not.toBeNull();
    // Image jobs are always visible — the collapse button is optional when only jobs exist.
    const button = rendered.querySelector('.activity-row__button');
    expect(button?.getAttribute('disabled')).not.toBeNull();
  });

  it('keeps non-image artifacts behind the expandable activity button', () => {
    const item: ActivityItem = {
      id: 'act-tool-1',
      kind: 'tool',
      state: 'done',
      verb: 'Read',
      target: 'notes.txt',
      summary: 'ok',
      startedAt: Date.now(),
      finishedAt: Date.now() + 1,
      detail: { type: 'markdown', content: 'file body' },
    };

    const rendered = renderRow(item);
    expect(rendered.querySelector('.activity-row__image-jobs')).toBeNull();
    expect(rendered.querySelector('.activity-row__button')).not.toBeNull();
  });
});

describe('ActivityRow tool-output disclosure', () => {
  it('auto-collapses outputs over 40 lines and restores the per-message UI choice after remount', () => {
    const ui = new UiStore();
    const item: ActivityItem = {
      id: 'act-terminal-long',
      kind: 'tool',
      state: 'done',
      verb: 'Ran',
      target: 'tests',
      startedAt: Date.now(),
      detail: {
        type: 'terminal',
        lines: Array.from({ length: 41 }, (_, index) => ({
          stream: 'stdout' as const,
          text: `output ${index + 1}`,
        })),
      },
    };

    let rendered = renderRow(item, new ImageJobStore(), ui, 'message-a');
    let button = rendered.querySelector('.activity-row__button') as HTMLButtonElement;
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-label')).toContain('41 lines · Expand output');
    expect(button.textContent).toContain('41 lines · Expand');
    expect(rendered.querySelector('.activity-row__detail')).toBeNull();

    act(() => button.click());
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(rendered.querySelector('.activity-row__terminal--expanded-output')).not.toBeNull();
    expect(rendered.querySelectorAll('.activity-row__terminal span')).toHaveLength(41);
    expect(ui.toolOutputOpenState('message-a', item.id)).toBe(true);
    expect(ui.toolOutputOpenState('message-b', item.id)).toBeUndefined();

    act(() => root?.unmount());
    rendered.remove();
    root = null;
    host = null;

    rendered = renderRow(item, new ImageJobStore(), ui, 'message-a');
    button = rendered.querySelector('.activity-row__button') as HTMLButtonElement;
    expect(button.getAttribute('aria-expanded')).toBe('true');

    ui.dispose();
  });

  it('does not label a 40-line output as auto-collapsed', () => {
    const item: ActivityItem = {
      id: 'act-terminal-threshold',
      kind: 'tool',
      state: 'done',
      verb: 'Ran',
      startedAt: Date.now(),
      detail: {
        type: 'terminal',
        lines: Array.from({ length: 40 }, () => ({ stream: 'stdout' as const, text: 'output' })),
      },
    };

    const rendered = renderRow(item);
    expect(rendered.querySelector('.activity-row__output-toggle')).toBeNull();
    expect(rendered.querySelector('.activity-row__button')?.getAttribute('aria-label')).toBe('Ran');
  });
});

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ActivityRow } from '../../../src/components/editorial/activity/ActivityRow';
import { ImageJobStore } from '../../../src/stores/ImageJobStore';
import { BridgeStore } from '../../../src/stores/BridgeStore';
import { StoreProvider } from '../../../src/stores/context';
import type { RootStore } from '../../../src/stores/RootStore';
import type { ActivityItem } from '../../../src/core/types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function minimalStore(imageJobs: ImageJobStore): RootStore {
  return {
    registry: {} as RootStore['registry'],
    providers: {} as RootStore['providers'],
    profile: {} as RootStore['profile'],
    chat: {} as RootStore['chat'],
    ui: {} as RootStore['ui'],
    router: {} as RootStore['router'],
    bridge: new BridgeStore(),
    execStream: {} as RootStore['execStream'],
    localRuntime: {} as RootStore['localRuntime'],
    imageJobs,
  } as RootStore;
}

function renderRow(item: ActivityItem, imageJobs = new ImageJobStore()): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      createElement(StoreProvider, {
        store: minimalStore(imageJobs),
        children: createElement(ActivityRow, { item }),
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

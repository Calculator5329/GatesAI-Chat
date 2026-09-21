import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratedUi, GeneratedUiView } from '../../../src/components/editorial/GeneratedUi';
import { ActivityRow } from '../../../src/components/editorial/activity/ActivityRow';
import { StoreProvider } from '../../../src/stores/context';
import { BridgeStore } from '../../../src/stores/BridgeStore';
import { ImageJobStore } from '../../../src/stores/ImageJobStore';
import type { RootStore } from '../../../src/stores/RootStore';
import type { ActivityItem } from '../../../src/core/types';
import type { UiSpec } from '../../../src/core/uiCatalog';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const SPEC: UiSpec = {
  root: 'main',
  elements: {
    main: { type: 'Stack', props: { direction: 'vertical' }, children: ['open', 'go'] },
    open: { type: 'Stat', props: { label: 'Open items', value: '3', hint: 'as of today' }, children: [] },
    go: {
      type: 'Button',
      props: { label: 'Show them' },
      children: [],
      on: { press: { action: 'send_message', params: { text: 'Show me the open items' } } },
    },
  },
};

function mount(element: ReturnType<typeof createElement>): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(element);
  });
  return host;
}

function minimalStore(sendMessage: (text: string) => void): RootStore {
  return {
    registry: {} as RootStore['registry'],
    providers: {} as RootStore['providers'],
    profile: {} as RootStore['profile'],
    chat: { sendMessage, activitiesForMessage: () => [] } as unknown as RootStore['chat'],
    ui: {} as RootStore['ui'],
    router: {} as RootStore['router'],
    bridge: new BridgeStore(),
    execStream: {} as RootStore['execStream'],
    localRuntime: {} as RootStore['localRuntime'],
    imageJobs: new ImageJobStore(),
  } as RootStore;
}

beforeEach(() => {
  host = null;
  root = null;
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
});

describe('GeneratedUi', () => {
  it('renders a Stat and a Button, and pressing the button sends the bound message', async () => {
    const onSendMessage = vi.fn();
    const rendered = mount(createElement(GeneratedUiView, { spec: SPEC, title: 'Sprint', onSendMessage }));

    expect(rendered.querySelector('.generated-ui__title')?.textContent).toBe('Sprint');
    expect(rendered.querySelector('.generated-ui__stat-value')?.textContent).toBe('3');
    expect(rendered.querySelector('.generated-ui__stat-label')?.textContent).toBe('Open items');
    expect(rendered.querySelector('.generated-ui__stat-hint')?.textContent).toBe('as of today');
    const button = rendered.querySelector('.generated-ui__button') as HTMLButtonElement;
    expect(button.textContent).toBe('Show them');

    await act(async () => {
      button.click();
      await Promise.resolve();
    });
    expect(onSendMessage).toHaveBeenCalledWith('Show me the open items');
  });

  it('routes the press through the chat store when mounted from a message', async () => {
    const sendMessage = vi.fn();
    const rendered = mount(createElement(StoreProvider, {
      store: minimalStore(sendMessage),
      children: createElement(GeneratedUi, { spec: SPEC }),
    }));
    const button = rendered.querySelector('.generated-ui__button') as HTMLButtonElement;
    await act(async () => {
      button.click();
      await Promise.resolve();
    });
    expect(sendMessage).toHaveBeenCalledWith('Show me the open items');
  });

  it('renders ui artifacts outside the collapsed activity chip', () => {
    const item: ActivityItem = {
      id: 'act-ui-1',
      kind: 'tool',
      state: 'done',
      verb: 'Rendering',
      target: 'Sprint',
      summary: 'Rendered "Sprint" (3 elements: Button, Stack, Stat)',
      startedAt: Date.now(),
      finishedAt: Date.now() + 1,
      detail: { type: 'markdown', content: 'status: ok' },
      artifacts: [{ kind: 'ui', title: 'Sprint', spec: SPEC }],
    };
    const rendered = mount(createElement(StoreProvider, {
      store: minimalStore(() => undefined),
      children: createElement(ActivityRow, { item }),
    }));

    expect(rendered.querySelector('.activity-row__image-jobs .generated-ui')).not.toBeNull();
    expect(rendered.querySelector('.generated-ui__stat-value')?.textContent).toBe('3');
    expect(rendered.querySelector('.activity-row__detail')).toBeNull();
  });
});

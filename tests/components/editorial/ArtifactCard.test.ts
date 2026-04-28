import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StoreProvider } from '../../../src/stores/context';
import { ArtifactCard, makeArtifactMessageHandler } from '../../../src/components/editorial/ArtifactCard';
import { ARTIFACT_PREAMBLE } from '../../../src/components/editorial/artifactBridge';
import type { RootStore } from '../../../src/stores/RootStore';
import type { ArtifactStore } from '../../../src/stores/ArtifactStore';
import type { BridgeStore } from '../../../src/stores/BridgeStore';
import type { ArtifactMeta } from '../../../src/core/artifacts';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function makeMeta(id = 'mycard-aaa111'): ArtifactMeta {
  return {
    id,
    title: 'My Card',
    slug: 'my-card',
    createdAt: 1,
    updatedAt: 2,
    threadId: 't1',
    currentVersion: 1,
    versions: [{ version: 1, createdAt: 1, size: 10 }],
  };
}

function makeStore(opts: {
  meta: ArtifactMeta | null;
  html: string | null;
}): RootStore {
  const artifacts = {
    findById: () => opts.meta,
    hydrate: vi.fn(async () => opts.meta),
    getHtml: vi.fn(async () => opts.html),
  } as unknown as ArtifactStore;
  const bridge = {
    isOnline: false,
    workspaceRoot: 'C:/ws',
    openWorkspacePath: vi.fn(async () => true),
    client: { request: vi.fn() },
  } as unknown as BridgeStore;
  return { artifacts, bridge } as unknown as RootStore;
}

async function flush() {
  // Let microtasks drain so the hydrate-then-getHtml promise chain settles.
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

function render(node: React.ReactElement, store: RootStore): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(createElement(StoreProvider, { store, children: node }));
  });
  return host;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

describe('ArtifactCard rendering', () => {
  it('renders the iframe with preamble + html and the v{n} pill after hydrate', async () => {
    const meta = makeMeta();
    const html = '<h1>hello-body</h1>';
    const store = makeStore({ meta, html });

    const rendered = render(createElement(ArtifactCard, { id: meta.id, version: 1 }), store);
    await flush();

    expect(rendered.textContent).toContain('My Card');
    expect(rendered.textContent).toContain('v1');

    const iframe = rendered.querySelector('iframe');
    expect(iframe).not.toBeNull();
    const srcdoc = iframe!.getAttribute('srcdoc') ?? '';
    expect(srcdoc).toContain('window.gates');
    expect(srcdoc).toContain(ARTIFACT_PREAMBLE.trim().slice(0, 40));
    expect(srcdoc).toContain('hello-body');

    const sandbox = iframe!.getAttribute('sandbox') ?? '';
    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).toContain('allow-popups');
  });

  it('toggles a fullscreen overlay when Expand is clicked', async () => {
    const meta = makeMeta();
    const store = makeStore({ meta, html: '<p>x</p>' });
    const rendered = render(createElement(ArtifactCard, { id: meta.id, version: 1 }), store);
    await flush();

    const expandBtn = Array.from(rendered.querySelectorAll('button'))
      .find(b => /expand/i.test(b.textContent ?? ''));
    expect(expandBtn).not.toBeUndefined();

    expect(rendered.querySelector('[data-testid="artifact-fullscreen"]')).toBeNull();
    act(() => { expandBtn!.click(); });
    expect(rendered.querySelector('[data-testid="artifact-fullscreen"]')).not.toBeNull();
  });

  it('renders a "Lost track" placeholder when hydrate resolves null', async () => {
    const store = makeStore({ meta: null, html: null });
    const rendered = render(createElement(ArtifactCard, { id: 'gone-xyz', version: 1 }), store);
    await flush();

    expect(rendered.textContent).toMatch(/Lost track of artifact/i);
    expect(rendered.textContent).toContain('gone-xyz');
  });
});

describe('makeArtifactMessageHandler', () => {
  it('routes __gates frames from the iframe contentWindow and posts a __gatesResp', async () => {
    const fakeContentWindow = { postMessage: vi.fn() };
    const fakeIframe = { contentWindow: fakeContentWindow } as unknown as HTMLIFrameElement;
    const bridge = {
      isOnline: true,
      client: { request: vi.fn(async () => ({ content: 'data', encoding: 'utf8' })) },
    } as unknown as Parameters<typeof makeArtifactMessageHandler>[1];

    const handler = makeArtifactMessageHandler('art-1', bridge, () => fakeIframe);

    const ev = {
      data: { __gates: true, id: 'r1', op: 'readFile', args: ['/workspace/x.txt'] },
      source: fakeContentWindow,
    } as unknown as MessageEvent;

    await handler(ev);
    expect(fakeContentWindow.postMessage).toHaveBeenCalledTimes(1);
    const [payload] = fakeContentWindow.postMessage.mock.calls[0];
    expect(payload.__gatesResp).toBe(true);
    expect(payload.id).toBe('r1');
    expect(payload.ok).toBe(true);
  });

  it('ignores frames not coming from the iframe contentWindow', async () => {
    const fakeContentWindow = { postMessage: vi.fn() };
    const fakeIframe = { contentWindow: fakeContentWindow } as unknown as HTMLIFrameElement;
    const bridge = {
      isOnline: true,
      client: { request: vi.fn() },
    } as unknown as Parameters<typeof makeArtifactMessageHandler>[1];

    const handler = makeArtifactMessageHandler('art-1', bridge, () => fakeIframe);
    await handler({
      data: { __gates: true, id: 'r1', op: 'readFile', args: ['/workspace/x.txt'] },
      source: { postMessage: vi.fn() }, // different window
    } as unknown as MessageEvent);

    expect(fakeContentWindow.postMessage).not.toHaveBeenCalled();
  });

  it('ignores non-__gates messages', async () => {
    const fakeContentWindow = { postMessage: vi.fn() };
    const fakeIframe = { contentWindow: fakeContentWindow } as unknown as HTMLIFrameElement;
    const handler = makeArtifactMessageHandler('art-1', undefined, () => fakeIframe);
    await handler({ data: { hello: 'world' }, source: fakeContentWindow } as unknown as MessageEvent);
    expect(fakeContentWindow.postMessage).not.toHaveBeenCalled();
  });
});

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { runInAction } from 'mobx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BridgeStore } from '../../../src/stores/BridgeStore';
import { UiStore } from '../../../src/stores/UiStore';
import { useWindowFileDrop } from '../../../src/components/editorial/composer/useWindowFileDrop';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let ui: UiStore | null = null;

function WindowDropHarness({ store, bridge }: { store: UiStore; bridge: BridgeStore }) {
  const active = useWindowFileDrop(store, bridge);
  return createElement('output', { 'data-active': active || undefined });
}

function fileDragEvent(type: 'dragenter' | 'drop', files: File[]): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { files, types: ['Files'] },
  });
  return event;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  ui?.dispose();
  ui = null;
  vi.restoreAllMocks();
});

describe('window-wide composer file drop', () => {
  it('shows its hint during a file drag and uploads one drop through UiStore', async () => {
    ui = new UiStore();
    const bridge = new BridgeStore();
    runInAction(() => { bridge.state = 'online'; });
    bridge.uploadAttachment = vi.fn(async (file: File) => ({
      id: 'dropped-file',
      filename: file.name,
      path: `/workspace/attachments/${file.name}`,
      size: file.size,
      mime: file.type,
    }));
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(createElement(WindowDropHarness, { store: ui!, bridge })));

    const dragEnter = fileDragEvent('dragenter', []);
    act(() => window.dispatchEvent(dragEnter));
    expect(dragEnter.defaultPrevented).toBe(true);
    expect(host!.querySelector('output')?.dataset.active).toBe('true');

    const drop = fileDragEvent('drop', [new File(['contents'], 'dropped.txt', { type: 'text/plain' })]);
    await act(async () => {
      window.dispatchEvent(drop);
      await vi.waitFor(() => expect(ui!.attachments).toHaveLength(1));
    });

    expect(drop.defaultPrevented).toBe(true);
    expect(bridge.uploadAttachment).toHaveBeenCalledTimes(1);
    expect(ui.attachments[0]).toMatchObject({ filename: 'dropped.txt', mime: 'text/plain' });
    expect(host!.querySelector('output')?.dataset.active).toBeUndefined();
  });
});

// The toast used to mount and unmount with no motion whatsoever, which reads as
// a pop in the corner of the eye. These tests defend the two things that make
// it a transition instead: it starts un-shown so the entrance has something to
// animate from, and it stays mounted through its exit rather than vanishing the
// instant the timeout fires.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StoreProvider } from '../../../src/stores/context';
import { UndoToast } from '../../../src/components/editorial/UndoToast';
import type { RootStore } from '../../../src/stores/RootStore';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.useRealTimers();
});

function undoStore() {
  let listener: (() => void) | null = null;
  const snapshot = { event: 'registered' as string | null, eventId: 1, canUndo: true, nextLabel: 'Thread deleted' };
  return {
    snapshot,
    notify: () => listener?.(),
    facade: {
      subscribe: (fn: () => void) => { listener = fn; return () => { listener = null; }; },
      getSnapshot: () => snapshot,
      undo: () => true,
    },
  };
}

function render(undo: ReturnType<typeof undoStore>) {
  host = document.createElement('div');
  document.body.appendChild(host);
  const store = {
    undo: undo.facade,
    router: { isMenu: false, goThread: vi.fn() },
    chat: { activeThreadId: 't1' },
  } as unknown as RootStore;
  root = createRoot(host);
  act(() => root?.render(createElement(StoreProvider, {
    store,
    children: createElement(UndoToast),
  })));
  return host.querySelector('.undo-toast');
}

describe('UndoToast motion', () => {
  it('mounts un-shown so the entrance has somewhere to come from', () => {
    const undo = undoStore();
    const toast = render(undo);
    expect(toast).not.toBeNull();
    expect(toast?.getAttribute('data-shown')).toBeNull();
  });

  it('marks itself shown on the frame after mount', async () => {
    const undo = undoStore();
    render(undo);
    await act(async () => { await new Promise(resolve => requestAnimationFrame(() => resolve(null))); });
    expect(host?.querySelector('.undo-toast')?.getAttribute('data-shown')).toBe('true');
  });

  it('stays mounted through its exit instead of vanishing at the timeout', () => {
    vi.useFakeTimers();
    const undo = undoStore();
    render(undo);
    // The moment the dismiss timer fires, the toast must still be in the DOM
    // and no longer shown, so the exit transition has a frame to run in.
    act(() => { vi.advanceTimersByTime(5000); });
    expect(host?.querySelector('.undo-toast')).not.toBeNull();
    expect(host?.querySelector('.undo-toast')?.getAttribute('data-shown')).toBeNull();

    act(() => { vi.advanceTimersByTime(200); });
    expect(host?.querySelector('.undo-toast')).toBeNull();
  });
});

import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryDisclosure, exclusionReference } from '../../../src/components/editorial/MemoryDisclosure';
import type { RetrievalTrace, RetrievalTraceItem } from '../../../src/core/types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

function renderDisclosure(options: { canOpenThread?: boolean } = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const openThread = vi.fn();
  const openManager = vi.fn();

  function Harness() {
    const [excluded, setExcluded] = useState<string[]>([]);
    return createElement(MemoryDisclosure, {
      trace,
      excludedReferences: excluded,
      canOpenThread: () => options.canOpenThread ?? true,
      onOpenThread: openThread,
      onOpenManager: openManager,
      onExclude: reference => setExcluded(current => [...current, reference]),
      onInclude: reference => setExcluded(current => current.filter(item => item !== reference)),
    });
  }

  act(() => root!.render(createElement(Harness)));
  return { host, openThread, openManager };
}

describe('MemoryDisclosure', () => {
  it('renders Option 2 source chips and progressively reveals exact provenance', () => {
    const rendered = renderDisclosure();
    expect(rendered.host.querySelectorAll('.memory-disclosure__chip')).toHaveLength(2);
    expect(rendered.host.textContent).toContain('Conversation · Launch notes');
    expect(rendered.host.textContent).toContain('Saved fact · Prefers concise status updates');
    expect(rendered.host.querySelector('.memory-disclosure__detail')).toBeNull();

    act(() => (rendered.host.querySelector('.memory-disclosure__chip') as HTMLButtonElement).click());
    expect(rendered.host.textContent).toContain('The launch review is Friday.');
    expect(rendered.host.textContent).toContain('Conversation');
    expect(rendered.host.textContent).toContain('You');

    const why = Array.from(rendered.host.querySelectorAll('button')).find(button => button.textContent === 'Why was this used?')!;
    act(() => (why as HTMLButtonElement).click());
    expect(rendered.host.textContent).toContain('Matched both wording and meaning');
    expect(rendered.host.textContent).toContain('not proof that it caused the answer');
  });

  it('opens available thread sources and marks deleted destinations honestly', () => {
    const available = renderDisclosure();
    act(() => (available.host.querySelector('.memory-disclosure__chip') as HTMLButtonElement).click());
    const open = Array.from(available.host.querySelectorAll('button')).find(button => button.textContent === 'Open source')!;
    act(() => (open as HTMLButtonElement).click());
    expect(available.openThread).toHaveBeenCalledWith('thread-old');

    act(() => root?.unmount());
    root = null;
    host?.remove();
    host = null;
    const unavailable = renderDisclosure({ canOpenThread: false });
    act(() => (unavailable.host.querySelector('.memory-disclosure__chip') as HTMLButtonElement).click());
    const button = Array.from(unavailable.host.querySelectorAll('button')).find(item => item.textContent === 'Source unavailable') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('confirms source exclusion and offers a recoverable undo', () => {
    const rendered = renderDisclosure();
    act(() => (rendered.host.querySelector('.memory-disclosure__chip') as HTMLButtonElement).click());
    const stop = Array.from(rendered.host.querySelectorAll('button')).find(button => button.textContent === "Don't use this source")!;
    act(() => (stop as HTMLButtonElement).click());
    expect(rendered.host.textContent).toContain('Stop using this source?');

    const exclude = Array.from(rendered.host.querySelectorAll('button')).find(button => button.textContent === 'Exclude')!;
    act(() => (exclude as HTMLButtonElement).click());
    expect(rendered.host.textContent).toContain('Undo exclusion');

    const undo = Array.from(rendered.host.querySelectorAll('button')).find(button => button.textContent === 'Undo exclusion')!;
    act(() => (undo as HTMLButtonElement).click());
    expect(rendered.host.textContent).toContain("Don't use this source");
  });

  it('uses stable source-level exclusion references', () => {
    expect(exclusionReference(trace.items[0])).toBe('thread:thread-old');
    expect(exclusionReference(trace.items[1])).toBe('memory:memory-fact-1');
  });
});

const items: RetrievalTraceItem[] = [
  {
    reference: 'message:thread-old:m1:f:0',
    sourceType: 'message',
    sourceId: 'm1',
    threadId: 'thread-old',
    role: 'user',
    title: 'Launch notes',
    sourceTimestamp: new Date('2026-07-18T12:00:00Z').getTime(),
    excerpt: 'The launch review is Friday.',
    denseRank: 1,
    lexicalRank: 2,
    fusedRank: 1,
  },
  {
    reference: 'memory:memory-fact-1:f:0',
    sourceType: 'memory',
    sourceId: 'memory-fact-1',
    sourceTimestamp: new Date('2026-07-17T12:00:00Z').getTime(),
    excerpt: 'Prefers concise status updates.',
    fusedRank: 2,
  },
];

const trace: RetrievalTrace = {
  version: 1,
  purpose: 'automatic_context',
  usedAt: Date.now(),
  generationId: 'g1',
  model: 'nomic-embed-text',
  rankingPolicyVersion: 1,
  items,
};

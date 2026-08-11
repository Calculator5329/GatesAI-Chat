import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StoreProvider } from '../../../src/stores/context';
import { UiStore } from '../../../src/stores/UiStore';
import { ActivityStream } from '../../../src/components/editorial/activity/ActivityStream';
import type { RootStore } from '../../../src/stores/RootStore';
import type { ActivityItem } from '../../../src/core/types';
import { clearAppStorage } from '../../helpers/storage';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let store: RootStore;

function render(items: ActivityItem[], header?: string): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(createElement(StoreProvider, {
      store,
      children: createElement(ActivityStream, { items, header }),
    }));
  });
  return host;
}

function item(overrides: Partial<ActivityItem>): ActivityItem {
  return { id: 'activity', kind: 'tool', state: 'done', verb: 'Using', startedAt: 1, ...overrides };
}

beforeEach(() => {
  clearAppStorage();
  const ui = new UiStore();
  ui.setUiPack('aurora');
  store = { ui } as RootStore;
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

describe('ActivityStream — Aurora pack', () => {
  it('replaces the classic rows with a chip header', () => {
    const rendered = render([
      item({ id: 'a', kind: 'tool', verb: 'Writing', target: 'plan.md', finishedAt: 2_500 }),
      item({ id: 'b', kind: 'tool', verb: 'Reading', target: 'notes.md', finishedAt: 3_000 }),
      item({ id: 'c', kind: 'thinking', verb: 'Thinking', finishedAt: 3_200 }),
    ], 'Worked');

    expect(rendered.querySelector('.aurora-activity')).not.toBeNull();
    expect(rendered.querySelector('.activity-stream')).toBeNull();
    const chips = Array.from(rendered.querySelectorAll('.aurora-chip')).map(chip => chip.textContent);
    expect(chips).toContain('2 tool calls');
    expect(chips).toContain('1 reasoning step');
  });

  it('keeps the trace collapsed until asked, and opens it on click', () => {
    const rendered = render([item({ id: 'a', verb: 'Writing', target: 'plan.md', finishedAt: 5 })]);
    expect(rendered.querySelector('.aurora-trace')).toBeNull();

    act(() => {
      rendered.querySelector('.aurora-activity__chips')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(rendered.querySelector('.aurora-trace__row')).not.toBeNull();
    expect(rendered.textContent).toContain('plan.md');
  });

  it('opens itself while work is live, so a running turn is never hidden', () => {
    const rendered = render([item({ id: 'a', state: 'running', verb: 'Running', target: 'npm test' })]);
    expect(rendered.querySelector('.aurora-trace__row')).not.toBeNull();
    expect(rendered.querySelector('.aurora-activity')?.getAttribute('data-state')).toBe('running');
  });

  it('opens itself when something failed', () => {
    const rendered = render([item({ id: 'a', state: 'failed', verb: 'Running', summary: 'Command failed' })]);
    expect(rendered.querySelector('.aurora-activity')?.getAttribute('data-state')).toBe('failed');
    expect(rendered.textContent).toContain('Command failed');
  });

  it('lanes rows by what they did', () => {
    const rendered = render([
      item({ id: 'a', state: 'running', kind: 'thinking', verb: 'Thinking' }),
      item({ id: 'b', kind: 'tool', verb: 'Searching', target: 'docs' }),
      item({ id: 'c', kind: 'tool', verb: 'Writing', target: 'plan.md' }),
    ]);
    const lanes = Array.from(rendered.querySelectorAll('.aurora-trace__row')).map(row => row.getAttribute('data-lane'));
    expect(lanes).toEqual(['reasoning', 'search', 'file']);
  });

  it('shows the line delta a file edit reported', () => {
    const rendered = render([
      item({ id: 'a', state: 'failed', verb: 'Writing', target: 'foo.ts', stats: { added: 6, removed: 1 } }),
    ]);
    expect(rendered.textContent).toContain('+6');
    expect(rendered.textContent).toContain('−1');
  });

  it('renders nothing at all when there is nothing to report', () => {
    expect(render([]).querySelector('.aurora-activity')).toBeNull();
  });
});

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { ActivityStream } from '../../../src/components/editorial/activity/ActivityStream';
import type { ActivityItem } from '../../../src/core/types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(items: ActivityItem[]) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(createElement(ActivityStream, { items }));
  });
  return host;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

describe('ActivityStream', () => {
  it('renders ambient running, done, and failed rows', () => {
    const rendered = render([
      item({ id: 'a1', state: 'running', verb: 'Searching', target: 'React docs' }),
      item({ id: 'a2', state: 'done', verb: 'Reading', target: 'plan.md', summary: 'Read plan.md' }),
      item({ id: 'a3', state: 'failed', verb: 'Running', target: 'npm test', summary: 'Command failed' }),
    ]);

    expect(rendered.textContent).toContain('Searching');
    expect(rendered.textContent).toContain('React docs');
    expect(rendered.querySelector('[aria-label="Searching React docs"] .thinking-dots')).not.toBeNull();
    expect(rendered.textContent).toContain('Read plan.md');
    expect(rendered.querySelector('[data-state="failed"]')?.textContent).toContain('Command failed');
  });

  it('expands markdown details when a row is clicked', () => {
    const rendered = render([
      item({
        id: 'a1',
        state: 'done',
        verb: 'Thinking',
        detail: { type: 'markdown', content: '**Checked** the workspace first.' },
      }),
    ]);

    expect(rendered.querySelector('.activity-row__detail')).toBeNull();
    act(() => {
      rendered.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(rendered.querySelector('.activity-row__detail')?.textContent).toContain('Checked');
    expect(rendered.querySelector('.activity-row__detail strong')?.textContent).toBe('Checked');
  });

  it('accepts optional stats and groupKey on items', () => {
    const rendered = render([
      item({ id: 's1', state: 'done', verb: 'Editing', target: 'foo.ts', stats: { added: 6, removed: 1 } }),
      item({ id: 'g1', state: 'done', verb: 'Ran', target: 'echo a', groupKey: 'shell' }),
      item({ id: 'g2', state: 'done', verb: 'Ran', target: 'echo b', groupKey: 'shell' }),
    ]);
    expect(rendered.textContent).toContain('foo.ts');
  });

  it('renders an SVG icon instead of an ASCII glyph', () => {
    const rendered = render([
      item({ id: 'i1', state: 'done', verb: 'Editing', target: 'foo.ts' }),
    ]);
    expect(rendered.querySelector('.activity-row__icon svg')).not.toBeNull();
    expect(rendered.querySelector('.activity-row__glyph')).toBeNull();
  });

  it('renders stats chips when item has stats', () => {
    const rendered = render([
      item({ id: 's2', state: 'done', verb: 'Editing', target: 'foo.ts', stats: { added: 6, removed: 1 } }),
    ]);
    const stats = rendered.querySelector('.activity-row__stats');
    expect(stats?.textContent).toContain('+6');
    expect(stats?.textContent).toContain('−1');
  });

  it('renders a free-form stats label when added/removed are absent', () => {
    const rendered = render([
      item({ id: 's3', state: 'done', verb: 'Wrote', target: 'foo.ts', stats: { label: '3 files' } }),
    ]);
    expect(rendered.querySelector('.activity-row__stats')?.textContent).toBe('3 files');
  });
});

function item(overrides: Partial<ActivityItem>): ActivityItem {
  return {
    id: 'activity',
    kind: 'tool',
    state: 'done',
    verb: 'Using',
    startedAt: 1,
    ...overrides,
  };
}

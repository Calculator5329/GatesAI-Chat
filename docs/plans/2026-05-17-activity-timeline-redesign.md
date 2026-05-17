# Activity Timeline Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unify the assistant activity rows (thinking, tool calls, image jobs, bridge events) under one polished `TimelineRow` primitive with icons, link-styled targets, stats chips, grouping, and optional section headers — without changing the message data model or palette.

**Architecture:** Keep the existing `ActivityStream` → `ActivityRow` structure and the existing `activitiesForMessage` synthesizer. Generalize the row's visuals (slots, icons, stats), add two optional fields to `ActivityItem` (`stats`, `groupKey`), introduce a lightweight `TimelineGroup` wrapper that collapses consecutive same-key rows, and add a small `TimelineHeader`. Thinking is already an `ActivityItem` of kind `'thinking'`; the redesign just gives it a real visual identity instead of treating it like every other row.

**Tech Stack:** React 19, TypeScript, Vite, Vitest + jsdom, no CSS framework (vanilla CSS in [src/index.css](src/index.css)). All icons are inline SVG via the existing `Icons` registry at [src/components/ui/icons.tsx](src/components/ui/icons.tsx).

**Reference:** [docs/plans/2026-05-17-activity-timeline-redesign-design.md](docs/plans/2026-05-17-activity-timeline-redesign-design.md) (approved design).

**Working commands** (PowerShell — this project's shell):
- Run all tests: `npm.cmd test`
- Run one test file: `npm.cmd test -- tests/components/editorial/ActivityStream.test.ts`
- Typecheck: `npm.cmd run typecheck`
- Lint: `npm.cmd run lint`
- Full CI gate: `npm.cmd run ci`

**Working notes for the executor:**
- Commit after each task. Use Conventional Commits (the repo's style — see `git log`).
- TDD where the task touches logic (grouping, stats, header rendering). Skip TDD for pure visual CSS-only steps.
- Do **not** invent new color tokens. Use `var(--accent)`, `var(--text)`, `var(--text-faint)`, `var(--border)`, and the existing `#ffaaaa` failure tone.
- Never change `ActivityItem` semantics in ways that break the existing `activitiesForMessage` synthesizer in [src/stores/ChatStore.ts:502](src/stores/ChatStore.ts:502).

---

## Task 1: Add `stats` and `groupKey` fields to `ActivityItem`

**Files:**
- Modify: `src/core/types.ts` (around line 150)

**Step 1: Write a failing type-level check (compile-time)**

There is no test for the type shape itself. Instead, write a runtime test that exercises the new fields. Add to `tests/components/editorial/ActivityStream.test.ts`:

```ts
it('accepts optional stats and groupKey on items', () => {
  const rendered = render([
    item({ id: 's1', state: 'done', verb: 'Editing', target: 'foo.ts', stats: { added: 6, removed: 1 } }),
    item({ id: 'g1', state: 'done', verb: 'Ran', target: 'echo a', groupKey: 'shell' }),
    item({ id: 'g2', state: 'done', verb: 'Ran', target: 'echo b', groupKey: 'shell' }),
  ]);
  expect(rendered.textContent).toContain('foo.ts');
});
```

**Step 2: Run test to verify it fails**

Run: `npm.cmd test -- tests/components/editorial/ActivityStream.test.ts`
Expected: FAIL with a TypeScript error about `stats` / `groupKey` not being assignable to `ActivityItem`.

**Step 3: Add fields to `ActivityItem` and a new `ActivityStats` interface**

In `src/core/types.ts`, immediately after the `ActivityItem` interface (currently ends at line ~162), and inside the interface itself, add:

```ts
export interface ActivityStats {
  added?: number;
  removed?: number;
  /** Free-form label when added/removed don't apply (e.g. "3 files", "1.2 KB"). */
  label?: string;
}
```

Then add these two fields **inside** `ActivityItem` (after `toolCallId?: string;`):

```ts
  /** Inline diff/count chips rendered between target and elapsed. */
  stats?: ActivityStats;
  /** Stable grouping key. Consecutive rows with the same key collapse into one parent. */
  groupKey?: string;
```

**Step 4: Run test to verify it passes**

Run: `npm.cmd test -- tests/components/editorial/ActivityStream.test.ts`
Expected: PASS. (The behavior is a no-op for now; only the types changed.)

**Step 5: Typecheck**

Run: `npm.cmd run typecheck`
Expected: clean exit code 0.

**Step 6: Commit**

```bash
git add src/core/types.ts tests/components/editorial/ActivityStream.test.ts
git commit -m "feat(activity): add optional stats and groupKey fields to ActivityItem"
```

---

## Task 2: Add timeline icons to the `Icons` registry

**Files:**
- Modify: `src/components/ui/icons.tsx`

No test for icons. They're pure JSX returning SVG and are visually verified.

**Step 1: Add six icons to the `Icons` object**

Open `src/components/ui/icons.tsx` and add these entries to the `Icons` const (keep alphabetical-ish ordering with the existing entries):

```tsx
  Brain:     () => <Ico d={<><path d="M6.5 3a2 2 0 0 0-2 2 2 2 0 0 0-1 3.5A2 2 0 0 0 5 12a2 2 0 0 0 3 1 2 2 0 0 0 3-1 2 2 0 0 0 1.5-3.5A2 2 0 0 0 11.5 5a2 2 0 0 0-2-2 2 2 0 0 0-1.5.7A2 2 0 0 0 6.5 3z" /><path d="M8 5v8" /></>} />,
  Terminal:  () => <Ico d={<><rect x="2" y="3" width="12" height="10" rx="1.3" /><path d="M4.5 6l2 2-2 2M8 11h3.5" /></>} />,
  FileText:  () => <Ico d={<><path d="M4 2h5l3 3v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" /><path d="M9 2v3h3M5 9h6M5 11.5h4" /></>} />,
  Image:     () => <Ico d={<><rect x="2" y="3" width="12" height="10" rx="1.3" /><circle cx="6" cy="7" r="1.2" /><path d="M3 12l3-3 2.5 2.5L11 8l2 2" /></>} />,
  Plug:      () => <Ico d={<><path d="M6 2v3M10 2v3" /><rect x="4.5" y="5" width="7" height="4.5" rx="1" /><path d="M8 9.5V12a2 2 0 0 0 2 2h1" /></>} />,
  Wrench:    () => <Ico d={<><path d="M11.5 4a2.5 2.5 0 1 1-3.5 3.5l-5 5a1 1 0 1 1-1.5-1.5l5-5A2.5 2.5 0 0 1 11.5 4z" /></>} />,
```

**Step 2: Verify it compiles**

Run: `npm.cmd run typecheck`
Expected: clean exit.

**Step 3: Visual smoke (skip if no dev server running)**

If a dev server is already running, no action needed — icons are not yet wired in. We will see them in later tasks.

**Step 4: Commit**

```bash
git add src/components/ui/icons.tsx
git commit -m "feat(icons): add Brain, Terminal, FileText, Image, Plug, Wrench for timeline rows"
```

---

## Task 3: Create an `iconForActivity` helper

**Files:**
- Create: `src/components/editorial/activity/iconForActivity.tsx`
- Test: `tests/components/editorial/iconForActivity.test.ts`

**Step 1: Write the failing test**

Create `tests/components/editorial/iconForActivity.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { iconForActivity } from '../../../src/components/editorial/activity/iconForActivity';
import { Icons } from '../../../src/components/ui/icons';
import type { ActivityItem } from '../../../src/core/types';

const base: Pick<ActivityItem, 'id' | 'state' | 'verb' | 'startedAt'> = {
  id: 'x', state: 'done', verb: 'Using', startedAt: 0,
};

describe('iconForActivity', () => {
  it('returns Brain for thinking kind', () => {
    expect(iconForActivity({ ...base, kind: 'thinking' })).toBe(Icons.Brain);
  });
  it('returns Terminal for exec-tail kind', () => {
    expect(iconForActivity({ ...base, kind: 'exec-tail' })).toBe(Icons.Terminal);
  });
  it('returns Image for image-job kind', () => {
    expect(iconForActivity({ ...base, kind: 'image-job' })).toBe(Icons.Image);
  });
  it('returns Plug for bridge kind', () => {
    expect(iconForActivity({ ...base, kind: 'bridge' })).toBe(Icons.Plug);
  });
  it('returns Edit for tool with edit-like verb', () => {
    expect(iconForActivity({ ...base, kind: 'tool', verb: 'Editing' })).toBe(Icons.Edit);
  });
  it('returns FileText for tool with read-like verb', () => {
    expect(iconForActivity({ ...base, kind: 'tool', verb: 'Reading' })).toBe(Icons.FileText);
  });
  it('returns Search for tool with search-like verb', () => {
    expect(iconForActivity({ ...base, kind: 'tool', verb: 'Searching' })).toBe(Icons.Search);
  });
  it('returns Wrench for unknown tool', () => {
    expect(iconForActivity({ ...base, kind: 'tool', verb: 'Frobnicating' })).toBe(Icons.Wrench);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm.cmd test -- tests/components/editorial/iconForActivity.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement**

Create `src/components/editorial/activity/iconForActivity.tsx`:

```tsx
import type { ActivityItem } from '../../../core/types';
import { Icons } from '../../ui/icons';

const VERB_ICONS: Array<[RegExp, () => JSX.Element]> = [
  [/^edit/i,    Icons.Edit],
  [/^writ/i,    Icons.Edit],
  [/^read/i,    Icons.FileText],
  [/^view/i,    Icons.FileText],
  [/^search/i,  Icons.Search],
  [/^grep/i,    Icons.Search],
  [/^find/i,    Icons.Search],
  [/^ran/i,     Icons.Terminal],
  [/^run/i,     Icons.Terminal],
];

export function iconForActivity(item: ActivityItem): () => JSX.Element {
  switch (item.kind) {
    case 'thinking':  return Icons.Brain;
    case 'exec-tail': return Icons.Terminal;
    case 'image-job': return Icons.Image;
    case 'bridge':    return Icons.Plug;
    case 'tool': {
      for (const [pattern, icon] of VERB_ICONS) {
        if (pattern.test(item.verb)) return icon;
      }
      return Icons.Wrench;
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm.cmd test -- tests/components/editorial/iconForActivity.test.ts`
Expected: PASS, 8 cases.

**Step 5: Commit**

```bash
git add src/components/editorial/activity/iconForActivity.tsx tests/components/editorial/iconForActivity.test.ts
git commit -m "feat(activity): map activity kind and verb to icon component"
```

---

## Task 4: Generalize `ActivityRow` to use icons and a stats slot

**Files:**
- Modify: `src/components/editorial/activity/ActivityRow.tsx`
- Modify: `tests/components/editorial/ActivityStream.test.ts` (extend existing tests)

**Step 1: Write the failing test**

In `tests/components/editorial/ActivityStream.test.ts`, add:

```ts
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
```

**Step 2: Run tests to verify they fail**

Run: `npm.cmd test -- tests/components/editorial/ActivityStream.test.ts`
Expected: FAIL — no `.activity-row__icon`, no `.activity-row__stats`.

**Step 3: Replace the glyph with an icon and add the stats slot**

Replace the body of `src/components/editorial/activity/ActivityRow.tsx` with:

```tsx
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ActivityItem, ActivityStats } from '../../../core/types';
import { WorkspaceImage } from '../WorkspaceImage';
import { ImageJobCard } from '../ImageJobCard';
import { iconForActivity } from './iconForActivity';

export function ActivityRow({ item }: { item: ActivityItem }) {
  const [open, setOpen] = useState(false);
  const elapsed = useElapsedLabel(item.state === 'running', item.startedAt);
  const expandable = Boolean(item.detail || item.artifacts?.length);
  const label = [item.verb, item.target].filter(Boolean).join(' ');
  const summary = item.state === 'failed' || item.state === 'cancelled' || item.state === 'done'
    ? item.summary
    : undefined;
  const Icon = iconForActivity(item);

  return (
    <div className="activity-row" data-state={item.state} data-kind={item.kind}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        disabled={!expandable}
        className="activity-row__button"
        onClick={() => expandable && setOpen(value => !value)}
      >
        <span className="activity-row__icon" aria-hidden="true"><Icon /></span>
        <span className="activity-row__label">
          <span>{item.verb}</span>
          {item.target && <> <span className="activity-row__target">{item.target}</span></>}
          {summary && <> <span className="activity-row__summary">· {summary}</span></>}
        </span>
        {item.stats && <StatsChips stats={item.stats} />}
        {elapsed && <span className="activity-row__elapsed">· {elapsed}</span>}
        {item.state === 'running' && (
          <span className="thinking-dots" aria-hidden="true">
            <span /><span /><span />
          </span>
        )}
        {expandable && <span className="activity-row__chevron" aria-hidden="true">{open ? '⌃' : '⌄'}</span>}
      </button>
      {open && expandable && (
        <div className="activity-row__detail">
          {item.detail?.type === 'markdown' && item.detail.content && (
            <div className="md-body activity-row__markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.detail.content}</ReactMarkdown>
            </div>
          )}
          {item.detail?.type === 'terminal' && (
            <pre className="activity-row__terminal">
              {item.detail.lines?.length
                ? item.detail.lines.map((line, index) => (
                    <span key={`${index}-${line.text}`} data-stream={line.stream}>{line.text}</span>
                  ))
                : <span>{item.detail.placeholder ?? '(no output yet)'}</span>}
              {item.state === 'running' && <span className="stream-caret" />}
            </pre>
          )}
          {item.artifacts?.map((artifact, index) => {
            if (artifact.kind === 'image') {
              return <WorkspaceImage key={`image-${artifact.path}`} path={artifact.path} alt="Generated image" kind="image" />;
            }
            return <ImageJobCard key={`job-${artifact.jobId}-${index}`} jobId={artifact.jobId} expectedCount={artifact.count} />;
          })}
        </div>
      )}
    </div>
  );
}

function StatsChips({ stats }: { stats: ActivityStats }) {
  const hasNumeric = typeof stats.added === 'number' || typeof stats.removed === 'number';
  if (!hasNumeric && !stats.label) return null;
  return (
    <span className="activity-row__stats">
      {typeof stats.added === 'number' && (
        <span className="activity-row__stats-added">+{stats.added}</span>
      )}
      {typeof stats.removed === 'number' && (
        <span className="activity-row__stats-removed">−{stats.removed}</span>
      )}
      {!hasNumeric && stats.label && <span>{stats.label}</span>}
    </span>
  );
}

function useElapsedLabel(active: boolean, startedAt: number): string {
  const [seconds, setSeconds] = useState(() => Math.floor((Date.now() - startedAt) / 1000));

  useEffect(() => {
    if (!active) return;
    const intervalId = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [active, startedAt]);

  return active && seconds >= 4 ? `${seconds}s` : '';
}
```

The previous `glyphFor` helper is deleted.

**Step 4: Update CSS — replace `__glyph` rule and add stats + icon styles**

In `src/index.css`, replace the `.activity-row__glyph` block (lines 194-199) with:

```css
.activity-row__icon {
  flex: 0 0 14px;
  width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: currentColor;
  opacity: 0.85;
}

.activity-row__icon svg {
  width: 14px;
  height: 14px;
}

.activity-row__stats {
  display: inline-flex;
  gap: 6px;
  flex: none;
  font-variant-numeric: tabular-nums;
  opacity: 0.85;
}

.activity-row__stats-added {
  color: color-mix(in srgb, var(--accent) 70%, #6ee7a7);
}

.activity-row__stats-removed {
  color: color-mix(in srgb, #ffaaaa 75%, var(--text-faint));
}
```

Also unify the row font: replace line 169 in `src/index.css`:
```css
  font: 12px/1.45 "Geist Mono", ui-monospace, monospace;
```
with:
```css
  font: 13px/1.5 inherit;
```

And update the target to be link-styled. Replace the `.activity-row__target, .activity-row__summary, .activity-row__elapsed { opacity: 0.78; }` block (around line 208) with:

```css
.activity-row__target {
  color: color-mix(in srgb, var(--accent) 80%, var(--text));
  text-decoration: none;
}

.activity-row__button:hover .activity-row__target {
  text-decoration: underline;
}

.activity-row__summary,
.activity-row__elapsed {
  opacity: 0.78;
}
```

**Step 5: Run tests to verify they pass**

Run: `npm.cmd test -- tests/components/editorial/ActivityStream.test.ts`
Expected: PASS — all old and new cases.

**Step 6: Typecheck + lint**

Run: `npm.cmd run typecheck && npm.cmd run lint`
Expected: clean.

**Step 7: Commit**

```bash
git add src/components/editorial/activity/ActivityRow.tsx src/index.css tests/components/editorial/ActivityStream.test.ts
git commit -m "feat(activity): replace ASCII glyphs with icon component and add stats slot"
```

---

## Task 5: Add a `groupConsecutive` helper

**Files:**
- Create: `src/components/editorial/activity/groupConsecutive.ts`
- Test: `tests/components/editorial/groupConsecutive.test.ts`

**Step 1: Write the failing test**

Create `tests/components/editorial/groupConsecutive.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { groupConsecutive } from '../../../src/components/editorial/activity/groupConsecutive';
import type { ActivityItem } from '../../../src/core/types';

const item = (id: string, groupKey?: string): ActivityItem => ({
  id, kind: 'tool', state: 'done', verb: 'Ran', startedAt: 0, groupKey,
});

describe('groupConsecutive', () => {
  it('returns single-element runs for items with no groupKey', () => {
    const runs = groupConsecutive([item('a'), item('b'), item('c')]);
    expect(runs).toHaveLength(3);
    expect(runs.every(run => run.length === 1)).toBe(true);
  });

  it('groups consecutive same-key items', () => {
    const runs = groupConsecutive([
      item('a', 'shell'),
      item('b', 'shell'),
      item('c', 'shell'),
      item('d'),
      item('e', 'shell'),
    ]);
    expect(runs.map(run => run.map(i => i.id))).toEqual([
      ['a', 'b', 'c'],
      ['d'],
      ['e'],
    ]);
  });

  it('does not group across a non-matching item', () => {
    const runs = groupConsecutive([
      item('a', 'shell'),
      item('b', 'edit'),
      item('c', 'shell'),
    ]);
    expect(runs.map(run => run.map(i => i.id))).toEqual([['a'], ['b'], ['c']]);
  });

  it('returns an empty array for an empty input', () => {
    expect(groupConsecutive([])).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm.cmd test -- tests/components/editorial/groupConsecutive.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement**

Create `src/components/editorial/activity/groupConsecutive.ts`:

```ts
import type { ActivityItem } from '../../../core/types';

export function groupConsecutive(items: ActivityItem[]): ActivityItem[][] {
  const runs: ActivityItem[][] = [];
  for (const item of items) {
    const last = runs[runs.length - 1];
    if (item.groupKey && last && last[0].groupKey === item.groupKey) {
      last.push(item);
    } else {
      runs.push([item]);
    }
  }
  return runs;
}
```

**Step 4: Run test to verify it passes**

Run: `npm.cmd test -- tests/components/editorial/groupConsecutive.test.ts`
Expected: PASS, 4 cases.

**Step 5: Commit**

```bash
git add src/components/editorial/activity/groupConsecutive.ts tests/components/editorial/groupConsecutive.test.ts
git commit -m "feat(activity): add groupConsecutive helper for collapsing same-key runs"
```

---

## Task 6: Add `TimelineGroup` and wire it into `ActivityStream`

**Files:**
- Create: `src/components/editorial/activity/TimelineGroup.tsx`
- Modify: `src/components/editorial/activity/ActivityStream.tsx`
- Modify: `tests/components/editorial/ActivityStream.test.ts`

**Step 1: Write the failing test**

In `tests/components/editorial/ActivityStream.test.ts`, add:

```ts
it('renders a single group row when consecutive items share a groupKey', () => {
  const rendered = render([
    item({ id: 'g1', state: 'done', verb: 'Ran', target: 'echo a', groupKey: 'shell' }),
    item({ id: 'g2', state: 'done', verb: 'Ran', target: 'echo b', groupKey: 'shell' }),
    item({ id: 'g3', state: 'done', verb: 'Ran', target: 'echo c', groupKey: 'shell' }),
  ]);

  const groups = rendered.querySelectorAll('.activity-group');
  expect(groups.length).toBe(1);
  expect(rendered.textContent).toContain('Ran 3 commands');

  act(() => {
    rendered.querySelector('.activity-group .activity-row__button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

  expect(rendered.querySelectorAll('.activity-group__child').length).toBe(3);
});

it('marks the group failed when any child failed', () => {
  const rendered = render([
    item({ id: 'g1', state: 'done', verb: 'Ran', target: 'ok', groupKey: 'shell' }),
    item({ id: 'g2', state: 'failed', verb: 'Ran', target: 'bad', groupKey: 'shell', summary: 'exit 1' }),
  ]);
  expect(rendered.querySelector('.activity-group')?.getAttribute('data-state')).toBe('failed');
});
```

**Step 2: Run test to verify it fails**

Run: `npm.cmd test -- tests/components/editorial/ActivityStream.test.ts`
Expected: FAIL — no `.activity-group` element.

**Step 3: Implement `TimelineGroup`**

Create `src/components/editorial/activity/TimelineGroup.tsx`:

```tsx
import { useState } from 'react';
import type { ActivityItem } from '../../../core/types';
import { ActivityRow } from './ActivityRow';
import { iconForActivity } from './iconForActivity';

export function TimelineGroup({ items }: { items: ActivityItem[] }) {
  const aggregateState = items.some(i => i.state === 'failed')
    ? 'failed'
    : items.some(i => i.state === 'running')
      ? 'running'
      : items.some(i => i.state === 'cancelled')
        ? 'cancelled'
        : 'done';
  const [open, setOpen] = useState(aggregateState === 'failed');
  const Icon = iconForActivity(items[0]);
  const verb = items[0].verb;
  const count = items.length;
  const label = `${verb} ${count} commands`;

  return (
    <div className="activity-group activity-row" data-state={aggregateState}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        className="activity-row__button"
        onClick={() => setOpen(value => !value)}
      >
        <span className="activity-row__icon" aria-hidden="true"><Icon /></span>
        <span className="activity-row__label">
          <span>{verb} {count} commands</span>
        </span>
        <span className="activity-row__chevron" aria-hidden="true">{open ? '⌃' : '⌄'}</span>
      </button>
      {open && (
        <div className="activity-group__children">
          {items.map(child => (
            <div key={child.id} className="activity-group__child">
              <ActivityRow item={child} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 4: Update `ActivityStream` to use the helper**

Replace `src/components/editorial/activity/ActivityStream.tsx` with:

```tsx
import type { ActivityItem } from '../../../core/types';
import { ActivityRow } from './ActivityRow';
import { TimelineGroup } from './TimelineGroup';
import { groupConsecutive } from './groupConsecutive';

export function ActivityStream({ items, header }: { items: ActivityItem[]; header?: string }) {
  if (items.length === 0 && !header) return null;
  const runs = groupConsecutive(items);
  return (
    <div className="activity-stream" aria-label="Assistant activity">
      {header && <div className="activity-stream__header">{header}</div>}
      {runs.map((run, index) =>
        run.length === 1
          ? <ActivityRow key={`${run[0].id}-${index}`} item={run[0]} />
          : <TimelineGroup key={`group-${run[0].id}-${index}`} items={run} />,
      )}
    </div>
  );
}
```

**Step 5: Add group CSS**

Append to the `.activity-*` section of `src/index.css`:

```css
.activity-stream__header {
  font: 11px/1.5 inherit;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-faint);
  opacity: 0.8;
  margin-bottom: 4px;
}

.activity-group__children {
  display: grid;
  gap: 4px;
  margin: 4px 0 4px 22px;
  padding-left: 8px;
  border-left: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
}

.activity-group__child .activity-row__button {
  font-size: 12px;
}
```

**Step 6: Run tests**

Run: `npm.cmd test -- tests/components/editorial/ActivityStream.test.ts`
Expected: PASS, including the two new group cases.

**Step 7: Typecheck**

Run: `npm.cmd run typecheck`
Expected: clean.

**Step 8: Commit**

```bash
git add src/components/editorial/activity/TimelineGroup.tsx src/components/editorial/activity/ActivityStream.tsx src/index.css tests/components/editorial/ActivityStream.test.ts
git commit -m "feat(activity): group consecutive same-key rows and add optional stream header"
```

---

## Task 7: Mark consecutive shell calls with `groupKey` in `activitiesForMessage`

**Files:**
- Modify: `src/stores/ChatStore.ts` (around lines 524-566 in `activitiesForMessage`)
- Modify: `tests/stores/ChatStore.test.ts` (if a matching activity test exists; otherwise extend)

**Step 1: Inspect existing tests**

Run: `npm.cmd test -- tests/stores/ChatStore.test.ts`
Expected: existing tests pass. Note which `activitiesForMessage` tests exist for later guidance.

**Step 2: Write a failing test**

Add to `tests/stores/ChatStore.test.ts` (or create a new describe block if needed) — append a test that calls `activitiesForMessage` on a message with three `terminal` tool calls and asserts each emitted item has `groupKey === 'tool:terminal'`. Use the patterns already present in that file for constructing an `AssistantMessage`. Outline:

```ts
it('marks consecutive terminal tool calls with a shared groupKey', () => {
  const store = /* construct ChatStore as the file's other tests do */;
  const message = /* AssistantMessage with three toolCalls of name 'terminal' and matching results */;
  const items = store.activitiesForMessage(message);
  const shellItems = items.filter(i => i.kind === 'tool');
  expect(shellItems.every(i => i.groupKey === 'tool:terminal')).toBe(true);
});
```

The executor should mirror the helper patterns in [tests/stores/ChatStore.test.ts](tests/stores/ChatStore.test.ts) rather than rebuild a store from scratch. If a similar fixture doesn't exist, the executor may shelve this test and assert via the snapshot already present.

**Step 3: Run to verify it fails**

Run: `npm.cmd test -- tests/stores/ChatStore.test.ts`
Expected: FAIL — `groupKey` is undefined.

**Step 4: Set `groupKey` on the synthesized tool items**

In `src/stores/ChatStore.ts`, inside the `for (const call of message.toolCalls ?? [])` loop (currently around line 545-566), add the `groupKey` field to the pushed object:

```ts
      items.push({
        id: call.id,
        kind: imageJob ? 'image-job' : 'tool',
        state,
        verb: tool?.ui?.verb(call.arguments) ?? 'Using',
        target: tool?.ui?.target?.(call.arguments),
        summary,
        detail: /* unchanged */,
        artifacts,
        startedAt: message.createdAt,
        finishedAt: result?.ranAt,
        toolCallId: call.id,
        groupKey: imageJob ? undefined : `tool:${call.name}`,
      });
```

Only tool calls of the same name in immediate sequence will collapse. Image-job rows do not group.

**Step 5: Run tests to verify they pass**

Run: `npm.cmd test`
Expected: PASS across the suite.

**Step 6: Commit**

```bash
git add src/stores/ChatStore.ts tests/stores/ChatStore.test.ts
git commit -m "feat(activity): tag tool-call rows with a per-tool groupKey for collapsing"
```

---

## Task 8: Surface diff stats on edit-type tool calls

**Files:**
- Modify: `src/stores/ChatStore.ts` (same `activitiesForMessage` loop)
- Reference: any existing `tool.ui` definitions to confirm shape — grep for `ui: {` in `src/tools/` if present.

**Step 1: Locate the tool registry**

Run: Grep tool for `toolRegistry` and `ui:` to find where each tool defines its ui-facing helpers.

Run: `Grep` for `verb:.*=>.*'Edit'` (or similar) to find the edit tool.

**Step 2: Add an optional `stats` hook on `tool.ui`**

Find the tool ui interface (likely in `src/tools/types.ts` or `src/tools/registry.ts`). Add an optional method:

```ts
stats?: (args: unknown, result?: { content: string }) => ActivityStats | undefined;
```

(Import `ActivityStats` from `../core/types`.)

**Step 3: Implement for the edit/write tool**

Find the file-edit tool (likely named `edit_file`, `write_file`, or similar). Add a `stats` method that:

1. Reads the diff from the result content (if the tool emits an `added`/`removed` summary line) **or**
2. Counts `+` / `-` line prefixes in the content.

If the result format does not include line-level diffs, the executor should keep `stats` as a freeform `{ label: 'N bytes' }` fallback, or skip this task and document it as a follow-up. **Do not invent a diff parser** if one is not already producing the data.

**Step 4: Read stats inside `activitiesForMessage`**

In the same `for (const call of message.toolCalls ?? [])` block in `ChatStore.ts`, after computing `summary`, compute:

```ts
const stats = result ? tool?.ui?.stats?.(call.arguments, { content: result.content }) : undefined;
```

And include `stats` on the pushed `ActivityItem`:

```ts
        ...,
        stats,
        groupKey: imageJob ? undefined : `tool:${call.name}`,
```

**Step 5: Tests**

If the edit tool already has unit tests, add a case verifying its `ui.stats` returns the expected `{ added, removed }`. If not, this task is acceptable to ship without a new test — the rendering of `stats` is already covered by Task 4's stats tests.

**Step 6: Run full suite**

Run: `npm.cmd test`
Expected: PASS.

**Step 7: Commit**

```bash
git add src/stores/ChatStore.ts src/tools/
git commit -m "feat(activity): surface diff stats chips for file-edit tool rows"
```

> **Acceptance gate:** if the tool result format does not carry diff information, ship this task as no-op (don't add a stats hook anywhere) and note it in the PR description as deferred. The redesign does not depend on this task.

---

## Task 9: Promote the thinking row visually

**Files:**
- Modify: `src/index.css`
- Modify: `src/stores/ChatStore.ts` (small label adjustment)

The thinking row is already created in `activitiesForMessage` (lines 508-521 and 570-579). This task makes it visually distinguishable.

**Step 1: Adjust the synthesized verb so the thinking row reads cleanly**

In `ChatStore.ts` around line 515, leave `verb: 'Thinking'` as-is. In the pre-token streaming block around line 576, ensure the verb capitalization remains. No code change here unless the executor notices a wording bug.

**Step 2: Style the thinking row distinctly**

Append to `src/index.css`:

```css
.activity-row[data-kind="thinking"] .activity-row__button {
  color: color-mix(in srgb, var(--text-faint) 70%, var(--text));
  font-style: italic;
}

.activity-row[data-kind="thinking"] .activity-row__icon {
  opacity: 0.7;
}

.activity-row[data-kind="thinking"][data-state="running"] .activity-row__button {
  font-style: normal;
}
```

**Step 3: Manual smoke (optional)**

Start the dev server with `npm.cmd run dev` and send a prompt that produces thinking notes. Confirm the thinking row is italic, has the brain icon, and expands to show the notes. Document in the PR description, no automated check needed.

**Step 4: Commit**

```bash
git add src/index.css
git commit -m "feat(activity): give thinking rows a distinct muted italic treatment"
```

---

## Task 10: Add a snapshot smoke test that the full stream renders without regressions

**Files:**
- Modify: `tests/components/editorial/ActivityStream.test.ts`

**Step 1: Add the regression test**

Append:

```ts
it('renders header, thinking, group, and standalone rows together', () => {
  const rendered = render([
    item({ id: 't1', kind: 'thinking', state: 'done', verb: 'Thinking', detail: { type: 'markdown', content: 'Reasoned about X.' } }),
    item({ id: 's1', kind: 'tool', state: 'done', verb: 'Ran', target: 'echo a', groupKey: 'tool:terminal' }),
    item({ id: 's2', kind: 'tool', state: 'done', verb: 'Ran', target: 'echo b', groupKey: 'tool:terminal' }),
    item({ id: 'e1', kind: 'tool', state: 'done', verb: 'Editing', target: 'foo.ts', stats: { added: 6, removed: 1 } }),
  ]);

  expect(rendered.querySelector('[data-kind="thinking"]')).not.toBeNull();
  expect(rendered.querySelector('.activity-group')).not.toBeNull();
  expect(rendered.textContent).toContain('Editing');
  expect(rendered.textContent).toContain('+6');
});
```

Update the `render` helper at the top of the test file to forward an optional `header` prop:

```ts
function render(items: ActivityItem[], header?: string) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(createElement(ActivityStream, { items, header }));
  });
  return host;
}
```

Then add:

```ts
it('renders an optional header above the stream', () => {
  const rendered = render([item({ id: 'a', state: 'done' })], 'Worked on');
  expect(rendered.querySelector('.activity-stream__header')?.textContent).toBe('Worked on');
});
```

**Step 2: Run**

Run: `npm.cmd test -- tests/components/editorial/ActivityStream.test.ts`
Expected: PASS.

**Step 3: Commit**

```bash
git add tests/components/editorial/ActivityStream.test.ts
git commit -m "test(activity): cover combined stream rendering and header slot"
```

---

## Task 11: Full CI gate, manual smoke, and PR

**Step 1: Run the full CI gate**

Run: `npm.cmd run ci`
Expected: clean — tests, typecheck, lint all pass.

**Step 2: Manual smoke**

Run: `npm.cmd run dev`. In a browser:

1. Send a prompt that triggers a tool call → row shows the right icon, link-styled target, and chevron on hover.
2. Send a prompt that triggers 2+ consecutive terminal calls → they collapse into one "Ran N commands" group; expanding shows children with their own expanders.
3. Send a prompt that produces an edit → diff stats chips appear (assuming Task 8 landed).
4. Watch a streaming response → the streaming thinking row shows the brain icon, italic-off animation dots, and on completion stays expandable to reveal `workNotes`.
5. Confirm copy / branch / regenerate buttons all still work on assistant messages.

**Step 3: Commit any final touch-ups**

If any manual smoke uncovered a visual snag, fix it and commit:

```bash
git commit -m "fix(activity): <short description>"
```

**Step 4: Push and open a PR**

```bash
git push -u origin claude/stoic-moore-920c24
gh pr create --title "Activity timeline redesign: unified row primitive" --body "$(cat <<'EOF'
## Summary
- Generalize ActivityRow into a slotted primitive with icons (no more ASCII glyphs), link-styled target, stats chips, and elapsed/chevron meta.
- Group consecutive same-key tool rows into a single `Ran N commands` parent with nested children.
- Add an optional muted `TimelineHeader` slot above the stream.
- Tag tool rows with a per-tool `groupKey` so the grouping is data-driven, not visual-only.
- Give thinking rows a distinct italic / muted treatment so they read as reasoning, not action.

## Test plan
- [ ] `npm run ci` passes locally
- [ ] Streaming message: thinking row animates and resolves
- [ ] 3 consecutive terminal calls collapse into one group; expansion works
- [ ] Edit tool call shows `+N −N` chips (or label fallback)
- [ ] Copy / branch / regenerate buttons still work
- [ ] No visual regression in messages with only one event

Design: `docs/plans/2026-05-17-activity-timeline-redesign-design.md`
EOF
)"
```

Return the PR URL.

---

## Rollback strategy

If something visually breaks in production:

1. Revert the merge commit on master.
2. The data-model fields (`stats`, `groupKey`) are optional — leaving them in master with rendering reverted is harmless.

---

## Follow-ups (not in this PR)

1. True prose-interleaving (Approach A from the design doc).
2. Persist per-row expanded state across reloads.
3. Per-tool affordances (Open in editor, Re-run, Copy command) using the existing slots.

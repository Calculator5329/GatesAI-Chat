# Activity Timeline Redesign — Design

**Date:** 2026-05-17
**Status:** Approved (Approach C, current palette)
**Inspiration:** Claude's own assistant UI — interleaved row design where tool calls, thinking, and prose share one cohesive visual language.

## Goal

Bring the assistant activity timeline up to a consistent, well-designed standard. Today, each activity row is a single-line ASCII glyph stamp; tool calls, thinking, and prose feel like three different products glued together. After this change, every event type (thinking, tool call, image job, bridge event, edits with diff stats) renders through one row primitive with shared icons, typography, slots, and expand behavior — and the stream as a whole can be introduced by an optional muted section header. Thinking becomes a first-class, expandable artifact rather than a transient pre-token pill.

We are explicitly **not** doing true prose-interleaving in this pass. Events still sit above the assistant prose. Interleaving is tracked as a follow-up that becomes much smaller once the row primitive exists.

## Non-goals

- No change to the message data model on disk. `ActivityItem` gains optional fields; nothing is removed.
- No change to copy / branch / regenerate behavior.
- No change to streaming semantics or `preTokenLabel` lifecycle. The thinking row reads from the same sources.
- No new color palette. We keep the current dark theme and `--accent` tinting.
- No persistence of "expanded" state across reloads in this pass.

## Approach C in one paragraph

Generalize `ActivityRow` into a `TimelineRow` primitive with named slots. Promote thinking from a transient pill into a real expandable row driven by `workNotes` and the pre-token lifecycle. Group consecutive same-tool rows behind a single "Ran N commands" parent. Add an optional `TimelineHeader` for muted section labels. Replace ASCII glyphs with a small inline SVG icon set. Add a stats slot so file edits can render `+6 -1` chips. Unify type and spacing inside the stream so it reads as part of the message rather than a separate widget.

## Architecture

### Component tree

```
ActivityStream
├─ TimelineHeader      (optional, one per stream)
└─ TimelineRow[]       (the row primitive)
   ├─ TimelineRow      (single event)
   └─ TimelineGroup    (grouped run of same-tool rows; renders as a TimelineRow whose detail is a nested TimelineRow[])
```

`TimelineRow` is the only thing that actually renders a row. `TimelineGroup` is a thin wrapper that selects icon, count label, and aggregated state from its children and reuses `TimelineRow` for both the parent and each child.

### `TimelineRow` slots

| Slot | Purpose | Source |
|---|---|---|
| `icon` | 14px inline SVG, state-tinted | mapped from `ActivityKind` |
| `title` | Verb (e.g. "Editing", "Ran", "Thinking") | `item.verb` |
| `target` | Link-styled inline target (filename, URL, command) | `item.target` |
| `stats` | Inline meta chip (`+6 -1`, `2 files`) | new `item.stats` |
| `meta` | Right-aligned muted text (elapsed, count) | derived |
| `state` | Visual treatment for running / done / failed / cancelled | `item.state` |
| `detail` | Expandable body (markdown / terminal / nested rows / artifacts) | `item.detail`, `item.artifacts`, children for groups |

A row is expandable iff it has a detail body, artifacts, or — for groups — children. The chevron renders only when expandable, with the existing opacity-on-hover treatment.

### Data model additions

All optional, all backward compatible. No migrations.

```ts
// src/core/types.ts
export type ActivityKind =
  | 'thinking'
  | 'tool'
  | 'image-job'
  | 'exec-tail'
  | 'bridge'
  | 'reasoning';        // NEW — drives the Thinking row

export interface ActivityItem {
  // ...existing fields...
  /** Inline diff/count chips. Rendered between target and elapsed. */
  stats?: ActivityStats;
  /** Stable grouping key. Consecutive rows sharing this key collapse into one parent. */
  groupKey?: string;
}

export interface ActivityStats {
  added?: number;
  removed?: number;
  /** Free-form label when added/removed don't apply. e.g. "3 files", "1.2 KB". */
  label?: string;
}
```

The thinking row is synthesized at render time from `message.workNotes` and `message.preTokenLabel`. It is not persisted into `activityEvents` — keeping the data model untouched and avoiding double-storage.

### Stream composition (pseudo)

```
function ActivityStream({ items, header, thinking }) {
  const rows = []
  if (thinking) rows.push(<TimelineRow {...thinking} />)
  for (const run of groupConsecutive(items, byGroupKey)) {
    rows.push(run.length === 1 ? <TimelineRow ... /> : <TimelineGroup ... />)
  }
  return <div className="activity-stream">{header && <TimelineHeader … />} {rows}</div>
}
```

`groupConsecutive` only collapses runs of length ≥ 2 with the same `groupKey`. Single rows render unchanged.

### Icon set

Add to [src/components/ui/icons.tsx](src/components/ui/icons.tsx):

| Icon | Used for kinds | Symbolism |
|---|---|---|
| `Brain` | `reasoning` | Thinking |
| `Pencil` | `tool` (file edits) | Edit |
| `FileText` | `tool` (file reads) | Read |
| `Terminal` | `tool` (shell), `exec-tail` | Command |
| `Search` | `tool` (search/grep) | Lookup |
| `Image` | `image-job` | Image |
| `Plug` | `bridge` | Connectivity |
| `Wrench` | `tool` (generic fallback) | Generic |

Icon picked by `(kind, toolName)` with a small lookup table. State colors come from the existing `--accent` / failure-red tokens — no new palette work.

### CSS

All changes inside the `.activity-*` block in [src/index.css](src/index.css). No new files. Key updates:

- Row baseline grid: icon column 14px, gap 8px, line-height 1.5
- `.activity-row__target` becomes a link-styled span (underline on hover, `color: var(--accent)`)
- New `.activity-row__stats` with two paired chips for `+N` (green-tinted) / `−N` (red-tinted) using `color-mix` against `--accent`/`--text-faint` to stay on-palette
- `TimelineGroup`'s nested rows render at `margin-left: 18px` matching the existing detail indent
- Drop the Geist font-family override inside the row; inherit from the message container so prose and rows share one type stack

### Failure & edge cases

- **No header, no thinking, no rows** → render nothing (current behavior preserved).
- **Only a thinking row, no events** → render the thinking row alone; do not show the group container.
- **A group whose children all completed cleanly** → parent state is `done`, single elapsed = max child elapsed.
- **A group with any failed child** → parent state is `failed`, fails closed (chevron expanded by default on first render of a failed group).
- **Streaming thinking with empty `workNotes`** → row shows the `preTokenLabel` ("thinking", "responding", …) and the existing three-dot animation; detail body says "(no notes yet)".

## Testing

[tests/components/editorial/ActivityStream.test.ts](tests/components/editorial/ActivityStream.test.ts) gains cases for:

1. Grouping: three consecutive `exec-tail` rows with the same `groupKey` render one parent with three children inside the detail.
2. Stats: a tool row with `stats: { added: 6, removed: 1 }` renders `+6 −1` chips.
3. Thinking: rendering with `workNotes = ['note one', 'note two']` produces an expandable reasoning row whose detail contains both notes.
4. Failed group: a group containing one failed child renders state=`failed` and opens expanded.
5. Backwards compatibility: an `ActivityItem` with no `stats` and no `groupKey` renders identically to today (snapshot or DOM assertions).

No new e2e tests in this pass — the existing manual smoke (send a message that triggers tool calls, expand each row, confirm thinking expands) is enough.

## Rollout

One PR. No flag. The component swap is internal; visual diff is the entire point. Reviewers should spot-check:

- A streaming message mid-tool-call still shows the running dots.
- A message that contains both image-job artifacts and prose still renders the artifacts after expansion.
- Copy / branch / regenerate buttons still work on assistant messages.

## Follow-ups (not in this pass)

1. **True interleaved timeline (Approach A).** Once the row primitive exists, splitting prose into chunks and interleaving them with rows in chronological order becomes a localized change to `EditorialMessage`, not a redesign.
2. **Persistent expanded state.** Persist per-row open/closed state to the same UI prefs store that already debounces saves.
3. **Per-tool affordances.** "Open in editor" link on edit rows, "Re-run" on shell rows, "Copy command" on terminals. Slots already exist; just need wire-up.

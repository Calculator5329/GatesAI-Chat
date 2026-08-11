// Builds the reviewable diff artifact attached to assistant file edits.
// Called by the fs tool after a successful write; depends on the pure line
// differ and core artifact contracts.
// Invariant: the artifact is a bounded preview — it never grows with file size,
// because it is persisted inside the message.
import type { DiffRow, ToolResultArtifact } from '../../core/types';
import { diffLines } from './lineDiff';

/**
 * Rows kept in a persisted diff artifact. Big enough to review a normal edit
 * at a glance, small enough that a thread of them stays cheap to store.
 */
export const DIFF_PREVIEW_MAX_ROWS = 60;
/** Context lines kept either side of a change when trimming. */
const CONTEXT_RADIUS = 2;
/** Longer lines are elided: one pathological minified line must not blow up the record. */
const MAX_LINE_CHARS = 400;

export function buildDiffArtifact(
  path: string,
  before: string,
  after: string,
  maxRows = DIFF_PREVIEW_MAX_ROWS,
): ToolResultArtifact | null {
  if (before === after) return null;
  const rows = diffLines(before, after);
  let added = 0;
  let removed = 0;
  for (const row of rows) {
    if (row.type === 'added') added += 1;
    if (row.type === 'removed') removed += 1;
  }
  const focused = focusChangedRegions(rows, maxRows);
  return {
    kind: 'diff',
    path,
    added,
    removed,
    rows: focused.rows.map(clampRow),
    truncated: focused.truncated,
  };
}

/**
 * Keeps changed lines plus a little context and drops long runs of untouched
 * text, then hard-caps the result. A 4-line change in a 2,000-line file should
 * render as a 4-line change.
 */
function focusChangedRegions(rows: DiffRow[], maxRows: number): { rows: DiffRow[]; truncated: boolean } {
  const keep = new Array<boolean>(rows.length).fill(false);
  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index].type === 'context') continue;
    const from = Math.max(0, index - CONTEXT_RADIUS);
    const to = Math.min(rows.length - 1, index + CONTEXT_RADIUS);
    for (let near = from; near <= to; near += 1) keep[near] = true;
  }
  const kept: DiffRow[] = [];
  let truncated = false;
  for (let index = 0; index < rows.length; index += 1) {
    if (!keep[index]) { truncated = true; continue; }
    if (kept.length >= maxRows) { truncated = true; break; }
    kept.push(rows[index]);
  }
  return { rows: kept, truncated };
}

function clampRow(row: DiffRow): DiffRow {
  if (row.text.length <= MAX_LINE_CHARS) return row;
  return { ...row, text: `${row.text.slice(0, MAX_LINE_CHARS)}…` };
}

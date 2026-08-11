// Aurora pack: an assistant file edit, rendered for review.
// Rendered by AuroraActivityStream when a tool result carries a diff artifact.
// Invariant: presentation only — the file on disk is the source of truth and
// this card never claims to be the whole change when `truncated` is set.
import { useState } from 'react';
import type { DiffRow, ToolResultArtifact } from '../../../core/types';

type DiffArtifact = Extract<ToolResultArtifact, { kind: 'diff' }>;

/** Rows shown before the card collapses behind a "show all" control. */
const COLLAPSED_ROWS = 14;

export function DiffCard({ artifact }: { artifact: DiffArtifact }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? artifact.rows : artifact.rows.slice(0, COLLAPSED_ROWS);
  const hidden = artifact.rows.length - visible.length;
  const name = artifact.path.split('/').filter(Boolean).pop() ?? artifact.path;

  return (
    <div className="aurora-diff" data-testid="aurora-diff-card">
      <div className="aurora-diff__head">
        <span className="aurora-diff__name" title={artifact.path}>{name}</span>
        <span className="aurora-diff__path">{artifact.path}</span>
        <span className="aurora-chip aurora-chip--add">+{artifact.added}</span>
        <span className="aurora-chip aurora-chip--remove">−{artifact.removed}</span>
      </div>
      <table className="aurora-diff__table">
        <tbody>
          {visible.map((row, index) => (
            <DiffLine key={`${row.type}-${index}-${lineNumberOf(row)}`} row={row} />
          ))}
        </tbody>
      </table>
      {(hidden > 0 || artifact.truncated) && (
        <div className="aurora-diff__foot">
          {hidden > 0 && (
            <button type="button" onClick={() => setExpanded(true)}>
              Show {hidden} more {hidden === 1 ? 'line' : 'lines'}
            </button>
          )}
          {artifact.truncated && (
            <span className="aurora-diff__note">Preview only — unchanged regions omitted.</span>
          )}
        </div>
      )}
    </div>
  );
}

function DiffLine({ row }: { row: DiffRow }) {
  const sign = row.type === 'added' ? '+' : row.type === 'removed' ? '−' : ' ';
  return (
    <tr data-type={row.type}>
      <td className="aurora-diff__gutter">{row.type === 'added' ? '' : row.oldLine}</td>
      <td className="aurora-diff__gutter">{row.type === 'removed' ? '' : row.newLine}</td>
      <td className="aurora-diff__sign" aria-hidden="true">{sign}</td>
      <td className="aurora-diff__text">{row.text || ' '}</td>
    </tr>
  );
}

function lineNumberOf(row: DiffRow): number {
  return row.type === 'removed' ? row.oldLine : row.newLine;
}

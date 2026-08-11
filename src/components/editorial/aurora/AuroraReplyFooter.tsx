// Aurora pack: what sits under a finished assistant reply — the sources it
// drew on, and one-click follow-ups it offered.
// Rendered by EditorialMessage when the Aurora pack is active.
// Invariant: every chip here is derived from real turn data. Sources come from
// the recorded retrieval trace; follow-ups are quoted from the reply itself.
import type { RetrievalTrace } from '../../../core/types';
import { deriveFollowUps } from '../../../core/followUps';

export function AuroraReplyFooter({
  content,
  trace,
  onAsk,
  onOpenSources,
}: {
  content: string;
  trace?: RetrievalTrace;
  onAsk?: (text: string) => void;
  onOpenSources?: () => void;
}) {
  const followUps = onAsk ? deriveFollowUps(content) : [];
  const sources = trace?.items ?? [];
  if (followUps.length === 0 && sources.length === 0) return null;

  return (
    <div className="aurora-reply-footer">
      {sources.length > 0 && (
        <div className="aurora-sources">
          <button
            type="button"
            className="aurora-chip aurora-chip--muted"
            onClick={onOpenSources}
            disabled={!onOpenSources}
          >
            {sources.length} {sources.length === 1 ? 'source' : 'sources'}
          </button>
          {sources.slice(0, 4).map(item => (
            <span key={item.reference} className="aurora-source-chip" title={item.excerpt}>
              <span className="aurora-source-chip__kind">{item.sourceType}</span>
              <span className="aurora-source-chip__label">{sourceLabel(item.title ?? item.reference)}</span>
            </span>
          ))}
          {sources.length > 4 && <span className="aurora-chip aurora-chip--muted">+{sources.length - 4}</span>}
        </div>
      )}
      {followUps.length > 0 && (
        <div className="aurora-followups" aria-label="Follow-ups the assistant offered">
          {followUps.map(text => (
            <button key={text} type="button" className="aurora-followup" onClick={() => onAsk?.(text)}>
              {text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Trims a reference down to something that fits a chip. */
function sourceLabel(reference: string): string {
  const tail = reference.split('/').filter(Boolean).pop() ?? reference;
  return tail.length > 34 ? `${tail.slice(0, 33)}…` : tail;
}

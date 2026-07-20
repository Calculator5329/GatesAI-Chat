import { useState } from 'react';
import type { RetrievalTrace, RetrievalTraceItem } from '../../core/types';
import { Icons } from '../ui/icons';

export function MemoryDisclosure({
  trace,
  excludedReferences,
  canOpenThread,
  onOpenThread,
  onOpenManager,
  onExclude,
  onInclude,
}: {
  trace: RetrievalTrace;
  excludedReferences: string[];
  canOpenThread: (threadId: string) => boolean;
  onOpenThread: (threadId: string) => void;
  onOpenManager: () => void;
  onExclude: (reference: string) => void;
  onInclude: (reference: string) => void;
}) {
  const [selectedReference, setSelectedReference] = useState<string | null>(null);
  const [confirmingReference, setConfirmingReference] = useState<string | null>(null);
  const [showWhy, setShowWhy] = useState(false);
  if (trace.items.length === 0) return null;

  const selected = trace.items.find(item => item.reference === selectedReference);
  const selectedExclusion = selected ? exclusionReference(selected) : null;
  const selectedExcluded = selectedExclusion ? excludedReferences.includes(selectedExclusion) : false;

  const choose = (reference: string) => {
    setSelectedReference(current => current === reference ? null : reference);
    setConfirmingReference(null);
    setShowWhy(false);
  };

  return (
    <div className="memory-disclosure" aria-label={`${trace.items.length} memories supplied as context`}>
      <div className="memory-disclosure__chips">
        {trace.items.map(item => (
          <button
            type="button"
            className="memory-disclosure__chip"
            data-selected={selectedReference === item.reference || undefined}
            key={item.reference}
            aria-expanded={selectedReference === item.reference}
            onClick={() => choose(item.reference)}
          >
            <MemoryTypeIcon sourceType={item.sourceType} />
            <span>{sourceLabel(item)}</span>
          </button>
        ))}
      </div>

      {selected && selectedExclusion && (
        <div className="memory-disclosure__detail">
          <div className="memory-disclosure__meta">
            <span>{sourceTypeLabel(selected.sourceType)}</span>
            {selected.role && <span>{selected.role === 'user' ? 'You' : 'Assistant'}</span>}
            <span>{new Date(selected.sourceTimestamp).toLocaleDateString()}</span>
          </div>
          <blockquote>{selected.excerpt}</blockquote>
          {showWhy && (
            <div className="memory-disclosure__why">
              {whyUsed(selected)} This is a retrieval ranking—not proof that it caused the answer.
            </div>
          )}
          <div className="memory-disclosure__actions">
            {selected.threadId && canOpenThread(selected.threadId) ? (
              <button type="button" onClick={() => onOpenThread(selected.threadId!)}>Open source</button>
            ) : selected.sourceType === 'message' ? (
              <button type="button" disabled>Source unavailable</button>
            ) : (
              <button type="button" onClick={onOpenManager}>Open in Memory</button>
            )}
            <button type="button" aria-expanded={showWhy} onClick={() => setShowWhy(value => !value)}>Why was this used?</button>
            {selectedExcluded ? (
              <button type="button" onClick={() => onInclude(selectedExclusion)}>Undo exclusion</button>
            ) : confirmingReference === selected.reference ? (
              <>
                <span>Stop using this source?</span>
                <button type="button" onClick={() => setConfirmingReference(null)}>Cancel</button>
                <button
                  type="button"
                  data-tone="danger"
                  onClick={() => {
                    onExclude(selectedExclusion);
                    setConfirmingReference(null);
                  }}
                >Exclude</button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmingReference(selected.reference)}>Don&apos;t use this source</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function exclusionReference(item: RetrievalTraceItem): string {
  if (item.sourceType === 'message' && item.threadId) return `thread:${item.threadId}`;
  return `${item.sourceType}:${item.sourceId}`;
}

function sourceLabel(item: RetrievalTraceItem): string {
  const title = item.title?.trim();
  if (title) return `${sourceTypeLabel(item.sourceType)} · ${title}`;
  if (item.sourceType === 'memory') return `Saved fact · ${compact(item.excerpt, 42)}`;
  return `${sourceTypeLabel(item.sourceType)} · ${compact(item.excerpt, 42)}`;
}

function sourceTypeLabel(sourceType: RetrievalTraceItem['sourceType']): string {
  if (sourceType === 'message') return 'Conversation';
  if (sourceType === 'note') return 'Note';
  return 'Saved fact';
}

function MemoryTypeIcon({ sourceType }: { sourceType: RetrievalTraceItem['sourceType'] }) {
  if (sourceType === 'memory') return <Icons.Brain />;
  return <Icons.FileText />;
}

function whyUsed(item: RetrievalTraceItem): string {
  if (item.lexicalRank && item.denseRank) return `Matched both wording and meaning; selected at rank ${item.fusedRank}.`;
  if (item.lexicalRank) return `Matched wording or an exact identifier; selected at rank ${item.fusedRank}.`;
  if (item.denseRank) return `Matched meaning; selected at rank ${item.fusedRank}.`;
  return `Ranked among the most relevant local sources at position ${item.fusedRank}.`;
}

function compact(value: string, max: number): string {
  const oneLine = value.replace(/\s+/g, ' ').trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

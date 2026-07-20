// Renders the Agent menu section and the controls for its store-backed workflow.
// Called by GatesMenu; depends on MobX stores and shared UI primitives.
// Invariant: menu components present state and delegate side effects to stores/services.
import { useState, type CSSProperties } from 'react';
import { observer } from 'mobx-react-lite';
import { tokens } from '../../../core/styleTokens';
import { Button, Input, Textarea, Toggle } from '../../ui';
import { Icons } from '../../ui/icons';
import { useRootStore, useUserProfileStore } from '../../../stores/context';
import { isWebLite } from '../../../core/runtime';

export const AgentSection = observer(function AgentSection() {
  const profile = useUserProfileStore();

  const promptLen = profile.defaultSystemPrompt.trim().length;
  const factCount = profile.facts.length;

  return (
    <>
      <h1 style={tokens.h1}>Agent</h1>
      <div style={tokens.kicker}>
        instructions {promptLen ? 'set' : 'empty'} · {factCount} memor{factCount === 1 ? 'y' : 'ies'}
      </div>

      <div style={tokens.section}>
        <div style={tokens.sectionTitle}>Instructions</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 10, lineHeight: 1.55 }}>
          A system prompt sent on every turn. Tells the model how to behave —
          tone, role, format preferences, things to avoid.
        </div>
        <Textarea
          value={profile.defaultSystemPrompt}
          onChange={e => profile.setDefaultSystemPrompt(e.target.value)}
          placeholder="You are a thoughtful collaborator. Answer precisely, prefer simple direct language, and explain tradeoffs before writing code."
          style={{
            minHeight: 130,
            fontFamily: '"Source Serif 4", Georgia, serif',
            fontSize: 14, lineHeight: 1.55, resize: 'vertical',
          }}
        />
      </div>

      <MemorySection />
    </>
  );
});

const MemorySection = observer(function MemorySection() {
  const profile = useUserProfileStore();
  const facts = profile.facts;
  const [draft, setDraft] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState('');

  const onAdd = () => {
    if (!draft.trim()) return;
    profile.addFact(draft);
    setDraft('');
  };

  const startEdit = (index: number, value: string) => {
    setEditingIndex(index);
    setEditText(value);
  };
  const saveEdit = () => {
    if (editingIndex === null) return;
    profile.updateFactAt(editingIndex, editText);
    setEditingIndex(null);
    setEditText('');
  };
  const cancelEdit = () => { setEditingIndex(null); setEditText(''); };

  return (
    <div style={tokens.section}>
      <div style={tokens.sectionTitle}>
        Memory
      </div>
      <div style={{ ...subsectionTitleStyle, marginTop: 4 }}>
        Saved facts · {facts.length}
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 14, lineHeight: 1.55 }}>
        Always supplied to the assistant. You can edit or delete anything here.
      </div>

      {facts.length === 0 ? (
        <div style={emptyBoxStyle}>
          No memories yet. Tell the assistant something to remember, or add one below.
        </div>
      ) : (
        <div style={{ marginBottom: 14, display: 'flex', flexDirection: 'column' }}>
          {facts.map((fact, i) => {
            const isEditing = editingIndex === i;
            return (
              <div
                key={i}
                style={{
                  display: 'grid', gridTemplateColumns: '24px 1fr auto',
                  gap: 12, alignItems: 'center',
                  padding: '10px 0',
                  borderBottom: i === facts.length - 1 ? 'none' : '1px solid var(--border)',
                }}
              >
                <span style={{ ...tokens.mono, color: 'var(--text-faint)', textAlign: 'right' }}>{i + 1}</span>
                {isEditing ? (
                  <Input
                    autoFocus
                    value={editText}
                    onChange={e => setEditText(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') saveEdit();
                      else if (e.key === 'Escape') cancelEdit();
                    }}
                  />
                ) : (
                  <span style={{
                    fontFamily: '"Source Serif 4", Georgia, serif',
                    fontSize: 14.5, lineHeight: 1.5, color: 'var(--text)',
                  }}>{fact}</span>
                )}
                <div style={rowActions}>
                  {isEditing ? (
                    <>
                      <button type="button" className="menu-icon-button" style={iconBtn} onClick={saveEdit} title="Save">save</button>
                      <button type="button" className="menu-icon-button" style={iconBtn} onClick={cancelEdit} title="Cancel">cancel</button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="menu-icon-button" style={iconBtn} onClick={() => startEdit(i, fact)} title="Edit">edit</button>
                      <button type="button" className="menu-icon-button" data-tone="danger" style={{ ...iconBtn, color: 'var(--text-faint)' }} onClick={() => profile.removeFactAt(i)} title="Delete">delete</button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <Input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onAdd(); }}
          placeholder='Add a memory · "User prefers concise answers"'
          style={{ flex: 1 }}
        />
        <Button onClick={onAdd}>Add</Button>
      </div>

      {facts.length > 0 && (
        <div style={{ marginTop: 12, textAlign: 'right' }}>
          <button
            type="button"
            className="menu-icon-button"
            data-tone="danger"
            style={{ ...iconBtn, color: 'var(--text-faint)', fontSize: 11 }}
            onClick={() => {
              if (window.confirm(`Delete all ${facts.length} memories? This can't be undone.`)) {
                profile.clearFacts();
              }
            }}
          >
            Clear all
          </button>
        </div>
      )}

      <KnowledgeLibrarySection />
      <SemanticRecallSection />
    </div>
  );
});

const KnowledgeLibrarySection = observer(function KnowledgeLibrarySection() {
  const { library, bridge } = useRootStore();
  if (isWebLite()) {
    return (
      <div style={semanticBlockStyle}>
        <div style={subsectionTitleStyle}>Knowledge library</div>
        <div style={detailStyle}>Local documents and databases are available in the desktop app.</div>
      </div>
    );
  }
  return (
    <div style={semanticBlockStyle}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={subsectionTitleStyle}>Knowledge library</div>
          <div style={detailStyle}>
            Approve workspace documents for recall. SQLite sources expose schema only until you ask for a bounded read-only query.
          </div>
        </div>
        <Button disabled={!bridge.isOnline} onClick={() => void library.pickAndAdd()}>Add source</Button>
      </div>
      <div style={statusRowStyle}>
        <span style={{ color: bridge.isOnline ? 'var(--accent)' : 'var(--danger)' }}>{bridge.isOnline ? 'Local workspace ready' : 'Bridge offline'}</span>
        <span>{library.readyCount}/{library.activeSources.length} ready</span>
        {library.sources.length > 0 && <button type="button" style={quietButtonStyle} disabled={library.refreshing || !bridge.isOnline} onClick={() => void library.refreshAll()}>{library.refreshing ? 'Refreshing…' : 'Refresh'}</button>}
      </div>
      {library.lastError && <div style={{ ...detailStyle, color: 'var(--danger)', marginTop: 8 }}>{library.lastError}</div>}
      {library.sources.length === 0 ? (
        <div style={{ ...emptyBoxStyle, marginTop: 12, marginBottom: 0 }}>
          No sources yet. Add text, Markdown, structured text, or SQLite files from the current workspace.
        </div>
      ) : (
        <div style={{ marginTop: 10, borderTop: '1px solid var(--border)' }}>
          {library.sources.map(source => (
            <div key={source.id} style={{ ...sourceGroupRowStyle, borderBottom: '1px solid var(--border)' }}>
              <div style={{ minWidth: 0 }}>
                <div title={source.path} style={sourceItemLabelStyle}>{source.title}</div>
                <div style={detailStyle}>
                  {source.kind === 'database' ? 'SQLite schema' : 'Document'} · {source.status}{source.error ? ` · ${source.error}` : ''}
                </div>
              </div>
              <Toggle on={source.enabled} onChange={value => library.setEnabled(source.id, value)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

type SemanticSourceType = 'message' | 'note' | 'memory' | 'library';
type PreviewItem = {
  reference: string;
  sourceType: SemanticSourceType;
  title?: string;
  excerpt: string;
};

const SemanticRecallSection = observer(function SemanticRecallSection() {
  const root = useRootStore();
  const { rag, chat, notes, profile, ollama, library } = root;
  const [expandedType, setExpandedType] = useState<SemanticSourceType | null>(null);
  const [sourceQuery, setSourceQuery] = useState('');
  const [previewQuery, setPreviewQuery] = useState('');
  const [previewItems, setPreviewItems] = useState<PreviewItem[]>([]);
  const [previewStatus, setPreviewStatus] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  if (isWebLite()) {
    return (
      <div style={semanticBlockStyle}>
        <div style={subsectionTitleStyle}>Semantic recall</div>
        <div style={detailStyle}>
          Semantic recall needs the desktop app and a local Ollama embedding model. Web Lite keeps saved facts only.
        </div>
      </div>
    );
  }

  const threads = chat.threads.filter(thread => thread.deletedAt == null);
  const sourceGroups = [
    { type: 'message' as const, label: 'Conversations', items: threads.map(thread => ({ reference: `thread:${thread.id}`, label: thread.title || 'New conversation', detail: formatDate(thread.updatedAt) })) },
    { type: 'note' as const, label: 'Notes', items: notes.sortedByRecency.map(note => ({ reference: `note:${note.id}`, label: note.title || 'Untitled', detail: formatDate(note.updatedAt) })) },
    { type: 'memory' as const, label: 'Saved facts', items: profile.facts.map(fact => ({ reference: rag.factSourceReference(fact), label: fact, detail: 'Always-on fact' })) },
    { type: 'library' as const, label: 'Library', items: library.sources.map(source => ({ reference: `library:${source.id}`, label: source.title, detail: `${source.kind} · ${source.status}` })) },
  ];
  const status = semanticStatus(rag);
  const pullState = ollama.pulls.get(rag.embeddingModel);
  const pulling = ollama.isPulling(rag.embeddingModel);

  const runPreview = async () => {
    const query = previewQuery.trim();
    if (!query || previewing) return;
    setPreviewing(true);
    setPreviewStatus(null);
    try {
      const results = await rag.retrieve({ query, purpose: 'explicit_recall', limit: 5 });
      setPreviewItems(results.map(result => ({
        reference: result.reference,
        sourceType: result.sourceType,
        title: result.sourceTitle,
        excerpt: result.text,
      })));
      setPreviewStatus(results.length ? `${results.length} relevant source${results.length === 1 ? '' : 's'}` : 'No relevant memories found.');
    } catch (error) {
      setPreviewItems([]);
      setPreviewStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <div style={semanticBlockStyle}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={subsectionTitleStyle}>Semantic recall</div>
          <div style={detailStyle}>Finds relevant context in conversations, notes, facts, and approved library sources. Text and vectors stay local.</div>
        </div>
        <Toggle on={rag.settings.autoInject} onChange={value => rag.setAutoInject(value)} disabled={!rag.servingCompleteGeneration} />
      </div>

      <div style={statusRowStyle} data-state={rag.phase}>
        <span style={{ color: status.tone === 'error' ? 'var(--danger)' : status.tone === 'ready' ? 'var(--accent)' : 'var(--text-dim)' }}>{status.label}</span>
        <span>{rag.indexedChunkCount} chunks</span>
        <span>{rag.activeGenerationAt ? `updated ${formatDate(rag.activeGenerationAt)}` : rag.embeddingModel}</span>
      </div>
      {rag.lastError && <div style={{ ...detailStyle, color: 'var(--danger)', marginTop: 8 }}>{rag.lastError.message} Rebuild the index after checking Ollama.</div>}
      {rag.indexing && (
        <div style={{ ...detailStyle, marginTop: 8 }}>
          {rag.phase === 'embedding' ? `Embedding ${rag.chunksCompleted}/${rag.chunksTotal} chunks` : `${rag.phase} ${rag.sourcesCompleted}/${rag.sourcesTotal} sources`}
        </div>
      )}
      {rag.status === 'model_missing' && (
        <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <Button onClick={() => pulling ? ollama.cancelPull(rag.embeddingModel) : void ollama.startPull(rag.embeddingModel)}>
            {pulling ? 'Cancel install' : `Install ${rag.embeddingModel}`}
          </Button>
          {pullState && <span style={detailStyle}>{pullState.phase}{pulling ? ` · ${Math.round(pullState.percent)}%` : ''}</span>}
        </div>
      )}

      <div style={{ marginTop: 14, borderTop: '1px solid var(--border)' }}>
        {sourceGroups.map(group => {
          const expanded = expandedType === group.type;
          const excludedCount = group.items.filter(item => rag.isSourceExcluded(item.reference)).length;
          const query = sourceQuery.trim().toLowerCase();
          const visibleItems = query ? group.items.filter(item => item.label.toLowerCase().includes(query)) : group.items;
          return (
            <div key={group.type} style={{ borderBottom: '1px solid var(--border)' }}>
              <div style={sourceGroupRowStyle}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => {
                    setExpandedType(current => current === group.type ? null : group.type);
                    setSourceQuery('');
                  }}
                  style={sourceGroupButtonStyle}
                >
                  <span>{group.label}</span>
                  <span style={{ color: 'var(--text-faint)' }}>{group.items.length}{excludedCount ? ` · ${excludedCount} off` : ''}</span>
                  <span aria-hidden="true" style={{ transform: expanded ? 'rotate(180deg)' : undefined }}><Icons.Chevron /></span>
                </button>
                <Toggle on={rag.settings.sourceTypes[group.type]} onChange={value => rag.setSourceType(group.type, value)} />
              </div>
              {expanded && (
                <div style={sourceListStyle}>
                  <Input value={sourceQuery} onChange={event => setSourceQuery(event.currentTarget.value)} placeholder={`Search ${group.label.toLowerCase()}`} />
                  {visibleItems.length === 0 ? (
                    <div style={detailStyle}>No matching sources.</div>
                  ) : visibleItems.slice(0, 60).map(item => {
                    const excluded = rag.isSourceExcluded(item.reference);
                    return (
                      <div key={item.reference} style={sourceItemStyle}>
                        <div style={{ minWidth: 0 }}>
                          <div title={item.label} style={sourceItemLabelStyle}>{item.label}</div>
                          <div style={detailStyle}>{item.detail}</div>
                        </div>
                        <button type="button" style={sourceToggleButtonStyle} onClick={() => excluded ? rag.includeSource(item.reference) : rag.excludeSource(item.reference)}>
                          {excluded ? 'Include' : 'Exclude'}
                        </button>
                      </div>
                    );
                  })}
                  {excludedCount > 0 && <button type="button" style={quietButtonStyle} onClick={() => rag.includeAllSources()}>Re-include all excluded sources</button>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={subsectionTitleStyle}>Try recall</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <Input
            value={previewQuery}
            onChange={event => setPreviewQuery(event.currentTarget.value)}
            onKeyDown={event => { if (event.key === 'Enter') void runPreview(); }}
            placeholder="What should GatesAI remember?"
            style={{ flex: 1 }}
          />
          <Button onClick={() => void runPreview()} disabled={!previewQuery.trim() || previewing || !rag.active}>{previewing ? 'Searching…' : 'Preview'}</Button>
        </div>
        {previewStatus && <div style={{ ...detailStyle, marginTop: 8 }}>{previewStatus}</div>}
        {previewItems.length > 0 && (
          <div style={{ display: 'grid', gap: 7, marginTop: 8 }}>
            {previewItems.map(item => (
              <div key={item.reference} style={previewItemStyle}>
                <span>{previewSourceLabel(item.sourceType)}{item.title ? ` · ${item.title}` : ''}</span>
                <span>{compactText(item.excerpt, 120)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 16 }}>
        <button type="button" style={quietButtonStyle} disabled={!rag.active || rag.indexing} onClick={() => void rag.rebuildIndex()}>Rebuild index</button>
        <button
          type="button"
          style={{ ...quietButtonStyle, color: 'var(--text-faint)' }}
          disabled={rag.indexing || rag.indexedChunkCount === 0}
          onClick={() => {
            if (window.confirm('Clear the derived semantic index? Your conversations, notes, facts, and library files stay intact. Recall will remain unavailable until the index is rebuilt.')) void rag.clearIndex();
          }}
        >Clear derived index</button>
      </div>
    </div>
  );
});

function semanticStatus(rag: ReturnType<typeof useRootStore>['rag']): { label: string; tone: 'ready' | 'error' | 'neutral' } {
  if (rag.status === 'ollama_offline') return { label: 'Ollama is offline', tone: 'error' };
  if (rag.status === 'model_missing') return { label: 'Embedding model needed', tone: 'neutral' };
  if (rag.phase === 'failed') return { label: 'Index needs attention', tone: 'error' };
  if (rag.phase === 'paused') return { label: 'Paused while chat is active', tone: 'neutral' };
  if (rag.indexing) return { label: 'Updating local index', tone: 'neutral' };
  if (rag.servingCompleteGeneration) return { label: 'Ready', tone: 'ready' };
  return { label: 'Ready to build', tone: 'neutral' };
}

function previewSourceLabel(sourceType: SemanticSourceType): string {
  if (sourceType === 'message') return 'Conversation';
  if (sourceType === 'note') return 'Note';
  if (sourceType === 'library') return 'Library';
  return 'Saved fact';
}

function formatDate(value: number): string {
  return new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function compactText(value: string, max: number): string {
  const oneLine = value.replace(/\s+/g, ' ').trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

const subsectionTitleStyle: CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--text-dim)',
  fontWeight: 600,
};

const detailStyle: CSSProperties = {
  fontSize: 11.5,
  color: 'var(--text-faint)',
  lineHeight: 1.45,
};

const semanticBlockStyle: CSSProperties = {
  marginTop: 22,
  paddingTop: 18,
  borderTop: '1px solid var(--border)',
};

const statusRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '7px 14px',
  marginTop: 11,
  fontSize: 11.5,
  color: 'var(--text-faint)',
};

const sourceGroupRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr auto',
  alignItems: 'center',
  gap: 12,
  minHeight: 46,
};

const sourceGroupButtonStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr auto 16px',
  alignItems: 'center',
  gap: 10,
  minWidth: 0,
  height: '100%',
  padding: 0,
  border: 0,
  background: 'transparent',
  color: 'var(--text)',
  fontSize: 12.5,
  textAlign: 'left',
  cursor: 'pointer',
};

const sourceListStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: '0 0 12px',
};

const sourceItemStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: 12,
  padding: '7px 9px',
  borderRadius: 7,
  background: 'var(--surface-wash-05)',
};

const sourceItemLabelStyle: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: 'var(--text-dim)',
  fontSize: 12,
};

const sourceToggleButtonStyle: CSSProperties = {
  border: 0,
  padding: '4px 6px',
  borderRadius: 5,
  background: 'transparent',
  color: 'var(--text-faint)',
  fontSize: 11,
  cursor: 'pointer',
};

const quietButtonStyle: CSSProperties = {
  border: 0,
  padding: '4px 0',
  background: 'transparent',
  color: 'var(--text-dim)',
  fontSize: 11.5,
  cursor: 'pointer',
};

const previewItemStyle: CSSProperties = {
  display: 'grid',
  gap: 3,
  padding: '8px 10px',
  border: '1px solid var(--border)',
  borderRadius: 7,
  color: 'var(--text-dim)',
  fontSize: 11.5,
  lineHeight: 1.4,
};

const emptyBoxStyle: CSSProperties = {
  padding: '18px 16px',
  border: '1px dashed var(--border)',
  borderRadius: 8,
  fontSize: 13,
  color: 'var(--text-faint)',
  lineHeight: 1.5,
  marginBottom: 14,
};

const rowActions: CSSProperties = { display: 'flex', gap: 6 };

const iconBtn: CSSProperties = {
  background: 'transparent',
  border: 0,
  padding: '3px 6px',
  fontSize: 11.5,
  color: 'var(--text-dim)',
  cursor: 'pointer',
  borderRadius: 5,
};

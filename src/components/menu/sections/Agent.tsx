// Renders the Agent menu section and the controls for its store-backed workflow.
// Called by GatesMenu; depends on MobX stores and shared UI primitives.
// Invariant: menu components present state and delegate side effects to stores/services.
import { useState, type CSSProperties } from 'react';
import { observer } from 'mobx-react-lite';
import { tokens } from '../../../core/styleTokens';
import { Button, Input, Textarea } from '../../ui';
import { useUserProfileStore } from '../../../stores/context';

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
        Memory · {facts.length} fact{facts.length === 1 ? '' : 's'}
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 14, lineHeight: 1.55 }}>
        Durable facts the assistant can use across conversations. You can edit
        or delete anything here.
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
    </div>
  );
});

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

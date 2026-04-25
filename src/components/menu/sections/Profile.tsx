import { useState, type CSSProperties } from 'react';
import { observer } from 'mobx-react-lite';
import { tokens } from '../../../core/styleTokens';
import { Button, Input, Pill, SettingsRow } from '../../ui';
import { useChatStore, useUserProfileStore } from '../../../stores/context';

/**
 * Profile is now the home for everything the AI knows about *you* — account
 * details, the bio (broken into editable rows), and the auto-generated
 * digests of recent conversations. The Agent section keeps system-prompt /
 * tool / voice settings; the two are split by question: "who am I?" vs
 * "how should the assistant behave?".
 */
export const ProfileSection = observer(function ProfileSection() {
  const chat = useChatStore();

  const recentSummaries = chat.threads
    .filter(t => !!t.summary?.trim())
    .sort((a, b) => (b.summaryUpdatedAt ?? 0) - (a.summaryUpdatedAt ?? 0))
    .slice(0, 15);

  return (
    <>
      <h1 style={tokens.h1}>Profile</h1>
      <div style={tokens.kicker}>account · memory · recent conversations</div>

      <div style={tokens.section}>
        <div style={tokens.sectionTitle}>Account</div>
        <SettingsRow label="Full name">Bill Gates</SettingsRow>
        <SettingsRow label="Email">bill@gatesfoundation.org</SettingsRow>
        <SettingsRow label="Username"><span style={tokens.mono}>@billg</span></SettingsRow>
        <SettingsRow label="Workspace" last>
          Personal · <span style={{ ...tokens.mono, color: 'var(--text-faint)' }}>t_5f9a21</span>
        </SettingsRow>
      </div>

      <MemorySection />

      <RecentConversations summaries={recentSummaries} />

      <div style={tokens.section}>
        <div style={tokens.sectionTitle}>Plan</div>
        <SettingsRow label="Current plan"><Pill>● Pro · $20/mo</Pill></SettingsRow>
        <SettingsRow label="Renews">Jun 14, 2026</SettingsRow>
        <SettingsRow label="Payment method" last>
          Visa ending in 4242 · <a style={{ color: 'var(--accent)', textDecoration: 'none' }}>Manage</a>
        </SettingsRow>
      </div>

      <div style={tokens.section}>
        <div style={tokens.sectionTitle}>Sessions</div>
        <SettingsRow label="MacBook Pro"><span style={{ color: 'var(--text-dim)' }}>Seattle · active now</span></SettingsRow>
        <SettingsRow label="iPhone 15"><span style={{ color: 'var(--text-faint)' }}>Seattle · 2 hours ago</span></SettingsRow>
        <SettingsRow label="Web — Safari" last>
          <span style={{ color: 'var(--text-faint)' }}>New York · 3 days ago</span> ·{' '}
          <a style={{ color: 'var(--accent)', textDecoration: 'none', cursor: 'pointer' }}>Revoke</a>
        </SettingsRow>
      </div>
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
        Things the model remembers about you across every conversation. The
        assistant can add to this itself via the <span style={tokens.mono}>memory</span> tool;
        you can edit or delete anything here.
      </div>

      {facts.length === 0 ? (
        <div style={{
          padding: '14px 16px', border: '1px dashed var(--border)', borderRadius: 4,
          fontSize: 13, color: 'var(--text-faint)', fontStyle: 'italic',
          marginBottom: 14,
        }}>
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
                      <button style={iconBtn} onClick={saveEdit} title="Save">save</button>
                      <button style={iconBtn} onClick={cancelEdit} title="Cancel">cancel</button>
                    </>
                  ) : (
                    <>
                      <button style={iconBtn} onClick={() => startEdit(i, fact)} title="Edit">edit</button>
                      <button style={{ ...iconBtn, color: 'var(--text-faint)' }} onClick={() => profile.removeFactAt(i)} title="Delete">delete</button>
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
            style={{ ...iconBtn, color: 'var(--text-faint)', fontSize: 11 }}
            onClick={() => {
              if (confirm(`Delete all ${facts.length} memories? This can't be undone.`)) {
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

interface RecentSummary {
  id: string;
  title: string;
  summary?: string;
  summaryUpdatedAt?: number;
}

function RecentConversations({ summaries }: { summaries: RecentSummary[] }) {
  return (
    <div style={tokens.section}>
      <div style={tokens.sectionTitle}>
        Recent conversations · {summaries.length} summarized
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 14, lineHeight: 1.55 }}>
        One-line digests of your other threads. The assistant sees these every
        turn under <span style={tokens.mono}>Recent conversations:</span> so it
        knows what you've been working on without re-reading every message.
      </div>
      {summaries.length === 0 ? (
        <div style={{
          padding: '14px 16px', border: '1px dashed var(--border)', borderRadius: 4,
          fontSize: 13, color: 'var(--text-faint)', fontStyle: 'italic',
        }}>
          Summaries will appear here as your conversations grow. Threads with at
          least 4 messages get summarized when they go idle.
        </div>
      ) : (
        <div>
          {summaries.map((t, i) => (
            <div
              key={t.id}
              style={{
                padding: '12px 0',
                borderBottom: i === summaries.length - 1 ? 'none' : '1px solid var(--border)',
              }}
            >
              <div style={{
                fontFamily: '"Source Serif 4", Georgia, serif',
                fontSize: 14.5, color: 'var(--text)', marginBottom: 4,
              }}>
                {t.title}
              </div>
              <div style={{
                fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.55,
              }}>
                {t.summary}
              </div>
              {t.summaryUpdatedAt && (
                <div style={{
                  ...tokens.mono, color: 'var(--text-faint)', fontSize: 10.5,
                  marginTop: 4, letterSpacing: '0.05em',
                }}>
                  updated {relativeTime(t.summaryUpdatedAt)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const rowActions: CSSProperties = {
  display: 'flex', gap: 8, alignItems: 'center',
};

const iconBtn: CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  fontFamily: '"Geist Mono", monospace', fontSize: 11,
  color: 'var(--text-dim)', padding: '4px 6px',
  textTransform: 'lowercase', letterSpacing: '0.05em',
};

function relativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

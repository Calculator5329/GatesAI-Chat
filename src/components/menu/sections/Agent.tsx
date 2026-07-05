// Renders the Agent menu section and the controls for its store-backed workflow.
// Called by GatesMenu; depends on MobX stores, bridge services, and shared UI primitives.
// Invariant: menu components present state and delegate side effects to stores/services.
import { useState, type CSSProperties } from 'react';
import { observer } from 'mobx-react-lite';
import { tokens } from '../../../core/styleTokens';
import { isWebLite } from '../../../core/runtime';
import type { Schedule, ScheduleCadence, ScheduleInput, ScheduleIntervalHours } from '../../../core/schedules';
import { SCHEDULE_INTERVAL_HOURS } from '../../../core/schedules';
import {
  Button,
  Input,
  Textarea,
  Pill,
} from '../../ui';
import {
  useChatStore,
  useLocalRuntimeStore,
  useModelRegistry,
  useOllamaStore,
  useRagStore,
  useRouterStore,
  useSchedulesStore,
  useSkillsStore,
  useUserProfileStore,
} from '../../../stores/context';
import { McpSettingsBlock } from './McpSettings';

interface AgentAbility {
  name: string;
  desc: string;
}

const AGENT_ABILITIES: AgentAbility[] = [
  { name: 'Conversation memory', desc: 'Memory, notes, thread context, summaries, and time awareness.' },
  { name: 'Workspace work', desc: 'Workspace inspection, file access, artifacts, terminal, Python, SQLite, query scripts, and git.' },
  { name: 'Local media', desc: 'ComfyUI image generation and local Ollama vision tools when configured.' },
];

export const AgentSection = observer(function AgentSection() {
  const profile = useUserProfileStore();
  const chat = useChatStore();

  const promptLen = profile.defaultSystemPrompt.trim().length;
  const factCount = profile.facts.length;
  const recentSummaries = chat.threads
    .filter(t => !!t.summary?.trim())
    .sort((a, b) => (b.summaryUpdatedAt ?? 0) - (a.summaryUpdatedAt ?? 0))
    .slice(0, 15);

  return (
    <>
      <h1 style={tokens.h1}>Agent</h1>
      <div style={tokens.kicker}>
        instructions {promptLen ? 'set' : 'empty'} · {factCount} memor{factCount === 1 ? 'y' : 'ies'} · {recentSummaries.length} summaries
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
      <SemanticMemorySection />
      <SchedulesSection />
      <RecentConversations summaries={recentSummaries} />
      <McpSettingsBlock />
      {!isWebLite() && <WorkspaceSkillsSection />}

      <div style={tokens.section}>
        <div style={tokens.sectionTitle}>
          Capabilities
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 14, lineHeight: 1.55 }}>
          Tool access is selected per turn from the live registry, so this is a
          summary of what the foundation can do rather than a toggle list.
        </div>
        {AGENT_ABILITIES.map((ability, i) => {
          const last = i === AGENT_ABILITIES.length - 1;
          return (
            <div
              key={ability.name}
              style={{
                display: 'grid', gridTemplateColumns: '180px 1fr auto',
                gap: 24, padding: '12px 0',
                borderBottom: last ? 'none' : '1px solid var(--border)',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ ...tokens.mono, color: 'var(--text)' }}>{ability.name}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2 }}>{ability.desc}</div>
              </div>
              <div />
              <div style={{ justifySelf: 'end' }}>
                <Pill>● live</Pill>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
});

interface ScheduleFormState {
  title: string;
  instructions: string;
  model: string;
  cadenceKind: ScheduleCadence['kind'];
  hours: number;
  hour: number;
  minute: number;
  catchUp: boolean;
}

const emptyScheduleForm: ScheduleFormState = {
  title: '',
  instructions: '',
  model: '',
  cadenceKind: 'interval',
  hours: 24,
  hour: 9,
  minute: 0,
  catchUp: false,
};

const SchedulesSection = observer(function SchedulesSection() {
  const schedules = useSchedulesStore();
  const registry = useModelRegistry();
  const router = useRouterStore();
  const [draft, setDraft] = useState<ScheduleFormState>(emptyScheduleForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ScheduleFormState>(emptyScheduleForm);
  const usableModels = registry.all.filter(model => model.supportsTools !== false && model.providerId !== 'local-image');

  const submitCreate = () => {
    if (!draft.title.trim() || !draft.instructions.trim()) return;
    schedules.create(formToInput(draft));
    setDraft(emptyScheduleForm);
  };

  const startEdit = (schedule: Schedule) => {
    setEditingId(schedule.id);
    setEditDraft(scheduleToForm(schedule));
  };

  const saveEdit = () => {
    if (!editingId || !editDraft.title.trim() || !editDraft.instructions.trim()) return;
    schedules.update(editingId, formToInput(editDraft));
    setEditingId(null);
  };

  return (
    <div style={tokens.section}>
      <div style={tokens.sectionTitle}>
        Schedules · {schedules.count}
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 14, lineHeight: 1.55 }}>
        Recurring agent tasks. Runs while GatesAI is open.
      </div>

      {schedules.sorted.length === 0 ? (
        <div style={emptyBoxStyle}>
          No schedules yet.
        </div>
      ) : (
        <div style={{ marginBottom: 14 }}>
          {schedules.sorted.map((schedule, i) => {
            const nextRunAt = schedules.nextRunAt(schedule.id);
            const isEditing = editingId === schedule.id;
            return (
              <div
                key={schedule.id}
                style={{
                  padding: '12px 0',
                  borderBottom: i === schedules.sorted.length - 1 ? 'none' : '1px solid var(--border)',
                  display: 'grid',
                  gap: 10,
                }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'start' }}>
                  <div>
                    <div style={{
                      fontFamily: '"Source Serif 4", Georgia, serif',
                      fontSize: 15,
                      color: 'var(--text)',
                      lineHeight: 1.35,
                    }}>
                      {schedule.title}
                    </div>
                    <div style={{ ...tokens.mono, color: 'var(--text-faint)', fontSize: 10.5, marginTop: 4 }}>
                      {formatScheduleCadence(schedule.cadence)} · {schedule.enabled ? `next ${formatMenuTime(nextRunAt)}` : 'paused'} · runs while GatesAI is open
                    </div>
                    {schedule.lastResultThreadId && (
                      <button
                        type="button"
                        className="menu-icon-button"
                        style={{ ...iconBtn, paddingLeft: 0, marginTop: 4 }}
                        onClick={() => router.goThread(schedule.lastResultThreadId ?? null)}
                      >
                        open last result
                      </button>
                    )}
                  </div>
                  <div style={{ ...rowActions, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <label style={{ ...tokens.mono, color: 'var(--text-dim)', fontSize: 11, display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={schedule.enabled}
                        onChange={e => schedules.setEnabled(schedule.id, e.target.checked)}
                      />
                      enabled
                    </label>
                    <button type="button" className="menu-icon-button" style={iconBtn} onClick={() => schedules.runNow(schedule.id)}>run now</button>
                    <button type="button" className="menu-icon-button" style={iconBtn} onClick={() => startEdit(schedule)}>edit</button>
                    <button
                      type="button"
                      className="menu-icon-button"
                      data-tone="danger"
                      style={{ ...iconBtn, color: 'var(--text-faint)' }}
                      onClick={() => {
                        if (window.confirm(`Delete schedule "${schedule.title}"? This can't be undone.`)) {
                          schedules.remove(schedule.id);
                        }
                      }}
                    >
                      delete
                    </button>
                  </div>
                </div>
                {isEditing && (
                  <ScheduleEditor
                    value={editDraft}
                    onChange={setEditDraft}
                    models={usableModels}
                    primaryLabel="Save"
                    onSubmit={saveEdit}
                    onCancel={() => setEditingId(null)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      <ScheduleEditor
        value={draft}
        onChange={setDraft}
        models={usableModels}
        primaryLabel="Add"
        onSubmit={submitCreate}
      />
    </div>
  );
});

function ScheduleEditor({
  value,
  onChange,
  models,
  primaryLabel,
  onSubmit,
  onCancel,
}: {
  value: ScheduleFormState;
  onChange: (next: ScheduleFormState) => void;
  models: Array<{ id: string; name: string; vendor: string }>;
  primaryLabel: string;
  onSubmit: () => void;
  onCancel?: () => void;
}) {
  const patch = (next: Partial<ScheduleFormState>) => onChange({ ...value, ...next });
  const disabled = !value.title.trim() || !value.instructions.trim();
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px', gap: 8 }}>
        <Input
          value={value.title}
          onChange={e => patch({ title: e.target.value })}
          placeholder="Title"
        />
        <select
          value={value.model}
          onChange={e => patch({ model: e.target.value })}
          style={selectStyle}
        >
          <option value="">Default model</option>
          {models.map(model => (
            <option key={model.id} value={model.id}>{model.vendor} · {model.name}</option>
          ))}
        </select>
      </div>
      <Textarea
        value={value.instructions}
        onChange={e => patch({ instructions: e.target.value })}
        placeholder="Instructions for the recurring background agent"
        style={{ minHeight: 80, resize: 'vertical' }}
      />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={value.cadenceKind}
          onChange={e => patch({ cadenceKind: e.target.value as ScheduleCadence['kind'] })}
          style={selectStyle}
        >
          <option value="interval">Interval</option>
          <option value="daily">Daily</option>
        </select>
        {value.cadenceKind === 'interval' ? (
          <select
            value={value.hours}
            onChange={e => patch({ hours: Number(e.target.value) })}
            style={selectStyle}
          >
            {SCHEDULE_INTERVAL_HOURS.map(hours => (
              <option key={hours} value={hours}>Every {hours}h</option>
            ))}
          </select>
        ) : (
          <>
            <Input
              type="number"
              min={0}
              max={23}
              value={value.hour}
              onChange={e => patch({ hour: Number(e.target.value) })}
              style={{ width: 72 }}
            />
            <Input
              type="number"
              min={0}
              max={59}
              value={value.minute}
              onChange={e => patch({ minute: Number(e.target.value) })}
              style={{ width: 72 }}
            />
          </>
        )}
        <label style={{ ...tokens.mono, color: 'var(--text-dim)', fontSize: 11, display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={value.catchUp}
            onChange={e => patch({ catchUp: e.target.checked })}
          />
          catch up on boot
        </label>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {onCancel && <Button onClick={onCancel}>Cancel</Button>}
          <Button onClick={onSubmit} disabled={disabled}>{primaryLabel}</Button>
        </div>
      </div>
    </div>
  );
}

const WorkspaceSkillsSection = observer(function WorkspaceSkillsSection() {
  const skills = useSkillsStore();

  return (
    <div style={tokens.section}>
      <div style={tokens.sectionTitle}>
        Workspace skills · {skills.count}
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 14, lineHeight: 1.55 }}>
        Markdown prompt packs discovered from <code style={inlineCodeStyle}>/workspace/skills/</code>.
      </div>

      {skills.skills.length === 0 ? (
        <div style={emptyBoxStyle}>
          No workspace skills found.
        </div>
      ) : (
        <div>
          {skills.skills.map((skill, i) => (
            <div
              key={skill.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '180px 1fr auto',
                gap: 18,
                alignItems: 'start',
                padding: '12px 0',
                borderBottom: i === skills.skills.length - 1 ? 'none' : '1px solid var(--border)',
              }}
            >
              <div>
                <div style={{ ...tokens.mono, color: 'var(--text)' }}>{skill.name}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2 }}>{skill.path}</div>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                {skill.description || 'No description.'}
                {skill.tools && (
                  <div style={{ ...tokens.mono, color: 'var(--text-faint)', fontSize: 11, marginTop: 5 }}>
                    tools: {skill.tools.join(', ')}
                  </div>
                )}
                {skill.warnings.length > 0 && (
                  <div style={{ marginTop: 8, display: 'grid', gap: 4 }}>
                    {skill.warnings.map(warning => (
                      <div key={warning} style={{ ...tokens.mono, color: '#d19a66', fontSize: 11 }}>
                        {warning}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <Pill>{skill.warnings.length > 0 ? 'warning' : 'ready'}</Pill>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 12 }}>
        <Button onClick={() => void skills.refresh()} disabled={skills.loading}>
          {skills.loading ? 'Refreshing...' : 'Refresh'}
        </Button>
      </div>
    </div>
  );
});

const SemanticMemorySection = observer(function SemanticMemorySection() {
  const rag = useRagStore();
  const ollama = useOllamaStore();
  const localRuntime = useLocalRuntimeStore();
  const model = rag.embeddingModel;
  const pullCommand = `ollama pull ${model}`;
  const pullState = ollama.pulls.get(model);
  const ollamaOnline = localRuntime.runtimes.ollama.status === 'online';
  const statusText = rag.status === 'active'
    ? 'active'
    : rag.status === 'ollama_offline'
      ? 'Ollama offline'
      : 'embedding model missing';

  return (
    <div style={tokens.section}>
      <div style={tokens.sectionTitle}>
        Semantic memory
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 14, lineHeight: 1.55 }}>
        Local recall over chats, notes, and memory facts. Embeddings come from
        Ollama and vectors stay in this browser profile.
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '160px 1fr',
        gap: 14,
        alignItems: 'center',
        padding: '10px 0',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={settingLabel}>Status</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <Pill>{statusText}</Pill>
          <span style={{ ...tokens.mono, color: 'var(--text-faint)' }}>
            {rag.indexedChunkCount} chunk{rag.indexedChunkCount === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {rag.status === 'model_missing' && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '160px 1fr auto',
          gap: 14,
          alignItems: 'center',
          padding: '10px 0',
          borderBottom: '1px solid var(--border)',
        }}>
          <div style={settingLabel}>Install</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {ollamaOnline ? (
              <>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--text-dim)', fontSize: 13 }}>Pull the embedding model in app.</span>
                  {pullState && (
                    <span role={pullState.error ? 'alert' : 'status'} style={{ color: pullState.error ? '#ff7597' : 'var(--text-faint)', fontSize: 11.5 }}>
                      {pullState.error ? pullState.error : `${pullState.phase} · ${Math.round(pullState.percent)}%`}
                    </span>
                  )}
                </div>
                <code style={{ ...inlineCodeStyle, color: 'var(--text-faint)' }}>{pullCommand}</code>
              </>
            ) : (
              <Input value={pullCommand} readOnly style={{ fontFamily: '"Geist Mono", monospace' }} />
            )}
          </div>
          {ollamaOnline ? (
            ollama.isPulling(model) ? (
              <Button variant="danger" onClick={() => ollama.cancelPull(model)}>Cancel</Button>
            ) : (
              <Button onClick={() => void ollama.startPull(model)}>Pull now</Button>
            )
          ) : (
            <Button onClick={() => void navigator.clipboard?.writeText(pullCommand)}>Copy</Button>
          )}
        </div>
      )}

      <label style={{
        display: 'grid',
        gridTemplateColumns: '160px 1fr',
        gap: 14,
        alignItems: 'center',
        padding: '10px 0',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={settingLabel}>Auto-inject</div>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-dim)', fontSize: 13 }}>
          <input
            type="checkbox"
            checked={rag.settings.autoInject}
            onChange={e => rag.setAutoInject(e.target.checked)}
          />
          Add highly relevant past context before each user turn
        </span>
      </label>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '160px 1fr',
        gap: 14,
        alignItems: 'center',
        padding: '10px 0',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={settingLabel}>Embedding model</div>
        <Input
          value={rag.settings.embeddingModel}
          onChange={e => rag.setEmbeddingModel(e.target.value)}
          placeholder="nomic-embed-text"
          style={{ fontFamily: '"Geist Mono", monospace' }}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 12 }}>
        <Button onClick={() => void rag.rebuildIndex()} disabled={!rag.active || rag.indexing}>
          {rag.indexing ? 'Rebuilding...' : 'Rebuild index'}
        </Button>
      </div>
    </div>
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
        One-line digests of recent threads. These help the assistant keep
        project context without re-reading every message.
      </div>
      {summaries.length === 0 ? (
        <div style={emptyBoxStyle}>
          Summaries will appear here as conversations grow. Threads with at
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

function formToInput(form: ScheduleFormState): ScheduleInput {
  const cadence: ScheduleCadence = form.cadenceKind === 'interval'
    ? {
        kind: 'interval',
        hours: SCHEDULE_INTERVAL_HOURS.includes(form.hours as ScheduleIntervalHours)
          ? form.hours as ScheduleIntervalHours
          : 24,
      }
    : {
        kind: 'daily',
        hour: Math.min(23, Math.max(0, Math.floor(form.hour))),
        minute: Math.min(59, Math.max(0, Math.floor(form.minute))),
      };
  return {
    title: form.title,
    instructions: form.instructions,
    cadence,
    model: form.model || undefined,
    catchUp: form.catchUp,
  };
}

function scheduleToForm(schedule: Schedule): ScheduleFormState {
  if (schedule.cadence.kind === 'interval') {
    return {
      title: schedule.title,
      instructions: schedule.instructions,
      model: schedule.model ?? '',
      cadenceKind: 'interval',
      hours: schedule.cadence.hours,
      hour: 9,
      minute: 0,
      catchUp: schedule.catchUp,
    };
  }
  return {
    title: schedule.title,
    instructions: schedule.instructions,
    model: schedule.model ?? '',
    cadenceKind: 'daily',
    hours: 24,
    hour: schedule.cadence.hour,
    minute: schedule.cadence.minute,
    catchUp: schedule.catchUp,
  };
}

function formatScheduleCadence(cadence: ScheduleCadence): string {
  if (cadence.kind === 'interval') return `every ${cadence.hours}h`;
  return `daily ${String(cadence.hour).padStart(2, '0')}:${String(cadence.minute).padStart(2, '0')}`;
}

function formatMenuTime(ts: number | null): string {
  if (!ts) return 'unknown';
  return new Date(ts).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const emptyBoxStyle: CSSProperties = {
  padding: '14px 16px',
  border: '1px dashed var(--border)',
  borderRadius: 4,
  fontSize: 13,
  color: 'var(--text-faint)',
  fontStyle: 'italic',
  marginBottom: 14,
};

const rowActions: CSSProperties = {
  display: 'flex', gap: 8, alignItems: 'center',
};

const settingLabel: CSSProperties = {
  ...tokens.mono,
  color: 'var(--text-faint)',
  fontSize: 11.5,
};

const inlineCodeStyle: CSSProperties = {
  fontFamily: '"Geist Mono", monospace',
  fontSize: 11,
  color: 'var(--text-dim)',
};

const selectStyle: CSSProperties = {
  background: 'var(--panel)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '8px 10px',
  color: 'var(--text)',
  fontFamily: 'inherit',
  fontSize: 13,
  outline: 'none',
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

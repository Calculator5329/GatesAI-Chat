import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { tokens } from '../../../core/styleTokens';
import {
  SettingsRow,
  Toggle,
  Select,
  Textarea,
  SegmentedControl,
  Pill,
} from '../../ui';
import { useUserProfileStore } from '../../../stores/context';

interface AgentTool {
  name: string;
  desc: string;
  on: boolean;
  status: 'live' | 'planned';
}

const AGENT_TOOLS: AgentTool[] = [
  { name: 'memory',      desc: 'Add / remove / update / list user memories',                   on: true,  status: 'live' },
  { name: 'notes',       desc: 'Create / read / search long-form notes',                       on: true,  status: 'live' },
  { name: 'thread',      desc: 'Rename, set context, summarize, switch, or list threads',     on: true,  status: 'live' },
  { name: 'time',        desc: 'Current date / time in your local timezone',                  on: true,  status: 'live' },
  { name: 'git',         desc: 'Local status, diff, add, commit, and branch operations',       on: true,  status: 'live' },
  { name: 'web_search',  desc: 'Search the web via Brave',                                     on: false, status: 'planned' },
  { name: 'web_fetch',   desc: 'Fetch and read a URL',                                         on: false, status: 'planned' },
  { name: 'code_run',    desc: 'Execute JS in a sandboxed worker',                             on: false, status: 'planned' },
];

const REASONING = ['off', 'low', 'medium', 'high'] as const;
const FORMALITY = ['casual', 'neutral', 'formal'] as const;

type Reasoning = typeof REASONING[number];
type Formality = typeof FORMALITY[number];

export const AgentSection = observer(function AgentSection() {
  const profile = useUserProfileStore();
  const [voice, setVoice] = useState(true);
  const [reasoning, setReasoning] = useState<Reasoning>('medium');
  const [formality, setFormality] = useState<Formality>('neutral');

  const enabledTools = AGENT_TOOLS.filter(t => t.on).length;
  const promptLen = profile.defaultSystemPrompt.trim().length;
  const factCount = profile.facts.length;

  return (
    <>
      <h1 style={tokens.h1}>Agent</h1>
      <div style={tokens.kicker}>
        instructions {promptLen ? '· set' : '· empty'} · memory · {factCount} fact{factCount === 1 ? '' : 's'}
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


      <div style={tokens.section}>
        <div style={tokens.sectionTitle}>Model defaults</div>
        <SettingsRow label="Default model" disabled>
          <Select disabled defaultValue="claude-sonnet-4.6">
            <option value="claude-sonnet-4.6">Claude Sonnet 4.6</option>
            <option value="claude-opus-4.7">Claude Opus 4.7</option>
            <option value="gpt-5.5">GPT-5.5</option>
            <option value="gpt-5.5-pro">GPT-5.5 Pro</option>
            <option value="gpt-5.4">GPT-5.4</option>
            <option value="gpt-5.4-mini">GPT-5.4 mini</option>
            <option value="gemini-3.1-pro">Gemini 3.1 Pro</option>
          </Select>
        </SettingsRow>
        <SettingsRow label="Temperature" disabled>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input type="range" min="0" max="2" step="0.1" defaultValue="0.7" disabled
              style={{ flex: 1, accentColor: 'var(--accent)' }} />
            <span style={{ ...tokens.mono, color: 'var(--text-dim)', width: 32 }}>0.7</span>
          </div>
        </SettingsRow>
        <SettingsRow label="Reasoning effort" disabled last>
          <SegmentedControl options={REASONING} value={reasoning} onChange={setReasoning} />
        </SettingsRow>
      </div>

      <div style={tokens.section}>
        <div style={tokens.sectionTitle}>
          Tools · {enabledTools} of {AGENT_TOOLS.length} live
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 14, lineHeight: 1.55 }}>
          The assistant always has access to every live tool — there are no
          per-tool toggles. Manage what it remembers about you in <strong>Profile → Memory</strong>.
        </div>
        {AGENT_TOOLS.map((t, i) => {
          const last = i === AGENT_TOOLS.length - 1;
          const isLive = t.status === 'live';
          return (
            <div
              key={t.name}
              style={{
                display: 'grid', gridTemplateColumns: '180px 1fr auto',
                gap: 24, padding: '12px 0',
                borderBottom: last ? 'none' : '1px solid var(--border)',
                alignItems: 'center',
                opacity: isLive ? 1 : 0.55,
              }}
            >
              <div>
                <div style={{ ...tokens.mono, color: 'var(--text)' }}>{t.name}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2 }}>{t.desc}</div>
              </div>
              <div />
              <div style={{ justifySelf: 'end' }}>
                {isLive
                  ? <Pill>● live</Pill>
                  : <span style={{
                      ...tokens.mono, fontSize: 10.5, color: 'var(--text-faint)',
                      letterSpacing: '0.12em', textTransform: 'uppercase',
                    }}>planned</span>}
              </div>
            </div>
          );
        })}
      </div>

      <div style={tokens.section}>
        <div style={tokens.sectionTitle}>Voice & tone</div>
        <SettingsRow label="Formality" disabled>
          <SegmentedControl options={FORMALITY} value={formality} onChange={setFormality} />
        </SettingsRow>
        <SettingsRow label="Length" disabled>
          <span style={{ color: 'var(--text-dim)' }}>Concise · one paragraph default</span>
        </SettingsRow>
        <SettingsRow label="Emoji use" disabled last>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Toggle on={voice} onChange={setVoice} />
            <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>Occasional, when clarifying</span>
          </div>
        </SettingsRow>
      </div>
    </>
  );
});

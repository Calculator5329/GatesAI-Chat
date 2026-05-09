import { observer } from 'mobx-react-lite';
import { tokens } from '../../../core/styleTokens';
import {
  Textarea,
  Pill,
} from '../../ui';
import { useUserProfileStore } from '../../../stores/context';

interface AgentTool {
  name: string;
  desc: string;
}

const AGENT_TOOLS: AgentTool[] = [
  { name: 'memory',        desc: 'Add / remove / update / list user memories' },
  { name: 'notes',         desc: 'Create / read / search long-form notes' },
  { name: 'thread',        desc: 'Rename, set context, summarize, switch, or list threads' },
  { name: 'time',          desc: 'Current date / time in your local timezone' },
  { name: 'workspace',     desc: 'Inspect bridge state, limits, and workspace conventions' },
  { name: 'fs',            desc: 'Read and write files inside the local workspace' },
  { name: 'inspect_file',  desc: 'Profile CSV, JSON, and text files without dumping content' },
  { name: 'terminal',      desc: 'Run allowlisted local commands through the bridge' },
  { name: 'python_inline', desc: 'Run short scoped Python snippets' },
  { name: 'sqlite_query',  desc: 'Run read-only SQLite queries against workspace databases' },
  { name: 'query_script',  desc: 'Create reusable data-query scripts and artifacts' },
  { name: 'git',           desc: 'Local status, diff, add, commit, and branch operations' },
];

export const AgentSection = observer(function AgentSection() {
  const profile = useUserProfileStore();

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
        <div style={tokens.sectionTitle}>
          Tools · {AGENT_TOOLS.length} live
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 14, lineHeight: 1.55 }}>
          The assistant always has access to every live tool — there are no
          per-tool toggles. Manage what it remembers about you in <strong>Profile → Memory</strong>.
        </div>
        {AGENT_TOOLS.map((t, i) => {
          const last = i === AGENT_TOOLS.length - 1;
          return (
            <div
              key={t.name}
              style={{
                display: 'grid', gridTemplateColumns: '180px 1fr auto',
                gap: 24, padding: '12px 0',
                borderBottom: last ? 'none' : '1px solid var(--border)',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ ...tokens.mono, color: 'var(--text)' }}>{t.name}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2 }}>{t.desc}</div>
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

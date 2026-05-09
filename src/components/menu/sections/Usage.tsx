import { observer } from 'mobx-react-lite';
import { tokens } from '../../../core/styleTokens';
import { Card } from '../../ui';
import { useChatStore } from '../../../stores/context';
import { estimateTokens } from '../../../core/tokens';

/**
 * Usage is derived live from the threads currently in memory. We don't have a
 * pricing/cost layer yet, so this page reports activity (tokens, calls,
 * messages, threads) — never dollars. When real cost telemetry lands, the
 * tile labels swap.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS_BACK = 30;

export const UsageSection = observer(function UsageSection() {
  const chat = useChatStore();
  const stats = computeStats(chat.threads);

  return (
    <>
      <h1 style={tokens.h1}>Usage</h1>
      <div style={tokens.kicker}>
        {stats.oldest
          ? `all-time · since ${formatDate(stats.oldest)}`
          : 'no activity yet'}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 36 }}>
        <Card><div style={tokens.number}>{compact(stats.tokensIn)}</div><div style={tokens.numberLabel}>Tokens in</div></Card>
        <Card><div style={tokens.number}>{compact(stats.tokensOut)}</div><div style={tokens.numberLabel}>Tokens out</div></Card>
        <Card><div style={tokens.number}>{stats.assistantCount.toLocaleString()}</div><div style={tokens.numberLabel}>Messages</div></Card>
        <Card><div style={tokens.number}>{stats.threadCount.toLocaleString()}</div><div style={tokens.numberLabel}>Threads</div></Card>
      </div>

      <DailyChart days={stats.daily} />
      <ByModel rows={stats.byModel} />
    </>
  );
});

function DailyChart({ days }: { days: number[] }) {
  const max = Math.max(1, ...days);
  return (
    <div style={tokens.section}>
      <div style={tokens.sectionTitle}>Daily messages · last {DAYS_BACK} days</div>
      <Card style={{ padding: '24px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 100 }}>
          {days.map((count, i) => (
            <div
              key={i}
              title={count === 1 ? '1 message' : `${count} messages`}
              style={{
                flex: 1,
                height: count > 0 ? `${(count / max) * 100}%` : 0,
                background: i === days.length - 1 ? 'var(--accent)' : 'rgba(255,255,255,0.15)',
                borderRadius: '2px 2px 0 0',
                minHeight: count > 0 ? 2 : 0,
              }}
            />
          ))}
        </div>
        <div style={{
          display: 'flex', justifyContent: 'space-between', marginTop: 10,
          fontSize: 10.5, color: 'var(--text-faint)',
          fontFamily: '"Geist Mono", monospace', letterSpacing: '0.04em',
        }}>
          <span>{relativeDay(DAYS_BACK - 1)}</span>
          <span>{relativeDay(Math.floor(DAYS_BACK / 2))}</span>
          <span>today</span>
        </div>
      </Card>
    </div>
  );
}

interface ModelRow {
  name: string;
  share: number;
  tokensOut: number;
  calls: number;
}

function ByModel({ rows }: { rows: ModelRow[] }) {
  if (rows.length === 0) {
    return (
      <div style={tokens.section}>
        <div style={tokens.sectionTitle}>By model</div>
        <div style={{
          padding: '14px 16px', border: '1px dashed var(--border)', borderRadius: 4,
          fontSize: 13, color: 'var(--text-faint)', fontStyle: 'italic',
        }}>
          No assistant messages yet.
        </div>
      </div>
    );
  }
  return (
    <div style={tokens.section}>
      <div style={tokens.sectionTitle}>By model</div>
      {rows.map((m, i) => {
        const last = i === rows.length - 1;
        return (
          <div
            key={m.name}
            style={{
              display: 'grid', gridTemplateColumns: '220px 1fr',
              gap: 24, padding: '12px 0',
              borderBottom: last ? 'none' : '1px solid var(--border)',
              alignItems: 'center',
            }}
          >
            <div style={{ ...tokens.mono, color: 'var(--text)' }}>{m.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${m.share * 100}%`, height: '100%', background: 'var(--accent)' }} />
              </div>
              <div style={{ ...tokens.mono, color: 'var(--text-dim)', width: 90, textAlign: 'right' }}>{compact(m.tokensOut)} tok</div>
              <div style={{ ...tokens.mono, color: 'var(--text-faint)', width: 70, textAlign: 'right' }}>
                {m.calls} call{m.calls === 1 ? '' : 's'}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface UsageStats {
  tokensIn: number;
  tokensOut: number;
  assistantCount: number;
  threadCount: number;
  oldest: number | null;
  daily: number[];
  byModel: ModelRow[];
}

interface ThreadShape {
  messages: Array<
    | { role: 'user'; content: string; createdAt: number }
    | { role: 'assistant'; content: string; createdAt: number; model?: string }
  >;
}

function computeStats(threads: ThreadShape[]): UsageStats {
  let tokensIn = 0;
  let tokensOut = 0;
  let assistantCount = 0;
  let oldest: number | null = null;
  let threadCount = 0;
  const byModelMap = new Map<string, { tokensOut: number; calls: number }>();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const daily = new Array<number>(DAYS_BACK).fill(0);

  for (const t of threads) {
    if (!t.messages || t.messages.length === 0) continue;
    threadCount += 1;
    for (const m of t.messages) {
      if (oldest === null || m.createdAt < oldest) oldest = m.createdAt;
      if (m.role === 'user') {
        tokensIn += estimateTokens(m.content ?? '');
      } else if (m.role === 'assistant') {
        const out = estimateTokens(m.content ?? '');
        tokensOut += out;
        assistantCount += 1;
        const modelName = m.model ?? 'unknown';
        const cur = byModelMap.get(modelName) ?? { tokensOut: 0, calls: 0 };
        cur.tokensOut += out;
        cur.calls += 1;
        byModelMap.set(modelName, cur);
        const dayIdx = Math.floor((todayMs - startOfDay(m.createdAt)) / DAY_MS);
        if (dayIdx >= 0 && dayIdx < DAYS_BACK) {
          daily[DAYS_BACK - 1 - dayIdx] += 1;
        }
      }
    }
  }

  const totalShare = Math.max(1, assistantCount);
  const byModel: ModelRow[] = [...byModelMap.entries()]
    .map(([name, v]) => ({ name, share: v.calls / totalShare, tokensOut: v.tokensOut, calls: v.calls }))
    .sort((a, b) => b.calls - a.calls);

  return { tokensIn, tokensOut, assistantCount, threadCount, oldest, daily, byModel };
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function relativeDay(daysAgo: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

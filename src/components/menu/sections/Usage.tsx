import { tokens } from '../../../core/styleTokens';
import { Card, Pill } from '../../ui';

interface ModelUsage {
  name: string;
  share: number;
  cost: number;
  calls: number;
}

const MODEL_USAGE: ModelUsage[] = [
  { name: 'claude-sonnet-4.6', share: 0.52, cost: 24.18, calls: 138 },
  { name: 'gpt-5.4',           share: 0.24, cost: 11.42, calls:  52 },
  { name: 'claude-opus-4.7',   share: 0.13, cost:  9.85, calls:  11 },
  { name: 'gemini-3.1-pro',    share: 0.07, cost:  3.30, calls:  14 },
  { name: 'or-grok-4.20',      share: 0.04, cost:  2.09, calls:   9 },
];

const INVOICES: Array<[string, string, string]> = [
  ['Mar 2026', '$52.84', 'Paid'],
  ['Feb 2026', '$38.19', 'Paid'],
  ['Jan 2026', '$41.02', 'Paid'],
];

const DAYS = Array.from({ length: 30 }, (_, i) => ({
  d: i + 1,
  cost: 0.2 + Math.sin(i / 2.4) * 0.4 + Math.random() * 0.6 + (i / 30),
}));

export function UsageSection() {
  const max = Math.max(...DAYS.map(d => d.cost));

  return (
    <>
      <h1 style={tokens.h1}>Usage</h1>
      <div style={tokens.kicker}>billing period · apr 1 — apr 30 · 9 days left</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 36 }}>
        <Card><div style={tokens.number}>$47.12</div><div style={tokens.numberLabel}>This month</div></Card>
        <Card><div style={tokens.number}>1.2M</div><div style={tokens.numberLabel}>Tokens in</div></Card>
        <Card><div style={tokens.number}>384K</div><div style={tokens.numberLabel}>Tokens out</div></Card>
        <Card><div style={tokens.number}>218</div><div style={tokens.numberLabel}>Messages</div></Card>
      </div>

      <div style={tokens.section}>
        <div style={tokens.sectionTitle}>Daily spend · last 30 days</div>
        <Card style={{ padding: '24px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 100 }}>
            {DAYS.map((d, i) => (
              <div key={i}
                title={`Day ${d.d}: $${d.cost.toFixed(2)}`}
                style={{
                  flex: 1,
                  height: `${(d.cost / max) * 100}%`,
                  background: i === DAYS.length - 1 ? 'var(--accent)' : 'rgba(255,255,255,0.15)',
                  borderRadius: '2px 2px 0 0',
                  minHeight: 2,
                }} />
            ))}
          </div>
          <div style={{
            display: 'flex', justifyContent: 'space-between', marginTop: 10,
            fontSize: 10.5, color: 'var(--text-faint)',
            fontFamily: '"Geist Mono", monospace', letterSpacing: '0.04em',
          }}>
            <span>Apr 1</span><span>Apr 15</span><span>Apr 30</span>
          </div>
        </Card>
      </div>

      <div style={tokens.section}>
        <div style={tokens.sectionTitle}>By model</div>
        {MODEL_USAGE.map((m, i) => {
          const last = i === MODEL_USAGE.length - 1;
          return (
            <div
              key={m.name}
              style={{
                display: 'grid', gridTemplateColumns: '180px 1fr',
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
                <div style={{ ...tokens.mono, color: 'var(--text-dim)', width: 60, textAlign: 'right' }}>${m.cost.toFixed(2)}</div>
                <div style={{ ...tokens.mono, color: 'var(--text-faint)', width: 50, textAlign: 'right' }}>{m.calls} calls</div>
              </div>
            </div>
          );
        })}
      </div>

      <div style={tokens.section}>
        <div style={tokens.sectionTitle}>Recent invoices</div>
        {INVOICES.map(([m, c, s], i) => {
          const last = i === INVOICES.length - 1;
          return (
            <div
              key={m}
              style={{
                display: 'grid', gridTemplateColumns: '180px 1fr',
                gap: 24, padding: '12px 0',
                borderBottom: last ? 'none' : '1px solid var(--border)',
                alignItems: 'center',
              }}
            >
              <div style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>{m}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <span style={tokens.mono}>{c}</span>
                <Pill>● {s}</Pill>
                <a style={{ color: 'var(--accent)', textDecoration: 'none', cursor: 'pointer', fontSize: 12 }}>Download PDF</a>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

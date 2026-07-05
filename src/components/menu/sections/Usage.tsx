// Renders real LLM usage and spend from persisted assistant-message usage.
// Called by GatesMenu; depends on pure selectors and store context only.
// Invariant: no usage counters are stored outside messages.
import type { CSSProperties } from 'react';
import { observer } from 'mobx-react-lite';
import { tokens } from '../../../core/styleTokens';
import { usageSummary, type UsageDayTotal, type UsageModelTotal } from '../../../core/threadSelectors';
import { formatTokenCount, formatUsd } from '../../../core/usage';
import { useChatStore, useModelRegistry } from '../../../stores/context';
import { Card } from '../../ui';

export const UsageSection = observer(function UsageSection() {
  const chat = useChatStore();
  const registry = useModelRegistry();
  const summary = usageSummary(chat.threads, registry.all);
  const maxDayCost = Math.max(...summary.byDay.map(day => day.costUsd), 0);
  const maxDayTokens = Math.max(...summary.byDay.map(day => day.totalTokens), 0);
  const empty = summary.allTime.requests === 0;

  return (
    <div className="usage-page">
      <h1 style={tokens.h1}>Usage</h1>
      <div className="usage-page__kicker" style={tokens.kicker}>LLM usage - cloud spend and local tokens</div>
      <div style={splitLineStyle}>
        Cloud {formatUsd(summary.cloud.costUsd)} - Local {formatTokenCount(summary.local.totalTokens)} tokens (free)
      </div>

      <div className="usage-summary-grid" style={summaryGridStyle}>
        {usageStatRows(summary).map(stat => (
          <UsageStat key={stat.label} label={stat.label} value={stat.value} />
        ))}
      </div>

      {empty ? (
        <Card className="usage-empty editorial-empty-copy" style={{ padding: '18px' }}>
          Usage will appear here after the first completed model response.
        </Card>
      ) : (
        <>
          <ModelUsageTable rows={summary.byModel} />
          <DailyUsageList days={summary.byDay} maxCost={maxDayCost} maxTokens={maxDayTokens} />
        </>
      )}
    </div>
  );
});

function UsageStat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="usage-stat" style={{ padding: '14px 16px' }}>
      <div style={tokens.number}>{value}</div>
      <div style={tokens.numberLabel}>{label}</div>
    </Card>
  );
}

function usageStatRows(summary: ReturnType<typeof usageSummary>): Array<{ label: string; value: string }> {
  const spendStats = [
    { label: 'All-time spend', value: formatUsd(summary.allTime.costUsd) },
    { label: 'Last 30 days', value: formatUsd(summary.last30Days.costUsd) },
  ];
  const volumeStats = [
    { label: 'Requests', value: formatTokenCount(summary.allTime.requests) },
    { label: 'Tokens in / out', value: `${formatTokenCount(summary.allTime.promptTokens)} / ${formatTokenCount(summary.allTime.completionTokens)}` },
  ];
  return summary.presentationMode === 'local-led'
    ? [...volumeStats, ...spendStats]
    : [...spendStats, ...volumeStats];
}

function ModelUsageTable({ rows }: { rows: UsageModelTotal[] }) {
  return (
    <div className="usage-section usage-models" style={{ ...tokens.section, marginTop: 30 }}>
      <div className="usage-section-title" style={tokens.sectionTitle}>By model</div>
      <Card className="usage-model-table" style={{ overflowX: 'auto', overflowY: 'hidden' }}>
        <div className="usage-model-row usage-model-row--head" style={{ ...modelRowStyle, color: 'var(--text-faint)', fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          <span>Model</span>
          <span style={rightAlignStyle}>Requests</span>
          <span style={rightAlignStyle}>Tokens in</span>
          <span style={rightAlignStyle}>Tokens out</span>
          <span style={rightAlignStyle}>Cost</span>
        </div>
        {rows.map(row => (
          <div key={row.modelId} className="usage-model-row" style={modelRowStyle}>
            <span style={{ minWidth: 0 }}>
              <span style={{ color: 'var(--text)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.modelName}
              </span>
              <span style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 3, color: 'var(--text-faint)', fontSize: 11 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.modelId}</span>
                {row.costSources.includes('local') && <SourceChip label="local" />}
                {row.costSources.includes('free') && <SourceChip label="free" />}
              </span>
            </span>
            <span style={rightAlignStyle}>{formatTokenCount(row.requests)}</span>
            <span style={rightAlignStyle}>{formatTokenCount(row.promptTokens)}</span>
            <span style={rightAlignStyle}>{formatTokenCount(row.completionTokens)}</span>
            <span style={{ ...rightAlignStyle, color: 'var(--accent)' }}>{row.costSources.includes('local') ? 'local' : formatUsd(row.costUsd)}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}

function DailyUsageList({ days, maxCost, maxTokens }: { days: UsageDayTotal[]; maxCost: number; maxTokens: number }) {
  const visibleDays = days.filter(day => day.requests > 0);
  return (
    <div className="usage-section usage-days" style={tokens.section}>
      <div className="usage-section-title" style={tokens.sectionTitle}>Last 30 days</div>
      <Card className="usage-days-card" style={{ padding: '12px 14px' }}>
        {visibleDays.length === 0 ? (
          <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>No recorded usage in the last 30 days.</div>
        ) : (
          visibleDays.map(day => (
            <DailyUsageRow key={day.day} day={day} maxCost={maxCost} maxTokens={maxTokens} />
          ))
        )}
      </Card>
    </div>
  );
}

function DailyUsageRow({ day, maxCost, maxTokens }: { day: UsageDayTotal; maxCost: number; maxTokens: number }) {
  const metric = maxCost > 0 ? day.costUsd : day.totalTokens;
  const maxMetric = maxCost > 0 ? maxCost : maxTokens;
  const width = maxMetric > 0 ? Math.max(4, Math.round((metric / maxMetric) * 100)) : 0;
  return (
    <div className="usage-day-row" style={dayRowStyle}>
      <span style={{ color: 'var(--text-dim)', fontSize: 12, width: 44 }}>{formatDay(day.timestamp)}</span>
      <span style={barTrackStyle} aria-hidden="true">
        <span style={{ ...barFillStyle, width: `${width}%` }} />
      </span>
      <span style={{ ...tokens.mono, color: 'var(--text)', textAlign: 'right', minWidth: 72 }}>{formatUsd(day.costUsd)}</span>
      <span style={{ ...tokens.mono, color: 'var(--text-faint)', textAlign: 'right', minWidth: 88 }}>{formatTokenCount(day.totalTokens)} tok</span>
    </div>
  );
}

function SourceChip({ label }: { label: string }) {
  return (
    <span style={{
      flex: 'none',
      color: 'var(--accent)',
      border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
      borderRadius: 3,
      padding: '0 4px',
      fontSize: 9.5,
      lineHeight: '14px',
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
    }}>
      {label}
    </span>
  );
}

function formatDay(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}

const summaryGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: 10,
  marginBottom: 28,
};

const splitLineStyle: CSSProperties = {
  marginTop: 8,
  marginBottom: 18,
  color: 'var(--text-dim)',
  fontSize: 12.5,
};

const modelRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(180px, 1.8fr) minmax(72px, 0.7fr) minmax(86px, 0.8fr) minmax(86px, 0.8fr) minmax(82px, 0.7fr)',
  gap: 12,
  alignItems: 'center',
  minWidth: 560,
  padding: '11px 14px',
  borderTop: '1px solid color-mix(in srgb, var(--border) 65%, transparent)',
  fontSize: 12.5,
};

const rightAlignStyle: CSSProperties = {
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
  fontFamily: '"Geist Mono", monospace',
};

const dayRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '44px minmax(80px, 1fr) 72px 88px',
  gap: 10,
  alignItems: 'center',
  minHeight: 28,
};

const barTrackStyle: CSSProperties = {
  height: 7,
  borderRadius: 999,
  background: 'color-mix(in srgb, var(--text-faint) 16%, transparent)',
  overflow: 'hidden',
};

const barFillStyle: CSSProperties = {
  display: 'block',
  height: '100%',
  borderRadius: 999,
  background: 'var(--accent)',
};

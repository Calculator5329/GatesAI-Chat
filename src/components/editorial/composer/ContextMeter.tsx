// The context-usage meter shown in the composer meta row: an estimate bar,
// token count, and (once spend is recorded) the running chat cost. Its own
// observer so token/spend updates re-render just the meter, not the whole
// composer.
import { observer } from 'mobx-react-lite';
import { useEditorial } from '../../../stores/context';
import { formatUsd } from '../../../core/usage';

export const ContextMeter = observer(function ContextMeter({ draftText }: { draftText: string }) {
  const { chat, imageJobs } = useEditorial();
  const usage = chat.tokenUsage(draftText);
  const llmSpend = chat.threadLlmSpendUsd(chat.activeThreadId);
  const imageSpend = imageJobs.threadCostUsd(chat.activeThreadId);
  const totalSpend = llmSpend + imageSpend;
  const percent = Math.round(usage.fraction * 100);
  const tone = usage.fraction >= 0.9
    ? 'var(--danger-muted)'
    : usage.fraction >= 0.7
      ? 'var(--warning)'
      : 'var(--accent)';

  const contextLabel = [
    `Context estimate: ${formatTokens(usage.used)} of ${formatTokens(usage.window)} (${percent}%)`,
    totalSpend > 0 ? `Spent in this chat: ${formatUsd(totalSpend)} (${formatUsd(llmSpend)} LLM, ${formatUsd(imageSpend)} images)` : '',
  ].filter(Boolean).join('\n');
  return (
    <div
      className="context-meter"
      role="img"
      aria-label={contextLabel}
      title={contextLabel}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8,
        flex: '1 1 auto',
        fontFamily: '"Geist Mono", monospace',
        letterSpacing: '0.03em',
        fontSize: 11,
        lineHeight: '16px',
        color: tone,
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 54,
          height: 4,
          borderRadius: 999,
          background: 'color-mix(in srgb, var(--text-faint) 20%, transparent)',
          overflow: 'hidden',
          flex: 'none',
        }}
      >
        <span
          style={{
            display: 'block',
            width: `${Math.max(2, percent)}%`,
            maxWidth: '100%',
            height: '100%',
            borderRadius: 999,
            background: tone,
          }}
        />
      </span>
      <span className="context-meter__tokens" style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {formatTokens(usage.used)} / {formatTokens(usage.window)}
      </span>
      {totalSpend > 0 && (
        <span className="context-meter__spend" style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: 'var(--accent)' }}>
          {formatUsd(totalSpend)}
        </span>
      )}
    </div>
  );
});

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${trimFixed(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trimFixed(value / 1_000)}k`;
  return Math.round(value).toString();
}

function trimFixed(value: number): string {
  return value >= 10 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, '');
}

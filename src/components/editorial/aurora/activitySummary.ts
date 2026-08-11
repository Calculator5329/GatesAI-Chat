// Pure derivations behind the Aurora pack's compact activity header.
// Called by AuroraActivityStream; depends only on ActivityItem contracts.
// Invariant: derivation only — never mutates the items it is handed.
import type { ActivityItem } from '../../../core/types';

export interface ActivitySummaryChip {
  /** Stable key for React and for tests. */
  id: string;
  label: string;
}

export interface ActivitySummary {
  chips: ActivitySummaryChip[];
  /** Wall-clock span of the run, in ms, or null while nothing has finished. */
  elapsedMs: number | null;
  running: boolean;
  failed: boolean;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * Condenses a run of activity rows into the chips shown above the trace:
 * how many tool calls, how many files touched, how many commands, and the
 * net line delta. Counting is deliberately coarse — the chips are a
 * headline, and the exact record stays one click away in the rows below.
 */
export function summarizeActivities(items: ActivityItem[]): ActivitySummary {
  let toolCalls = 0;
  let commands = 0;
  let thinking = 0;
  let added = 0;
  let removed = 0;
  let hasDelta = false;
  let running = false;
  let failed = false;
  let earliest = Number.POSITIVE_INFINITY;
  let latestFinish = 0;

  for (const item of items) {
    if (item.state === 'running') running = true;
    if (item.state === 'failed') failed = true;
    earliest = Math.min(earliest, item.startedAt);
    if (item.finishedAt) latestFinish = Math.max(latestFinish, item.finishedAt);

    switch (item.kind) {
      case 'thinking': thinking += 1; break;
      case 'exec-tail': commands += 1; break;
      case 'tool': toolCalls += 1; break;
      default: break;
    }
    if (typeof item.stats?.added === 'number') { added += item.stats.added; hasDelta = true; }
    if (typeof item.stats?.removed === 'number') { removed += item.stats.removed; hasDelta = true; }
  }

  const chips: ActivitySummaryChip[] = [];
  if (toolCalls > 0) chips.push({ id: 'tools', label: plural(toolCalls, 'tool call') });
  if (commands > 0) chips.push({ id: 'commands', label: plural(commands, 'command') });
  if (thinking > 0) chips.push({ id: 'thinking', label: plural(thinking, 'reasoning step') });
  if (hasDelta) chips.push({ id: 'delta', label: `+${added} −${removed}` });

  const elapsedMs = latestFinish > 0 && Number.isFinite(earliest) ? Math.max(0, latestFinish - earliest) : null;
  return { chips, elapsedMs, running, failed };
}

/** `4.2s` / `1m 06s` — compact enough to sit inside a chip. */
export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}m ${String(rest).padStart(2, '0')}s`;
}

/**
 * The trace lane an activity belongs to. The Aurora pack renders each lane
 * differently (reasoning reads as prose, search as result chips, code as a
 * terminal), which is the whole point of the typed trace.
 */
export type TraceLane = 'reasoning' | 'search' | 'code' | 'file' | 'step';

export function traceLane(item: ActivityItem): TraceLane {
  if (item.kind === 'thinking') return 'reasoning';
  if (item.kind === 'exec-tail') return 'code';
  if (/^(search|grep|find|research|fetch)/i.test(item.verb)) return 'search';
  // Matches the fs/inspect verbs in activityDisplay.ts, present and past tense.
  if (/^(edit|writ|wrote|read|view|inspect|creat|mov|cop|delet|append)/i.test(item.verb)) return 'file';
  return 'step';
}

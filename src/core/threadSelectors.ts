// Pure thread-level selectors shared by stores and UI.
// Depends only on core types; no MobX, no services. The single source of
// truth for spend math and sidebar search matching (previously duplicated
// between ChatStore's getter and module-level helpers).
import type { Model, Thread } from './types';
import type { LlmUsage, ProviderId } from './llm';
import { addUsageToTotals, emptyUsageTotals, type UsageTotals } from './usage';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface UsageModelTotal extends UsageTotals {
  modelId: string;
  modelName: string;
  providerId?: ProviderId;
  costSources: Array<NonNullable<LlmUsage['costSource']>>;
}

export interface UsageDayTotal extends UsageTotals {
  day: string;
  timestamp: number;
}

export interface UsageSummary {
  allTime: UsageTotals;
  last30Days: UsageTotals;
  cloud: UsageTotals;
  local: UsageTotals;
  presentationMode: UsagePresentationMode;
  byModel: UsageModelTotal[];
  byDay: UsageDayTotal[];
}

export type UsagePresentationMode = 'spend-led' | 'local-led';

/** Total LLM spend (USD) recorded on a thread's assistant messages. */
export function threadLlmSpendUsd(thread: Thread | null): number {
  return threadLlmUsageTotal(thread).costUsd;
}

export function threadLlmUsageTotal(thread: Thread | null): UsageTotals {
  const total = emptyUsageTotals();
  if (!thread) return total;
  for (const message of thread.messages) {
    if (message.role !== 'assistant') continue;
    for (const usage of message.usage ?? []) addUsageToTotals(total, usage);
  }
  return total;
}

export function usageAllTimeTotal(threads: readonly Thread[]): UsageTotals {
  const total = emptyUsageTotals();
  for (const entry of iterUsageEntries(threads)) addUsageToTotals(total, entry.usage);
  return total;
}

export function usageCloudLocalTotals(threads: readonly Thread[]): { cloud: UsageTotals; local: UsageTotals } {
  const cloud = emptyUsageTotals();
  const local = emptyUsageTotals();
  for (const entry of iterUsageEntries(threads)) {
    addUsageToTotals(isLocalUsage(entry.usage) ? local : cloud, entry.usage);
  }
  return { cloud, local };
}

export function usagePresentationMode(summary: Pick<UsageSummary, 'allTime' | 'cloud' | 'local'>): UsagePresentationMode {
  return summary.allTime.costUsd === 0 && summary.local.requests > 0 && summary.cloud.requests === 0
    ? 'local-led'
    : 'spend-led';
}

export function usageByModel(
  threads: readonly Thread[],
  models: readonly Model[] = [],
): UsageModelTotal[] {
  const byKey = new Map<string, UsageModelTotal>();
  for (const entry of iterUsageEntries(threads)) {
    const model = findUsageModel(models, entry.modelId, entry.usage);
    const key = model?.id ?? entry.modelId ?? entry.usage.modelId ?? 'unknown';
    const row = byKey.get(key) ?? {
      ...emptyUsageTotals(),
      modelId: key,
      modelName: model?.name ?? entry.usage.modelId ?? entry.modelId ?? 'Unknown model',
      providerId: entry.usage.providerId ?? model?.providerId,
      costSources: [],
    };
    addUsageToTotals(row, entry.usage);
    if (entry.usage.costSource && !row.costSources.includes(entry.usage.costSource)) {
      row.costSources.push(entry.usage.costSource);
    }
    byKey.set(key, row);
  }
  return Array.from(byKey.values()).sort((a, b) =>
    b.costUsd - a.costUsd
    || b.requests - a.requests
    || a.modelName.localeCompare(b.modelName)
  );
}

export function usageByDayLast30(threads: readonly Thread[], now: number): UsageDayTotal[] {
  const todayStart = startOfUtcDay(now);
  const firstStart = todayStart - (29 * DAY_MS);
  const byDay = new Map<string, UsageDayTotal>();
  for (let i = 0; i < 30; i++) {
    const timestamp = firstStart + (i * DAY_MS);
    byDay.set(dayKey(timestamp), {
      ...emptyUsageTotals(),
      day: dayKey(timestamp),
      timestamp,
    });
  }
  const end = todayStart + DAY_MS;
  for (const entry of iterUsageEntries(threads)) {
    if (entry.createdAt < firstStart || entry.createdAt >= end) continue;
    const key = dayKey(entry.createdAt);
    const row = byDay.get(key);
    if (row) addUsageToTotals(row, entry.usage);
  }
  return Array.from(byDay.values());
}

export function usageSummary(
  threads: readonly Thread[],
  models: readonly Model[] = [],
  now: number = Date.now(),
): UsageSummary {
  const byDay = usageByDayLast30(threads, now);
  const split = usageCloudLocalTotals(threads);
  const allTime = usageAllTimeTotal(threads);
  const last30Days = emptyUsageTotals();
  for (const day of byDay) {
    last30Days.requests += day.requests;
    last30Days.promptTokens += day.promptTokens;
    last30Days.completionTokens += day.completionTokens;
    last30Days.totalTokens += day.totalTokens;
    last30Days.costUsd += day.costUsd;
  }
  const summary = {
    allTime,
    last30Days,
    cloud: split.cloud,
    local: split.local,
    presentationMode: 'spend-led' as UsagePresentationMode,
    byModel: usageByModel(threads, models),
    byDay,
  };
  summary.presentationMode = usagePresentationMode(summary);
  return summary;
}

/**
 * Whether a thread matches the sidebar search query. Scans the title, the
 * (legacy) subtitle, and every message body so search reaches conversation
 * content, not just titles. `normalizedQuery` must already be lowercased and
 * trimmed by the caller.
 */
export function threadMatchesSearch(thread: Thread, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  if (`${thread.title} ${thread.subtitle}`.toLowerCase().includes(normalizedQuery)) return true;
  return thread.messages.some(message => message.content.toLowerCase().includes(normalizedQuery));
}

/** A sidebar date bucket: a display label plus the threads that fall in it. */
export interface ThreadDateGroup {
  /** Stable key for React lists (never localized). */
  key: string;
  /** Human-readable header, e.g. `Today` or `This Month`. */
  label: string;
  threads: Thread[];
}

/**
 * Group threads into sidebar date buckets by `updatedAt`, newest first:
 * Today, Yesterday, This Week, This Month, and Older. Week and month buckets
 * use local calendar boundaries so they line up with the dates the user sees.
 * Threads are sorted newest-first (stably for equal timestamps), and empty
 * buckets are omitted.
 */
export function groupThreadsByDate(
  threads: readonly Thread[],
  now: number,
  limit: number = Number.POSITIVE_INFINITY,
): ThreadDateGroup[] {
  const today = startOfLocalDay(now);
  const yesterday = today - DAY_MS;
  const todayDate = new Date(today);
  const dayFromMonday = (todayDate.getDay() + 6) % 7;
  const thisWeek = today - dayFromMonday * DAY_MS;
  const thisMonth = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1).getTime();

  const todayThreads: Thread[] = [];
  const yesterdayThreads: Thread[] = [];
  const weekThreads: Thread[] = [];
  const monthThreads: Thread[] = [];
  const olderThreads: Thread[] = [];

  const sorted = threads
    .map((thread, index) => ({ thread, index }))
    .sort((a, b) => b.thread.updatedAt - a.thread.updatedAt || a.index - b.index)
    .map(({ thread }) => thread)
    .slice(0, Math.max(0, limit));

  for (const thread of sorted) {
    const t = thread.updatedAt;
    if (t >= today) todayThreads.push(thread);
    else if (t >= yesterday) yesterdayThreads.push(thread);
    else if (t >= thisWeek) weekThreads.push(thread);
    else if (t >= thisMonth) monthThreads.push(thread);
    else olderThreads.push(thread);
  }

  const groups: ThreadDateGroup[] = [];
  if (todayThreads.length) groups.push({ key: 'today', label: 'Today', threads: todayThreads });
  if (yesterdayThreads.length) groups.push({ key: 'yesterday', label: 'Yesterday', threads: yesterdayThreads });
  if (weekThreads.length) groups.push({ key: 'week', label: 'This Week', threads: weekThreads });
  if (monthThreads.length) groups.push({ key: 'month', label: 'This Month', threads: monthThreads });
  if (olderThreads.length) groups.push({ key: 'older', label: 'Older', threads: olderThreads });
  return groups;
}

function* iterUsageEntries(threads: readonly Thread[]): Generator<{
  usage: LlmUsage;
  createdAt: number;
  modelId?: string;
}> {
  for (const thread of threads) {
    for (const message of thread.messages) {
      if (message.role !== 'assistant') continue;
      for (const usage of message.usage ?? []) {
        yield {
          usage,
          createdAt: message.createdAt,
          modelId: message.model ?? usage.modelId ?? thread.modelId,
        };
      }
    }
  }
}

function findUsageModel(models: readonly Model[], modelId: string | undefined, usage: LlmUsage): Model | undefined {
  return models.find(model => model.id === modelId)
    ?? models.find(model => usage.modelId && model.providerModelId === usage.modelId)
    ?? models.find(model => model.providerModelId === modelId);
}

function isLocalUsage(usage: LlmUsage): boolean {
  return usage.providerId === 'ollama'
    || usage.providerId === 'local-image'
    || usage.costSource === 'local';
}

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function startOfUtcDay(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function dayKey(timestamp: number): string {
  return new Date(startOfUtcDay(timestamp)).toISOString().slice(0, 10);
}

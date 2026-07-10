import { describe, expect, it } from 'vitest';
import { MODELS } from '../../src/core/models';
import {
  groupThreadsByDate,
  threadLlmSpendUsd,
  threadLlmUsageTotal,
  usageAllTimeTotal,
  usageCloudLocalTotals,
  usageByDayLast30,
  usageByModel,
  usageSummary,
} from '../../src/core/threadSelectors';
import type { Thread } from '../../src/core/types';

describe('thread usage selectors', () => {
  it('aggregates usage across multiple threads and models', () => {
    const threads = [
      thread('t1', 'or-gemini-3-flash', [
        assistant('a1', 'or-gemini-3-flash', Date.UTC(2026, 0, 1), 100, 20, 0.0042),
      ]),
      thread('t2', 'or-gpt-5.4-mini', [
        assistant('a2', 'or-gpt-5.4-mini', Date.UTC(2026, 0, 2), 200, 50, 0.012),
        assistant('a3', 'or-gpt-5.4-mini', Date.UTC(2026, 0, 2), 300, 60, 0.018),
      ]),
    ];

    expect(threadLlmSpendUsd(threads[0])).toBe(0.0042);
    const threadTwoTotal = threadLlmUsageTotal(threads[1]);
    expect(threadTwoTotal).toMatchObject({
      requests: 2,
      promptTokens: 500,
      completionTokens: 110,
      totalTokens: 610,
    });
    expect(threadTwoTotal.costUsd).toBeCloseTo(0.03);

    const allTime = usageAllTimeTotal(threads);
    expect(allTime).toMatchObject({
      requests: 3,
      promptTokens: 600,
      completionTokens: 130,
      totalTokens: 730,
    });
    expect(allTime.costUsd).toBeCloseTo(0.0342);

    const byModel = usageByModel(threads, MODELS);
    expect(byModel.map(row => [row.modelId, row.requests, row.promptTokens, row.completionTokens])).toEqual([
      ['or-gpt-5.4-mini', 2, 500, 110],
      ['or-gemini-3-flash', 1, 100, 20],
    ]);
    expect(byModel[0].costUsd).toBeCloseTo(0.03);
    expect(byModel[1].costUsd).toBeCloseTo(0.0042);
    expect(byModel[0].modelName).toBe('GPT-5.4 mini');
  });

  it('buckets the last 30 days across a month boundary with a fixed clock', () => {
    const now = Date.UTC(2026, 0, 2, 12);
    const threads = [
      thread('t1', 'or-gemini-3-flash', [
        assistant('old', 'or-gemini-3-flash', Date.UTC(2025, 11, 3, 23), 100, 20, 0.001),
        assistant('dec31', 'or-gemini-3-flash', Date.UTC(2025, 11, 31, 9), 200, 40, 0.002),
        assistant('jan1', 'or-gemini-3-flash', Date.UTC(2026, 0, 1, 15), 300, 60, 0.003),
      ]),
    ];

    const days = usageByDayLast30(threads, now);
    expect(days).toHaveLength(30);
    expect(days[0].day).toBe('2025-12-04');
    expect(days[29].day).toBe('2026-01-02');
    expect(days.find(day => day.day === '2025-12-03')).toBeUndefined();
    expect(days.find(day => day.day === '2025-12-31')).toMatchObject({
      requests: 1,
      promptTokens: 200,
      completionTokens: 40,
      costUsd: 0.002,
    });
    expect(days.find(day => day.day === '2026-01-01')).toMatchObject({
      requests: 1,
      totalTokens: 360,
      costUsd: 0.003,
    });
  });

  it('splits cloud spend from local free tokens and selects local-led mode', () => {
    const threads = [
      thread('local', 'ollama-qwen2.5:7b', [
        assistant('a1', 'ollama-qwen2.5:7b', Date.UTC(2026, 0, 1), 320, 80, 0, 'ollama'),
      ]),
    ];

    const split = usageCloudLocalTotals(threads);
    expect(split.cloud.requests).toBe(0);
    expect(split.cloud.costUsd).toBe(0);
    expect(split.local).toMatchObject({
      requests: 1,
      promptTokens: 320,
      completionTokens: 80,
      totalTokens: 400,
      costUsd: 0,
    });

    const summary = usageSummary(threads, MODELS, Date.UTC(2026, 0, 2));
    expect(summary.presentationMode).toBe('local-led');
  });

  it('keeps spend-led mode when zero-cost cloud usage is present', () => {
    const threads = [
      thread('mixed', 'or-nemotron-3-super-free', [
        assistant('free-cloud', 'or-nemotron-3-super-free', Date.UTC(2026, 0, 1), 100, 20, 0),
        assistant('local', 'ollama-llama3.2:3b', Date.UTC(2026, 0, 1), 200, 50, 0, 'ollama'),
      ]),
    ];

    const summary = usageSummary(threads, MODELS, Date.UTC(2026, 0, 2));
    expect(summary.cloud.requests).toBe(1);
    expect(summary.local.requests).toBe(1);
    expect(summary.presentationMode).toBe('spend-led');
  });
});

describe('groupThreadsByDate', () => {
  // Noon UTC keeps every relative offset safely inside its bucket regardless of
  // the local timezone the test runs in (local-day boundaries never split a
  // whole-day offset from a mid-day reference point).
  const now = Date.UTC(2026, 5, 15, 12);

  it('uses local midnight, week, and month boundaries for the five buckets', () => {
    const localNow = new Date(2026, 5, 17, 12).getTime(); // Wednesday
    const groups = groupThreadsByDate([
      datedThread('today', new Date(2026, 5, 17, 0).getTime()),
      datedThread('yesterday', new Date(2026, 5, 16, 0).getTime()),
      datedThread('week', new Date(2026, 5, 15, 0).getTime()),
      datedThread('month', new Date(2026, 5, 1, 0).getTime()),
      datedThread('older', new Date(2026, 4, 31, 23, 59, 59, 999).getTime()),
    ], localNow);

    expect(groups.map(g => [g.label, g.threads.map(t => t.id)])).toEqual([
      ['Today', ['today']],
      ['Yesterday', ['yesterday']],
      ['This Week', ['week']],
      ['This Month', ['month']],
      ['Older', ['older']],
    ]);
  });

  it('puts dates before this month into one Older bucket', () => {
    const groups = groupThreadsByDate([
      datedThread('mar-a', Date.UTC(2026, 2, 20, 12)),
      datedThread('mar-b', Date.UTC(2026, 2, 5, 12)),
      datedThread('jan', Date.UTC(2026, 0, 10, 12)),
      datedThread('dec', Date.UTC(2025, 11, 25, 12)),
    ], now);

    expect(groups.map(g => [g.label, g.key, g.threads.map(t => t.id)])).toEqual([
      ['Older', 'older', ['mar-a', 'mar-b', 'jan', 'dec']],
    ]);
  });

  it('sorts newest-first within a bucket and is stable for equal timestamps', () => {
    const groups = groupThreadsByDate([
      datedThread('older', now - 2000),
      datedThread('tie-a', now - 1000),
      datedThread('newer', now - 500),
      datedThread('tie-b', now - 1000),
    ], now);

    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Today');
    expect(groups[0].threads.map(t => t.id)).toEqual(['newer', 'tie-a', 'tie-b', 'older']);
  });

  it('omits empty buckets and returns [] for no threads', () => {
    expect(groupThreadsByDate([], now)).toEqual([]);
    const groups = groupThreadsByDate([datedThread('only', now)], now);
    expect(groups.map(g => g.label)).toEqual(['Today']);
  });
});

function datedThread(id: string, updatedAt: number): Thread {
  return {
    id,
    title: id,
    subtitle: '',
    createdAt: updatedAt,
    updatedAt,
    pinned: false,
    modelId: 'or-gpt-5.4-mini',
    messages: [],
  };
}

function thread(id: string, modelId: string, messages: Thread['messages']): Thread {
  return {
    id,
    title: id,
    subtitle: '',
    createdAt: Date.UTC(2025, 11, 1),
    updatedAt: Date.UTC(2026, 0, 2),
    pinned: false,
    modelId,
    messages,
  };
}

function assistant(
  id: string,
  model: string,
  createdAt: number,
  promptTokens: number,
  completionTokens: number,
  costUsd: number,
  providerId: 'openrouter' | 'ollama' = 'openrouter',
): Thread['messages'][number] {
  return {
    id,
    role: 'assistant',
    content: 'done',
    createdAt,
    model,
    usage: [{
      providerId,
      modelId: MODELS.find(item => item.id === model)?.providerModelId ?? model,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      costUsd,
      costSource: providerId === 'ollama' ? 'local' : 'provider',
    }],
  };
}

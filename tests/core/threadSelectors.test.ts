import { describe, expect, it } from 'vitest';
import { MODELS } from '../../src/core/models';
import {
  threadLlmSpendUsd,
  threadLlmUsageTotal,
  usageAllTimeTotal,
  usageByDayLast30,
  usageByModel,
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
});

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
): Thread['messages'][number] {
  return {
    id,
    role: 'assistant',
    content: 'done',
    createdAt,
    model,
    usage: [{
      providerId: 'openrouter',
      modelId: MODELS.find(item => item.id === model)?.providerModelId ?? model,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      costUsd,
      costSource: 'provider',
    }],
  };
}

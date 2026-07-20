import { describe, expect, it } from 'vitest';
import { evaluateRankings, percentile, type EvaluationCase } from '../../scripts/rag-eval/metrics';
import corpusJson from '../fixtures/rag-eval/corpus.json';

interface CorpusSource {
  sourceId: string;
  sourceType: string;
  role?: string;
  text: string;
}
interface CorpusCase extends EvaluationCase { query: string }
interface Corpus { sources: CorpusSource[]; cases: CorpusCase[] }

const corpus = corpusJson as Corpus;

describe('semantic-memory evaluation corpus', () => {
  it('is frozen, valid, synthetic, and covers every required category', () => {
    expect(corpus.cases.length).toBeGreaterThanOrEqual(40);
    const sourceIds = corpus.sources.map(source => source.sourceId);
    const caseIds = corpus.cases.map(testCase => testCase.caseId);
    expect(new Set(sourceIds).size).toBe(sourceIds.length);
    expect(new Set(caseIds).size).toBe(caseIds.length);
    expect(corpus.sources.every(source => source.text.trim() && ['message', 'note', 'memory'].includes(source.sourceType))).toBe(true);
    expect(corpus.sources.filter(source => source.sourceType === 'message').every(source => source.role === 'user' || source.role === 'assistant')).toBe(true);
    const known = new Set(sourceIds);
    for (const testCase of corpus.cases) {
      expect(testCase.query.trim()).not.toBe('');
      expect([...testCase.relevantSourceIds, ...testCase.forbiddenSourceIds].every(id => known.has(id))).toBe(true);
      if (testCase.automaticRecallShouldBeEmpty) expect(testCase.relevantSourceIds).toHaveLength(0);
    }
    for (const category of ['paraphrase', 'exact-identifier', 'recency-conflict', 'elliptical-follow-up', 'multi-source', 'no-match', 'deleted-excluded', 'adversarial']) {
      expect(corpus.cases.filter(testCase => testCase.category === category).length).toBeGreaterThanOrEqual(5);
    }
    const serialized = JSON.stringify(corpus);
    expect(serialized).not.toMatch(/\/home\/|api[_-]?key\s*[:=]/i);
  });
});

describe('semantic-memory metrics', () => {
  const base: EvaluationCase = {
    caseId: 'metric',
    category: 'metric',
    relevantSourceIds: ['a'],
    forbiddenSourceIds: ['blocked'],
    automaticRecallShouldBeEmpty: false,
  };

  it('scores a perfect ranking', () => {
    const metrics = evaluateRankings([{ testCase: base, rankedSourceIds: ['a', 'b'] }]);
    expect(metrics).toMatchObject({ recallAt1: 1, recallAt5: 1, mrrAt5: 1, ndcgAt5: 1, forbiddenViolations: 0 });
  });

  it('scores partial and tied-order rankings deterministically', () => {
    const metrics = evaluateRankings([{
      testCase: { ...base, relevantSourceIds: ['a', 'c'] },
      rankedSourceIds: ['b', 'a', 'c'],
    }]);
    expect(metrics.recallAt1).toBe(0);
    expect(metrics.recallAt3).toBe(1);
    expect(metrics.mrrAt5).toBe(0.5);
    expect(metrics.ndcgAt5).toBeGreaterThan(0.6);
  });

  it('counts no-match injections, forbidden hits, and duplicates', () => {
    const metrics = evaluateRankings([{
      testCase: { ...base, relevantSourceIds: [], automaticRecallShouldBeEmpty: true },
      rankedSourceIds: ['blocked', 'blocked'],
    }]);
    expect(metrics.falseInjectionRate).toBe(1);
    expect(metrics.forbiddenViolations).toBe(2);
    expect(metrics.duplicateSourceRateAt5).toBe(0.5);
  });

  it('handles empty rankings and nearest-rank percentiles', () => {
    expect(evaluateRankings([{ testCase: base, rankedSourceIds: [] }]).mrrAt5).toBe(0);
    expect(percentile([8, 1, 4, 2], 0.5)).toBe(2);
    expect(percentile([8, 1, 4, 2], 0.95)).toBe(8);
    expect(percentile([], 0.95)).toBe(0);
  });
});

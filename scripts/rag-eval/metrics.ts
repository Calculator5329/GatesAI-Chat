export interface EvaluationCase {
  caseId: string;
  category: string;
  relevantSourceIds: string[];
  forbiddenSourceIds: string[];
  automaticRecallShouldBeEmpty: boolean;
}

export interface RankedCase {
  testCase: EvaluationCase;
  rankedSourceIds: string[];
}

export interface EvaluationMetrics {
  recallAt1: number;
  recallAt3: number;
  recallAt5: number;
  mrrAt5: number;
  ndcgAt5: number;
  falseInjectionRate: number;
  forbiddenViolations: number;
  duplicateSourceRateAt5: number;
}

export function evaluateRankings(cases: RankedCase[]): EvaluationMetrics {
  const labelled = cases.filter(item => item.testCase.relevantSourceIds.length > 0);
  const noMatch = cases.filter(item => item.testCase.automaticRecallShouldBeEmpty);
  const mean = (values: number[]): number => values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;

  return {
    recallAt1: mean(labelled.map(item => recallAt(item, 1))),
    recallAt3: mean(labelled.map(item => recallAt(item, 3))),
    recallAt5: mean(labelled.map(item => recallAt(item, 5))),
    mrrAt5: mean(labelled.map(reciprocalRankAt5)),
    ndcgAt5: mean(labelled.map(ndcgAt5)),
    falseInjectionRate: mean(noMatch.map(item => item.rankedSourceIds.length > 0 ? 1 : 0)),
    forbiddenViolations: cases.reduce((count, item) => count + item.rankedSourceIds
      .slice(0, 5)
      .filter(id => item.testCase.forbiddenSourceIds.includes(id)).length, 0),
    duplicateSourceRateAt5: mean(cases.map(item => {
      const top = item.rankedSourceIds.slice(0, 5);
      return top.length === 0 ? 0 : (top.length - new Set(top).size) / top.length;
    })),
  };
}

export function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(quantile * sorted.length) - 1));
  return sorted[index];
}

function recallAt(item: RankedCase, k: number): number {
  const relevant = new Set(item.testCase.relevantSourceIds);
  if (relevant.size === 0) return 0;
  const found = new Set(item.rankedSourceIds.slice(0, k).filter(id => relevant.has(id)));
  return found.size / relevant.size;
}

function reciprocalRankAt5(item: RankedCase): number {
  const relevant = new Set(item.testCase.relevantSourceIds);
  const index = item.rankedSourceIds.slice(0, 5).findIndex(id => relevant.has(id));
  return index < 0 ? 0 : 1 / (index + 1);
}

function ndcgAt5(item: RankedCase): number {
  const relevant = new Set(item.testCase.relevantSourceIds);
  const dcg = item.rankedSourceIds.slice(0, 5).reduce((score, id, index) => (
    score + (relevant.has(id) ? 1 / Math.log2(index + 2) : 0)
  ), 0);
  const idealCount = Math.min(5, relevant.size);
  let ideal = 0;
  for (let index = 0; index < idealCount; index += 1) ideal += 1 / Math.log2(index + 2);
  return ideal === 0 ? 0 : dcg / ideal;
}

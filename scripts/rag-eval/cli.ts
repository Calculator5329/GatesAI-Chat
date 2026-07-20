import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { OllamaEmbeddingClient } from '../../src/services/rag/embeddings.ts';
import {
  RagVectorStore,
  type RagChunk,
  type RagChunkPersistence,
  type StoredRagChunk,
} from '../../src/services/rag/vectorStore.ts';
import { evaluateRankings, percentile, type EvaluationCase, type RankedCase } from './metrics.ts';
import { lexicalSearch } from '../../src/services/rag/lexical.ts';
import { rankHybrid } from '../../src/services/rag/retrieval.ts';

interface CorpusSource {
  sourceId: string;
  sourceType: 'message' | 'note' | 'memory';
  role?: 'user' | 'assistant';
  title?: string;
  timestamp: string;
  text: string;
  excluded?: boolean;
  deleted?: boolean;
}

interface CorpusCase extends EvaluationCase { query: string }
interface Corpus { version: number; sources: CorpusSource[]; cases: CorpusCase[] }

class MemoryPersistence implements RagChunkPersistence {
  private readonly chunks = new Map<string, StoredRagChunk>();
  async all(): Promise<StoredRagChunk[]> { return [...this.chunks.values()]; }
  async putMany(chunks: StoredRagChunk[]): Promise<void> { chunks.forEach(chunk => this.chunks.set(chunk.id, chunk)); }
  async deleteIds(ids: string[]): Promise<void> { ids.forEach(id => this.chunks.delete(id)); }
  async clear(): Promise<void> { this.chunks.clear(); }
  async count(): Promise<number> { return this.chunks.size; }
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log('Usage: npm run rag:eval -- --model <name> [--base-url <local-url>] [--out <report.md>] [--json]');
  process.exit(0);
}

const model = args.model;
if (!model) throw new Error('Missing --model. The benchmark never downloads a model; pass an installed Ollama embedding model.');
const baseUrl = args.baseUrl ?? 'http://127.0.0.1:11434';
const corpusPath = fileURLToPath(new URL('../../tests/fixtures/rag-eval/corpus.json', import.meta.url));
const corpus = JSON.parse(await readFile(corpusPath, 'utf8')) as Corpus;
const embedder = new OllamaEmbeddingClient({ getBaseUrl: () => baseUrl });
const store = new RagVectorStore(new MemoryPersistence());

const activeSources = corpus.sources.filter(source => !source.deleted && !source.excluded);
const indexStart = performance.now();
const sourceVectors = await embedder.embed(activeSources.map(source => source.text), model);
const chunks: RagChunk[] = activeSources.map((source, index) => ({
  id: `eval:${source.sourceId}`,
  sourceType: source.sourceType,
  sourceId: source.sourceId,
  text: source.text,
  vector: sourceVectors[index],
  updatedAt: Date.parse(source.timestamp),
  model,
  ...(source.role ? { role: source.role } : {}),
  ...(source.title ? { sourceTitle: source.title } : {}),
}));
await store.putMany(chunks);
const indexDurationMs = performance.now() - indexStart;

const queryEmbeddingMs: number[] = [];
const rankingMs: number[] = [];
const caseDiagnostics: Array<{
  caseId: string;
  denseTopScore: number;
  lexicalTopScore: number;
  selectedSourceIds: string[];
}> = [];
const ablations: Record<string, RankedCase[]> = {
  dense: [],
  lexical: [],
  fusion: [],
  'fusion+diversity': [],
  selected: [],
};
for (const testCase of corpus.cases) {
  const queryStart = performance.now();
  const [queryVector] = await embedder.embed([testCase.query], model);
  queryEmbeddingMs.push(performance.now() - queryStart);
  const rankStart = performance.now();
  const dense = await store.search(queryVector, model, 5);
  const lexical = lexicalSearch(testCase.query, await store.activeChunks(model), 5);
  const request = { query: testCase.query, purpose: 'explicit_recall' as const, limit: 5 };
  const fusion = await rankHybrid({ request, model, queryVector, vectorStore: store, diversify: false, calibrate: false });
  const diverse = await rankHybrid({ request, model, queryVector, vectorStore: store, diversify: true, calibrate: false });
  const selected = await rankHybrid({
    request: {
      ...request,
      purpose: testCase.automaticRecallShouldBeEmpty ? 'automatic_context' : 'explicit_recall',
    },
    model,
    queryVector,
    vectorStore: store,
  });
  rankingMs.push(performance.now() - rankStart);
  ablations.dense.push({ testCase, rankedSourceIds: dense.map(result => result.chunk.sourceId) });
  ablations.lexical.push({ testCase, rankedSourceIds: lexical.map(result => result.chunk.sourceId) });
  ablations.fusion.push({ testCase, rankedSourceIds: fusion.map(result => result.sourceId) });
  ablations['fusion+diversity'].push({ testCase, rankedSourceIds: diverse.map(result => result.sourceId) });
  ablations.selected.push({ testCase, rankedSourceIds: selected.map(result => result.sourceId) });
  caseDiagnostics.push({
    caseId: testCase.caseId,
    denseTopScore: dense[0]?.score ?? 0,
    lexicalTopScore: lexical[0]?.score ?? 0,
    selectedSourceIds: selected.map(result => result.sourceId),
  });
}

const rankings = ablations.selected;
const metrics = evaluateRankings(rankings);
const ablationMetrics = Object.fromEntries(Object.entries(ablations)
  .map(([name, values]) => [name, evaluateRankings(values)]));
const failedCases = rankings.flatMap(item => {
  const top = item.rankedSourceIds.slice(0, 5);
  const missing = item.testCase.relevantSourceIds.filter(id => !top.includes(id));
  const forbidden = top.filter(id => item.testCase.forbiddenSourceIds.includes(id));
  const falseInjection = item.testCase.automaticRecallShouldBeEmpty && top.length > 0;
  return missing.length > 0 || forbidden.length > 0 || falseInjection
    ? [{ caseId: item.testCase.caseId, missing, forbidden, falseInjection }]
    : [];
});
const exactIdentifierRecallAt5 = evaluateRankings(rankings.filter(item => item.testCase.category === 'exact-identifier')).recallAt5;
const factIds = new Set(corpus.sources.filter(source => source.sourceType === 'memory').map(source => source.sourceId));
const durableFactRecallAt5 = evaluateRankings(rankings.filter(item => item.testCase.relevantSourceIds.some(id => factIds.has(id)))).recallAt5;

const scaleStore = new RagVectorStore(new MemoryPersistence());
await scaleStore.putMany(Array.from({ length: 10_000 }, (_, index) => ({
  id: `scale:${index}`,
  sourceType: 'note' as const,
  sourceId: `scale-${index}`,
  text: `Synthetic scale document ${index} identifier SCALE-${index}`,
  vector: sourceVectors[index % sourceVectors.length],
  updatedAt: index,
  model,
})));
const scaleRankingMs: number[] = [];
for (let index = 0; index < 20; index += 1) {
  const started = performance.now();
  await rankHybrid({
    request: { query: `SCALE-${index * 337}`, purpose: 'explicit_recall', limit: 5 },
    model,
    queryVector: sourceVectors[index % sourceVectors.length],
    vectorStore: scaleStore,
  });
  scaleRankingMs.push(performance.now() - started);
}
const byCategory = Object.fromEntries([...new Set(corpus.cases.map(item => item.category))].map(category => {
  const subset = rankings.filter(item => item.testCase.category === category);
  return [category, evaluateRankings(subset)];
}));
const report = {
  generatedAt: new Date().toISOString(),
  model,
  corpusVersion: corpus.version,
  caseCount: corpus.cases.length,
  metrics,
  gateMetrics: { exactIdentifierRecallAt5, durableFactRecallAt5 },
  ablations: ablationMetrics,
  byCategory,
  caseDiagnostics,
  failedCases,
  latencyMs: {
    index: indexDurationMs,
    queryEmbeddingP50: percentile(queryEmbeddingMs, 0.5),
    queryEmbeddingP95: percentile(queryEmbeddingMs, 0.95),
    rankingP50: percentile(rankingMs, 0.5),
    rankingP95: percentile(rankingMs, 0.95),
    scale10kRankingP95: percentile(scaleRankingMs, 0.95),
  },
};

const rendered = args.json ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report);
if (args.out) await writeFile(args.out, rendered, 'utf8');
console.log(rendered.trimEnd());

function parseArgs(values: string[]): { model?: string; baseUrl?: string; out?: string; json: boolean; help: boolean } {
  const parsed: { model?: string; baseUrl?: string; out?: string; json: boolean; help: boolean } = { json: false, help: false };
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value === '--help' || value === '-h') parsed.help = true;
    else if (value === '--json') parsed.json = true;
    else if (value === '--model') parsed.model = values[++i];
    else if (value === '--base-url') parsed.baseUrl = values[++i];
    else if (value === '--out') parsed.out = values[++i];
    else throw new Error(`Unknown argument: ${value}`);
  }
  return parsed;
}

function renderMarkdown(report: typeof report): string {
  const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;
  const ablationRows = Object.entries(report.ablations).map(([name, value]) => (
    `| ${name} | ${pct(value.recallAt5)} | ${value.mrrAt5.toFixed(3)} | ${pct(value.falseInjectionRate)} | ${value.forbiddenViolations} |`
  )).join('\n');
  const failureRows = report.failedCases.length === 0
    ? '- None.'
    : report.failedCases.map(item => `- ${item.caseId}: missing [${item.missing.join(', ')}], forbidden [${item.forbidden.join(', ')}], false injection ${item.falseInjection}.`).join('\n');
  return `# Semantic memory evaluation\n\n- Generated: ${report.generatedAt}\n- Model: \`${report.model}\`\n- Corpus: v${report.corpusVersion}, ${report.caseCount} cases\n- Runtime: local Ollama (base URL redacted)\n\n## Quality\n\n| Metric | Result |\n|---|---:|\n| Recall@1 | ${pct(report.metrics.recallAt1)} |\n| Recall@3 | ${pct(report.metrics.recallAt3)} |\n| Recall@5 | ${pct(report.metrics.recallAt5)} |\n| MRR@5 | ${report.metrics.mrrAt5.toFixed(3)} |\n| nDCG@5 | ${report.metrics.ndcgAt5.toFixed(3)} |\n| Exact-identifier Recall@5 | ${pct(report.gateMetrics.exactIdentifierRecallAt5)} |\n| Durable-fact Recall@5 | ${pct(report.gateMetrics.durableFactRecallAt5)} |\n| No-match false-injection | ${pct(report.metrics.falseInjectionRate)} |\n| Forbidden violations | ${report.metrics.forbiddenViolations} |\n| Duplicate-source rate@5 | ${pct(report.metrics.duplicateSourceRateAt5)} |\n\n## Ablations\n\n| Configuration | Recall@5 | MRR@5 | False injection | Forbidden |\n|---|---:|---:|---:|---:|\n${ablationRows}\n\nSelected policy: lexical-weighted reciprocal-rank fusion, source diversity, and conservative no-match calibration.\n\n## Failed cases\n\n${failureRows}\n\n## Latency\n\n| Stage | p50 | p95 |\n|---|---:|---:|\n| Query embedding | ${report.latencyMs.queryEmbeddingP50.toFixed(1)} ms | ${report.latencyMs.queryEmbeddingP95.toFixed(1)} ms |\n| Local ranking | ${report.latencyMs.rankingP50.toFixed(1)} ms | ${report.latencyMs.rankingP95.toFixed(1)} ms |\n| Local ranking, 10,000 chunks | — | ${report.latencyMs.scale10kRankingP95.toFixed(1)} ms |\n\nIndex duration: ${report.latencyMs.index.toFixed(1)} ms.\n`;
}

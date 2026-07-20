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
}));
await store.putMany(chunks);
const indexDurationMs = performance.now() - indexStart;

const queryEmbeddingMs: number[] = [];
const rankingMs: number[] = [];
const rankings: RankedCase[] = [];
for (const testCase of corpus.cases) {
  const queryStart = performance.now();
  const [queryVector] = await embedder.embed([testCase.query], model);
  queryEmbeddingMs.push(performance.now() - queryStart);
  const rankStart = performance.now();
  const raw = await store.search(queryVector, model, 5);
  rankingMs.push(performance.now() - rankStart);
  rankings.push({
    testCase,
    rankedSourceIds: testCase.automaticRecallShouldBeEmpty
      ? raw.filter(result => result.score >= 0.55).map(result => result.chunk.sourceId)
      : raw.map(result => result.chunk.sourceId),
  });
}

const metrics = evaluateRankings(rankings);
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
  byCategory,
  latencyMs: {
    index: indexDurationMs,
    queryEmbeddingP50: percentile(queryEmbeddingMs, 0.5),
    queryEmbeddingP95: percentile(queryEmbeddingMs, 0.95),
    rankingP50: percentile(rankingMs, 0.5),
    rankingP95: percentile(rankingMs, 0.95),
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
  return `# Semantic memory evaluation\n\n- Generated: ${report.generatedAt}\n- Model: \`${report.model}\`\n- Corpus: v${report.corpusVersion}, ${report.caseCount} cases\n- Runtime: local Ollama (base URL redacted)\n\n## Quality\n\n| Metric | Result |\n|---|---:|\n| Recall@1 | ${pct(report.metrics.recallAt1)} |\n| Recall@3 | ${pct(report.metrics.recallAt3)} |\n| Recall@5 | ${pct(report.metrics.recallAt5)} |\n| MRR@5 | ${report.metrics.mrrAt5.toFixed(3)} |\n| nDCG@5 | ${report.metrics.ndcgAt5.toFixed(3)} |\n| No-match false-injection | ${pct(report.metrics.falseInjectionRate)} |\n| Forbidden violations | ${report.metrics.forbiddenViolations} |\n| Duplicate-source rate@5 | ${pct(report.metrics.duplicateSourceRateAt5)} |\n\n## Latency\n\n| Stage | p50 | p95 |\n|---|---:|---:|\n| Query embedding | ${report.latencyMs.queryEmbeddingP50.toFixed(1)} ms | ${report.latencyMs.queryEmbeddingP95.toFixed(1)} ms |\n| Local ranking | ${report.latencyMs.rankingP50.toFixed(1)} ms | ${report.latencyMs.rankingP95.toFixed(1)} ms |\n\nIndex duration: ${report.latencyMs.index.toFixed(1)} ms.\n`;
}

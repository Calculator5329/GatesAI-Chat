import type { RagEmbedder } from './embeddings';
import { lexicalSearch } from './lexical';
import { tokenizeForRecall } from './lexical';
import type { RagChunk, RagVectorStore } from './vectorStore';
import type { RetrievalTrace } from '../../core/types';

export type RagRetrievalPurpose = 'explicit_recall' | 'automatic_context';

export interface RagSourcePolicy {
  sourceTypes?: Array<RagChunk['sourceType']>;
  excludedReferences?: string[];
}

export interface RagRetrievalRequest {
  query: string;
  purpose: RagRetrievalPurpose;
  activeThreadId?: string;
  limit: number;
  sourcePolicy?: RagSourcePolicy;
}

export interface RagRetrievalResult {
  reference: string;
  sourceType: RagChunk['sourceType'];
  sourceId: string;
  threadId?: string;
  sourceTitle?: string;
  role?: 'user' | 'assistant';
  text: string;
  updatedAt: number;
  denseRank?: number;
  denseScore?: number;
  lexicalRank?: number;
  lexicalScore?: number;
  fusedRank: number;
  fusedScore: number;
  chunk: RagChunk;
}

export interface RagContextBundle {
  evidenceMessage: string;
  trace?: RetrievalTrace;
}

export const EMPTY_RAG_CONTEXT: RagContextBundle = { evidenceMessage: '' };

export const RAG_CANDIDATE_POOL = 40;
export const RAG_RRF_K = 60;
export const RAG_UNKNOWN_MODEL_MIN_DENSE_SCORE = 0.66;

export async function retrieveHybrid(options: {
  request: RagRetrievalRequest;
  model: string;
  embedder: RagEmbedder;
  vectorStore: RagVectorStore;
}): Promise<RagRetrievalResult[]> {
  const query = options.request.query.trim();
  if (!query || options.request.limit <= 0) return [];
  const [queryVector] = await options.embedder.embed([query], options.model);
  if (!queryVector) return [];
  return rankHybrid({
    request: options.request,
    model: options.model,
    queryVector,
    vectorStore: options.vectorStore,
  });
}

export async function rankHybrid(options: {
  request: RagRetrievalRequest;
  model: string;
  queryVector: Float32Array;
  vectorStore: RagVectorStore;
  diversify?: boolean;
  calibrate?: boolean;
}): Promise<RagRetrievalResult[]> {
  const query = options.request.query.trim();
  if (!query || options.request.limit <= 0) return [];
  const all = (await options.vectorStore.activeChunks(options.model)).filter(chunk => allowed(chunk, options.request));
  const dense = (await options.vectorStore.search(options.queryVector, options.model, RAG_CANDIDATE_POOL))
    .filter(result => allowed(result.chunk, options.request));
  const lexical = lexicalSearch(query, all, RAG_CANDIDATE_POOL);
  const fused = new Map<string, RagRetrievalResult>();
  dense.forEach((result, index) => {
    const item = createResult(result.chunk);
    item.denseRank = index + 1;
    item.denseScore = result.score;
    item.fusedScore += 1 / (RAG_RRF_K + index + 1);
    fused.set(result.chunk.id, item);
  });
  lexical.forEach((result, index) => {
    const item = fused.get(result.chunk.id) ?? createResult(result.chunk);
    item.lexicalRank = index + 1;
    item.lexicalScore = result.score;
    item.fusedScore += 1.15 / (RAG_RRF_K + index + 1);
    fused.set(result.chunk.id, item);
  });
  const ranked = [...fused.values()]
    .filter(result => options.request.purpose === 'explicit_recall'
      || options.calibrate === false
      || passesAutomaticNoMatch(result))
    .sort((a, b) => b.fusedScore - a.fusedScore
      || (b.lexicalScore ?? 0) - (a.lexicalScore ?? 0)
      || b.updatedAt - a.updatedAt
      || a.reference.localeCompare(b.reference));
  const conflictFiltered = applyRecencyConflictPolicy(query, ranked);
  const diversified: RagRetrievalResult[] = [];
  const sourceCounts = new Map<string, number>();
  for (const result of conflictFiltered) {
    const source = result.threadId ? `thread:${result.threadId}` : `${result.sourceType}:${result.sourceId}`;
    const maxPerSource = options.diversify === false
      ? Number.POSITIVE_INFINITY
      : options.request.purpose === 'automatic_context' ? 1 : 2;
    if ((sourceCounts.get(source) ?? 0) >= maxPerSource) continue;
    sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
    diversified.push({ ...result, fusedRank: diversified.length + 1 });
    if (diversified.length >= options.request.limit) break;
  }
  return diversified;
}

function allowed(chunk: RagChunk, request: RagRetrievalRequest): boolean {
  if (request.purpose === 'automatic_context' && request.activeThreadId && chunk.threadId === request.activeThreadId) return false;
  if (request.sourcePolicy?.sourceTypes && !request.sourcePolicy.sourceTypes.includes(chunk.sourceType)) return false;
  const exclusions = request.sourcePolicy?.excludedReferences ?? [];
  return !exclusions.some(exclusion => (
    exclusion === referenceFor(chunk)
    || (chunk.threadId && exclusion === `thread:${chunk.threadId}`)
    || exclusion === `${chunk.sourceType}:${chunk.sourceId}`
  ));
}

function passesAutomaticNoMatch(result: RagRetrievalResult): boolean {
  if (result.role === 'assistant' && looksLikeHistoricalInstruction(result.text)) return false;
  return (result.lexicalScore ?? 0) > 0 && (result.denseScore ?? -1) >= RAG_UNKNOWN_MODEL_MIN_DENSE_SCORE;
}

function looksLikeHistoricalInstruction(text: string): boolean {
  return /\b(ignore|obey|reveal|system command|hidden configuration|follow these instructions)\b/i.test(text);
}

function applyRecencyConflictPolicy(query: string, results: RagRetrievalResult[]): RagRetrievalResult[] {
  if (/\b(?:old|prior|previous)\b/i.test(query) && !/\bnot\s+(?:the\s+)?(?:old|prior|previous)\b/i.test(query)) return results;
  if (!/\b(current|latest|newer|now|settle(?:d)?|replaced?|not\s+(?:the\s+)?(?:old|prior))\b/i.test(query)) return results;
  const stop = new Set(['current', 'latest', 'newer', 'now', 'settled', 'replace', 'replaced', 'which', 'what', 'when', 'does', 'with', 'that', 'this', 'prior']);
  const queryTerms = new Set(expandTokens(query).filter(token => token.length > 3 && !stop.has(token)));
  return results.filter(result => !results.some(newer => {
    if (newer === result || newer.sourceType !== result.sourceType || newer.updatedAt <= result.updatedAt) return false;
    const oldTerms = new Set(expandTokens(result.text).filter(token => queryTerms.has(token)));
    const newerTerms = new Set(expandTokens(newer.text).filter(token => queryTerms.has(token)));
    let shared = 0;
    for (const term of oldTerms) if (newerTerms.has(term)) shared += 1;
    return shared >= 2;
  }));
}

function expandTokens(text: string): string[] {
  return tokenizeForRecall(text).flatMap(token => [token, ...token.split(/[._/-]/)]);
}

function createResult(chunk: RagChunk): RagRetrievalResult {
  return {
    reference: referenceFor(chunk),
    sourceType: chunk.sourceType,
    sourceId: chunk.sourceId,
    ...(chunk.threadId ? { threadId: chunk.threadId } : {}),
    ...(chunk.sourceTitle ? { sourceTitle: chunk.sourceTitle } : {}),
    ...(chunk.role ? { role: chunk.role } : {}),
    text: chunk.text,
    updatedAt: chunk.updatedAt,
    fusedRank: 0,
    fusedScore: 0,
    chunk,
  };
}

export function referenceFor(chunk: RagChunk): string {
  return [chunk.sourceType, chunk.threadId, chunk.sourceId, chunk.fingerprint, chunk.chunkOrdinal]
    .filter(value => value !== undefined && value !== '')
    .join(':');
}

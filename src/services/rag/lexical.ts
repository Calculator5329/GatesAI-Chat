import type { RagChunk } from './vectorStore';

export interface LexicalResult {
  chunk: RagChunk;
  score: number;
}

export function tokenizeForRecall(text: string): string[] {
  return text.toLocaleLowerCase().match(/[\p{L}\p{N}]+(?:[._/-][\p{L}\p{N}]+)*/gu) ?? [];
}

/** Dependency-free BM25 over one immutable active generation. */
export function lexicalSearch(query: string, chunks: RagChunk[], limit: number): LexicalResult[] {
  const queryTokens = [...new Set(expandQueryTokens(tokenizeForRecall(query)))];
  if (queryTokens.length === 0 || chunks.length === 0) return [];
  const documents = chunks.map(chunk => tokenizeForRecall(searchableText(chunk)));
  const averageLength = documents.reduce((sum, tokens) => sum + tokens.length, 0) / documents.length || 1;
  const documentFrequency = new Map<string, number>();
  for (const tokens of documents) {
    for (const token of new Set(tokens)) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
  }
  const k1 = 1.2;
  const b = 0.75;
  const scored = chunks.map((chunk, index) => {
    const tokens = documents[index];
    const frequencies = new Map<string, number>();
    tokens.forEach(token => frequencies.set(token, (frequencies.get(token) ?? 0) + 1));
    let score = 0;
    for (const token of queryTokens) {
      const tf = frequencies.get(token) ?? 0;
      if (tf === 0) continue;
      const df = documentFrequency.get(token) ?? 0;
      const idf = Math.log(1 + (chunks.length - df + 0.5) / (df + 0.5));
      const identifierWeight = /[._/-]/.test(token) ? 2 : 1;
      score += identifierWeight * idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * tokens.length / averageLength)));
    }
    return { chunk, score };
  });
  return scored
    .filter(result => result.score > 0)
    .sort((a, b) => b.score - a.score || b.chunk.updatedAt - a.chunk.updatedAt || a.chunk.id.localeCompare(b.chunk.id))
    .slice(0, Math.max(0, limit));
}

function expandQueryTokens(tokens: string[]): string[] {
  const synonyms: Record<string, string[]> = {
    concise: ['short'],
    response: ['update'],
    recipe: ['recipes'],
  };
  return tokens.flatMap(token => [token, ...(synonyms[token] ?? [])]);
}

function searchableText(chunk: RagChunk): string {
  return [chunk.sourceTitle, chunk.text].filter(Boolean).join('\n');
}

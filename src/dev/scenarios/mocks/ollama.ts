// Ollama mocks: version probe, tag listing, NDJSON chat stream and the
// embedding endpoints the retrieval layer calls when auto-inject is on.
import type { MockRoute, OllamaPlan } from '../types';
import { jsonResponse, hostMatches, networkFailure, streamedResponse } from './http';

export const OLLAMA_HOST = '127.0.0.1:11434';

export function ollamaRoutes(plan: OllamaPlan | 'offline' | undefined): MockRoute[] {
  if (!plan) return [];
  if (plan === 'offline') {
    return [{ name: 'ollama.offline', matches: req => hostMatches(req, OLLAMA_HOST), respond: req => networkFailure(req.url) }];
  }
  const tags = {
    models: plan.models.map(name => ({
      name,
      model: name,
      modified_at: '2026-07-05T00:00:00Z',
      size: 4_000_000_000,
      digest: `sha256:${name}`,
      details: { family: name.split(':')[0], parameter_size: '7B', quantization_level: 'Q4_K_M' },
    })),
  };
  return [
    { name: 'ollama.version', matches: req => hostMatches(req, OLLAMA_HOST) && req.url.pathname === '/api/version', respond: () => jsonResponse({ version: plan.version ?? '0.12.0-mock' }) },
    { name: 'ollama.tags', matches: req => hostMatches(req, OLLAMA_HOST) && req.url.pathname === '/api/tags', respond: () => jsonResponse(tags) },
    { name: 'ollama.ps', matches: req => hostMatches(req, OLLAMA_HOST) && req.url.pathname === '/api/ps', respond: () => jsonResponse({ models: [] }) },
    { name: 'ollama.show', matches: req => hostMatches(req, OLLAMA_HOST) && req.url.pathname === '/api/show', respond: () => jsonResponse({ details: { family: 'qwen2' }, model_info: {} }) },
    { name: 'ollama.embed', matches: req => hostMatches(req, OLLAMA_HOST) && req.url.pathname === '/api/embed', respond: req => jsonResponse({ model: 'nomic-embed-text', embeddings: embeddingsFor(req.body) }) },
    { name: 'ollama.embeddings', matches: req => hostMatches(req, OLLAMA_HOST) && req.url.pathname === '/api/embeddings', respond: () => jsonResponse({ embedding: unitVector(0) }) },
    {
      name: 'ollama.chat',
      matches: req => hostMatches(req, OLLAMA_HOST) && req.url.pathname === '/api/chat',
      respond: () => streamedResponse([
        JSON.stringify({ model: plan.models[0], message: { role: 'assistant', content: plan.reply }, done: false }) + '\n',
        JSON.stringify({ model: plan.models[0], done: true, done_reason: 'stop', prompt_eval_count: 128, eval_count: 42 }) + '\n',
      ], { contentType: 'application/x-ndjson' }),
    },
    { name: 'ollama.other', matches: req => hostMatches(req, OLLAMA_HOST), respond: () => jsonResponse({}) },
  ];
}

function embeddingsFor(body: string | null): number[][] {
  let count = 1;
  try {
    const parsed = body ? JSON.parse(body) as { input?: unknown } : {};
    if (Array.isArray(parsed.input)) count = Math.max(1, parsed.input.length);
  } catch {
    count = 1;
  }
  return Array.from({ length: count }, (_, i) => unitVector(i));
}

function unitVector(seed: number): number[] {
  const dims = 8;
  const vector = Array.from({ length: dims }, (_, i) => Math.sin(seed + i + 1));
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vector.map(v => Number((v / norm).toFixed(6)));
}

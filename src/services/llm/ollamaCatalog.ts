// Implements LLM provider plumbing for ollamaCatalog.
// Called by RouterStore/ChatStore through the LlmProvider interface; depends on core LLM messages, SSE/JSON parsing, and provider configs.
// Invariant: providers stream normalized LlmChunk events and do not mutate chat state.
import type { Model } from '../../core/types';
import { modelSupportsVision } from '../../core/modelCapabilities';
import {
  isOllamaEmbeddingModelTag,
  ollamaModelSupportsTools,
} from '../../core/localModelRules';

/**
 * Subset of the `/api/tags` entry shape that the mapper reads. Ollama
 * returns more fields (model, size, modified_at, digest, details) — we
 * pull them in lazily if/when we need them.
 */
interface OllamaTag {
  name: string;
}

interface OllamaTagsResponse {
  models: OllamaTag[];
}

/**
 * Tag families known to handle tool calls poorly in Ollama (gemma*, phi*,
 * codellama). Matches the family name with optional version digits and
 * either a `:tag` suffix or end-of-string. Conservative — false positives
 * just mean a working tool model is briefly mis-flagged, which the user
 * can override globally via the Local menu's "tool calls" toggle.
 */
function isOllamaTagsResponse(v: unknown): v is OllamaTagsResponse {
  if (!v || typeof v !== 'object') return false;
  const arr = (v as { models?: unknown }).models;
  return Array.isArray(arr);
}

export function extractOllamaTagNames(raw: unknown): string[] {
  if (!isOllamaTagsResponse(raw)) return [];
  return raw.models
    .map(tag => tag?.name)
    .filter((name): name is string => typeof name === 'string' && name.length > 0);
}

/**
 * Convert the body of `GET /api/tags` from a running Ollama server into
 * our `Model[]` shape. Stable ids prefixed with `ollama-` so the registry
 * can dedupe. Vision and tool-call support are inferred from the tag name;
 * users can override globally via the Local menu tools toggle.
 */
export function mapOllamaTagsToModels(raw: unknown): Model[] {
  if (!isOllamaTagsResponse(raw)) return [];
  const out: Model[] = [];
  for (const tag of raw.models) {
    if (!tag || typeof tag.name !== 'string' || !tag.name) continue;
    const providerModelId = tag.name;
    if (isOllamaEmbeddingModelTag(providerModelId)) continue;
    out.push({
      id: `ollama-${providerModelId}`,
      providerId: 'ollama',
      providerModelId,
      // Ollama's /api/tags exposes only the tag id, no friendly name.
      name: providerModelId,
      vendor: 'Ollama',
      dynamic: true,
      supportsVision: modelSupportsVision({ providerId: 'ollama', providerModelId }),
      supportsTools: ollamaModelSupportsTools(providerModelId),
    });
  }
  return out;
}

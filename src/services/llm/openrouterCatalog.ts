import type { Model } from '../../core/types';

/**
 * Subset of OpenRouter's `/api/v1/models` payload that we care about. The API
 * returns more fields (top_provider, per_request_limits, …) but we keep the
 * mapping deliberately narrow — easier to evolve, less surface to break on.
 *
 * Docs: https://openrouter.ai/docs/api-reference/list-available-models
 */
interface RawOpenRouterModel {
  id: string;
  name?: string;
  description?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
  };
}

const ENDPOINT = 'https://openrouter.ai/api/v1/models';

/**
 * Fetch + map the OpenRouter catalog. Filters down to chat-completion-capable
 * models so the picker stays usable (drops audio/image/embedding-only entries).
 *
 * Each entry is namespaced as `or-live-<slug>` so it never collides with the
 * curated `or-*` ids hand-coded in `core/models.ts`. The registry then
 * dedupes when both sides describe the same `providerModelId`.
 */
export async function fetchOpenRouterModels(signal?: AbortSignal): Promise<Model[]> {
  const res = await fetch(ENDPOINT, { signal });
  if (!res.ok) {
    throw new Error(`OpenRouter catalog HTTP ${res.status} — ${res.statusText}`);
  }
  const body: { data?: RawOpenRouterModel[] } = await res.json();
  const data = Array.isArray(body.data) ? body.data : [];
  return data.filter(isChatModel).map(toModel);
}

function isChatModel(m: RawOpenRouterModel): boolean {
  const out = m.architecture?.output_modalities;
  if (!out || out.length === 0) return true; // assume text if unspecified
  return out.includes('text');
}

function toModel(raw: RawOpenRouterModel): Model {
  const slug = raw.id;
  const safeSlug = slug.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const vendor = inferVendor(slug);
  return {
    id: `or-live-${safeSlug}`,
    name: raw.name ?? slug,
    vendor,
    providerId: 'openrouter',
    providerModelId: slug,
    description: raw.description?.trim() || undefined,
    contextLength: raw.context_length,
    pricing: parsePricing(raw.pricing),
    dynamic: true,
  };
}

function inferVendor(slug: string): string {
  const prefix = slug.split('/')[0]?.toLowerCase() ?? '';
  switch (prefix) {
    case 'anthropic': return 'Anthropic';
    case 'openai': return 'OpenAI';
    case 'google': return 'Google';
    case 'meta-llama': return 'Meta';
    case 'mistralai': return 'Mistral';
    case 'deepseek': return 'DeepSeek';
    case 'qwen': return 'Qwen';
    case 'x-ai': return 'xAI';
    case 'cohere': return 'Cohere';
    case 'perplexity': return 'Perplexity';
    case 'nvidia': return 'NVIDIA';
    case 'amazon': return 'Amazon';
    case 'microsoft': return 'Microsoft';
    case 'moonshotai': return 'Moonshot';
    case 'z-ai': return 'Z.AI';
    case 'inflection': return 'Inflection';
    default:
      if (!prefix) return 'OpenRouter';
      return prefix.charAt(0).toUpperCase() + prefix.slice(1);
  }
}

/**
 * OpenRouter prices come as strings in USD-per-token. Convert to USD per
 * 1M tokens to match how every model card on the planet displays them.
 * Returns `undefined` if both sides are unparseable so we don't render "$0.00".
 */
function parsePricing(p: RawOpenRouterModel['pricing']): Model['pricing'] {
  if (!p) return undefined;
  const prompt = toMillion(p.prompt);
  const completion = toMillion(p.completion);
  if (prompt == null && completion == null) return undefined;
  const out: NonNullable<Model['pricing']> = {};
  if (prompt != null) out.prompt = prompt;
  if (completion != null) out.completion = completion;
  return out;
}

function toMillion(raw: string | undefined): number | undefined {
  if (raw == null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n * 1_000_000;
}

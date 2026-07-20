export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

export interface OpenRouterCatalogModel {
  id: string;
  canonical_slug?: string;
  name: string;
  created: number;
  expiration_date?: string | null;
  supported_parameters?: string[];
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
  pricing?: {
    prompt?: string;
    completion?: string;
    request?: string;
  };
  reasoning?: {
    mandatory?: boolean;
    supported_efforts?: string[];
  };
}

interface CatalogResponse {
  data?: unknown;
}

export async function fetchOpenRouterCatalog(
  fetchImpl: typeof fetch = fetch,
  attempts = 3,
): Promise<OpenRouterCatalogModel[]> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(OPENROUTER_MODELS_URL, {
        headers: { 'User-Agent': 'GatesAI-Chat/model-compat' },
      });
      if (!response.ok) throw new Error(`OpenRouter catalog HTTP ${response.status}`);
      const body = await response.json() as CatalogResponse;
      if (!Array.isArray(body.data)) throw new Error('OpenRouter catalog response did not contain a data array.');
      return body.data.map(parseCatalogModel);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, attempt * 1_000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function parseCatalogModel(value: unknown): OpenRouterCatalogModel {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    throw new Error('OpenRouter catalog contained an invalid model record.');
  }
  return {
    id: value.id,
    canonical_slug: typeof value.canonical_slug === 'string' ? value.canonical_slug : undefined,
    name: value.name,
    created: typeof value.created === 'number' ? value.created : 0,
    expiration_date: typeof value.expiration_date === 'string' || value.expiration_date === null
      ? value.expiration_date
      : undefined,
    supported_parameters: stringArray(value.supported_parameters),
    architecture: isRecord(value.architecture) ? {
      input_modalities: stringArray(value.architecture.input_modalities),
      output_modalities: stringArray(value.architecture.output_modalities),
    } : undefined,
    pricing: isRecord(value.pricing) ? {
      prompt: stringValue(value.pricing.prompt),
      completion: stringValue(value.pricing.completion),
      request: stringValue(value.pricing.request),
    } : undefined,
    reasoning: isRecord(value.reasoning) ? {
      mandatory: typeof value.reasoning.mandatory === 'boolean' ? value.reasoning.mandatory : undefined,
      supported_efforts: stringArray(value.reasoning.supported_efforts),
    } : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

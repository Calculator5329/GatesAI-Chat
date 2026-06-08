// Defines shared models domain contracts and pure helpers for chat, models, tokens, or workspace paths.
// Called by stores, services, components, and tests; depends on stable TypeScript data shapes.
// Invariant: core modules stay side-effect free except for explicit cache helpers.
import type { Model } from './types';

/**
 * The model catalog.
 *
 *   `id`               — stable identifier persisted on threads. Never rename.
 *   `providerModelId`  — what the provider's API actually expects. Update freely
 *                        as providers ship new versions; thread `id` won't change.
 *
 * The foundation build exposes OpenRouter for cloud chat, Ollama via the
 * dynamic local catalog, and synthetic ComfyUI direct-image models.
 */
export const MODELS: Model[] = [
  // ─────────────────────────────────────────────────────────────────
  // OpenRouter — default catalog across leading labs
  // (Full catalog can be fetched live via /api/v1/models if needed)
  // ─────────────────────────────────────────────────────────────────
  // OpenAI
  { id: 'or-gpt-5.5',             name: 'GPT-5.5',           vendor: 'OpenAI', providerId: 'openrouter', providerModelId: 'openai/gpt-5.5', description: 'OpenAI flagship for complex professional work.', contextLength: 1_000_000, pricing: { prompt: 5, completion: 30 } },
  { id: 'or-gpt-5.5-pro',         name: 'GPT-5.5 Pro',       vendor: 'OpenAI', providerId: 'openrouter', providerModelId: 'openai/gpt-5.5-pro', description: 'OpenAI deep-reasoning model for high-stakes work.', contextLength: 1_000_000, pricing: { prompt: 30, completion: 180 } },
  { id: 'or-gpt-mini-latest',     name: 'GPT Mini latest',   vendor: 'OpenAI', providerId: 'openrouter', providerModelId: '~openai/gpt-mini-latest', description: 'OpenRouter latest alias for the OpenAI GPT Mini family.' },
  { id: 'or-gpt-5.4',             name: 'GPT-5.4',           vendor: 'OpenAI', providerId: 'openrouter', providerModelId: 'openai/gpt-5.4', description: 'Prior OpenAI flagship for fallback comparisons.', contextLength: 400_000 },
  { id: 'or-gpt-5.4-mini',        name: 'GPT-5.4 mini',      vendor: 'OpenAI', providerId: 'openrouter', providerModelId: 'openai/gpt-5.4-mini', description: 'Fast compact OpenAI model for high-volume work.', contextLength: 400_000, pricing: { prompt: 0.75, completion: 4.5 } },
  { id: 'or-gpt-5.4-nano',        name: 'GPT-5.4 nano',      vendor: 'OpenAI', providerId: 'openrouter', providerModelId: 'openai/gpt-5.4-nano', description: 'Lowest-cost OpenAI model for simple extraction and ranking.', contextLength: 400_000, pricing: { prompt: 0.2, completion: 1.25 } },
  { id: 'or-gpt-5-mini',          name: 'GPT-5 mini',        vendor: 'OpenAI', providerId: 'openrouter', providerModelId: 'openai/gpt-5-mini', description: 'Legacy compact GPT-5 model.', contextLength: 400_000, pricing: { prompt: 0.25, completion: 2 } },

  // Anthropic
  { id: 'or-claude-opus-latest',   name: 'Claude Opus latest',   vendor: 'Anthropic', providerId: 'openrouter', providerModelId: '~anthropic/claude-opus-latest', description: 'OpenRouter latest alias for the Claude Opus family.' },
  { id: 'or-claude-sonnet-latest', name: 'Claude Sonnet latest', vendor: 'Anthropic', providerId: 'openrouter', providerModelId: '~anthropic/claude-sonnet-latest', description: 'OpenRouter latest alias for the Claude Sonnet family.' },
  { id: 'or-claude-haiku-latest',  name: 'Claude Haiku latest',  vendor: 'Anthropic', providerId: 'openrouter', providerModelId: '~anthropic/claude-haiku-latest', description: 'OpenRouter latest alias for the Claude Haiku family.' },
  { id: 'or-claude-opus-4.8',      name: 'Claude Opus 4.8',      vendor: 'Anthropic', providerId: 'openrouter', providerModelId: 'anthropic/claude-opus-4.8', description: 'Anthropic frontier Opus model.', contextLength: 1_000_000, pricing: { prompt: 5, completion: 25 } },
  { id: 'or-claude-opus-4.8-fast', name: 'Claude Opus 4.8 Fast', vendor: 'Anthropic', providerId: 'openrouter', providerModelId: 'anthropic/claude-opus-4.8-fast', description: 'Higher-throughput Opus 4.8 route.', contextLength: 1_000_000, pricing: { prompt: 10, completion: 50 } },
  { id: 'or-claude-opus-4.7',      name: 'Claude Opus 4.7',      vendor: 'Anthropic', providerId: 'openrouter', providerModelId: 'anthropic/claude-opus-4.7', description: 'Prior Claude Opus flagship.', contextLength: 200_000, pricing: { prompt: 5, completion: 25 } },
  { id: 'or-claude-sonnet-4.6',    name: 'Claude Sonnet 4.6',    vendor: 'Anthropic', providerId: 'openrouter', providerModelId: 'anthropic/claude-sonnet-4.6', description: 'Anthropic daily-driver coding and agent model.', contextLength: 200_000, pricing: { prompt: 3, completion: 15 } },
  { id: 'or-claude-haiku-4.5',     name: 'Claude Haiku 4.5',     vendor: 'Anthropic', providerId: 'openrouter', providerModelId: 'anthropic/claude-haiku-4.5', description: 'Fast Claude model for lightweight agent work.', contextLength: 200_000, pricing: { prompt: 1, completion: 5 } },

  // Google
  { id: 'or-gemini-pro-latest',       name: 'Gemini Pro latest',      vendor: 'Google', providerId: 'openrouter', providerModelId: '~google/gemini-pro-latest', description: 'OpenRouter latest alias for Gemini Pro.' },
  { id: 'or-gemini-flash-latest',     name: 'Gemini Flash latest',    vendor: 'Google', providerId: 'openrouter', providerModelId: '~google/gemini-flash-latest', description: 'OpenRouter latest alias for Gemini Flash.' },
  { id: 'or-gemini-3.5-flash',        name: 'Gemini 3.5 Flash',       vendor: 'Google', providerId: 'openrouter', providerModelId: 'google/gemini-3.5-flash', description: 'Newest Gemini Flash family model.', contextLength: 1_000_000, pricing: { prompt: 1.5, completion: 9 } },
  { id: 'or-gemini-3-flash',          name: 'Gemini Flash latest',    vendor: 'Google', providerId: 'openrouter', providerModelId: '~google/gemini-flash-latest', description: 'Default API chat, vision, reliable tools.' },
  { id: 'or-gemini-3.1-flash-lite',   name: 'Gemini 3.1 Flash Lite',  vendor: 'Google', providerId: 'openrouter', providerModelId: 'google/gemini-3.1-flash-lite', description: 'Cost-efficient Gemini model with controllable thinking.', contextLength: 1_048_576, pricing: { prompt: 0.25, completion: 1.5 } },

  // xAI
  { id: 'or-grok-4.3',        name: 'Grok 4.3',        vendor: 'xAI', providerId: 'openrouter', providerModelId: 'x-ai/grok-4.3', description: 'xAI flagship reasoning model.', contextLength: 1_000_000, pricing: { prompt: 1.25, completion: 2.5 } },
  { id: 'or-grok-4.20',       name: 'Grok 4.20',       vendor: 'xAI', providerId: 'openrouter', providerModelId: 'x-ai/grok-4.20', description: 'xAI large-context reasoning and agentic tool-calling model.', contextLength: 2_000_000, pricing: { prompt: 1.25, completion: 2.5 } },

  // Meta / open weights
  { id: 'or-llama-4-maverick', name: 'Llama 4 Maverick', vendor: 'Meta', providerId: 'openrouter', providerModelId: 'meta-llama/llama-4-maverick', description: 'Meta multimodal MoE generalist.', contextLength: 1_000_000 },
  { id: 'or-llama-4-scout',    name: 'Llama 4 Scout',    vendor: 'Meta', providerId: 'openrouter', providerModelId: 'meta-llama/llama-4-scout', description: 'Meta long-context multimodal MoE model.', contextLength: 10_000_000 },
  { id: 'or-nemotron-3-ultra',      name: 'Nemotron 3 Ultra',      vendor: 'NVIDIA', providerId: 'openrouter', providerModelId: 'nvidia/nemotron-3-ultra-550b-a55b', description: 'NVIDIA open-weight frontier reasoning and orchestration MoE.', contextLength: 1_000_000, pricing: { prompt: 0.5, completion: 2.5 } },
  { id: 'or-nemotron-3-ultra-free', name: 'Nemotron 3 Ultra free', vendor: 'NVIDIA', providerId: 'openrouter', providerModelId: 'nvidia/nemotron-3-ultra-550b-a55b:free', description: 'Free OpenRouter route for Nemotron 3 Ultra open weights.', contextLength: 1_000_000, pricing: { prompt: 0, completion: 0 } },
  { id: 'or-nemotron-3-super',      name: 'Nemotron 3 Super',      vendor: 'NVIDIA', providerId: 'openrouter', providerModelId: 'nvidia/nemotron-3-super-120b-a12b', description: 'NVIDIA open-weight 120B/12B-active hybrid MoE for agentic systems.', contextLength: 1_000_000, pricing: { prompt: 0.09, completion: 0.45 } },
  { id: 'or-nemotron-3-super-free', name: 'Nemotron 3 Super free', vendor: 'NVIDIA', providerId: 'openrouter', providerModelId: 'nvidia/nemotron-3-super-120b-a12b:free', description: 'Free OpenRouter route for Nemotron 3 Super open weights.', contextLength: 1_000_000, pricing: { prompt: 0, completion: 0 } },
  { id: 'or-nemotron-3-nano-free',  name: 'Nemotron 3 Nano 30B free', vendor: 'NVIDIA', providerId: 'openrouter', providerModelId: 'nvidia/nemotron-3-nano-30b-a3b:free', description: 'NVIDIA open-weight 30B/3B-active MoE suitable for local-adjacent workflows.', contextLength: 256_000, pricing: { prompt: 0, completion: 0 } },
  { id: 'or-nemotron-3.5-content-safety', name: 'Nemotron 3.5 Content Safety', vendor: 'NVIDIA', providerId: 'openrouter', providerModelId: 'nvidia/nemotron-3.5-content-safety', description: 'NVIDIA guardrail model for prompt and response moderation.', contextLength: 128_000, supportsTools: false },
  { id: 'or-deepseek-v4-pro',  name: 'DeepSeek V4 Pro',  vendor: 'DeepSeek', providerId: 'openrouter', providerModelId: 'deepseek/deepseek-v4-pro', description: 'DeepSeek open-weight pro reasoning model.', contextLength: 1_000_000, pricing: { prompt: 0.435, completion: 0.87 } },
  { id: 'or-deepseek-v4-flash', name: 'DeepSeek V4 Flash', vendor: 'DeepSeek', providerId: 'openrouter', providerModelId: 'deepseek/deepseek-v4-flash', description: 'Low-cost DeepSeek bulk inference model.', pricing: { prompt: 0.098 } },
  { id: 'or-kimi-k2.6',        name: 'Kimi K2.6',        vendor: 'Moonshot', providerId: 'openrouter', providerModelId: 'moonshotai/kimi-k2.6', description: 'Moonshot Kimi agentic MoE model.', contextLength: 256_000, pricing: { prompt: 0.74, completion: 3.5 } },
  { id: 'or-kimi-k2.5',        name: 'Kimi K2.5',        vendor: 'Moonshot', providerId: 'openrouter', providerModelId: 'moonshotai/kimi-k2.5', description: 'Prior Kimi K2 agentic model.', contextLength: 256_000, pricing: { prompt: 0.44, completion: 2 } },

  // ─────────────────────────────────────────────────────────────────
  // Direct image — synthetic "models" that bypass any LLM and send the
  // user's prompt straight to ComfyUI. Useful offline (no wifi): pick
  // one from the model menu and your message becomes the image prompt;
  // no chat round-trip happens.
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'image-direct-comfy-draft',
    name: 'Draft image — SDXL',
    vendor: 'Local image',
    providerId: 'local-image',
    providerModelId: 'comfy-direct-draft',
    description: 'Fast SDXL Lightning draft render. Native size, no upscale, no LLM call.',
    supportsTools: false,
  },
  {
    id: 'image-direct-comfy',
    name: 'Normal image — Flux 2 Klein',
    vendor: 'Local image',
    providerId: 'local-image',
    providerModelId: 'comfy-direct',
    description: 'Default FLUX.2 Klein render. Native size, no upscale, no LLM call.',
    supportsTools: false,
  },
  {
    id: 'image-direct-comfy-upscale',
    name: 'Upscale image — Flux 2 Klein 2x',
    vendor: 'Local image',
    providerId: 'local-image',
    providerModelId: 'comfy-direct-upscale',
    description: 'FLUX.2 Klein render with a 2x hires-fix refinement pass. No LLM call.',
    supportsTools: false,
  },
];

export const DEFAULT_MODEL_ID = 'or-gemini-3-flash';

export const DEFAULT_OPENROUTER_CATALOG_MODEL_IDS = [
  'or-gpt-5.5',
  'or-gpt-5.5-pro',
  'or-gpt-mini-latest',
  'or-gpt-5.4-mini',
  'or-gpt-5.4-nano',
  'or-claude-opus-latest',
  'or-claude-sonnet-latest',
  'or-claude-haiku-latest',
  'or-claude-opus-4.8',
  'or-claude-sonnet-4.6',
  'or-gemini-pro-latest',
  'or-gemini-flash-latest',
  'or-gemini-3.5-flash',
  'or-gemini-3-flash',
  'or-gemini-3.1-flash-lite',
  'or-grok-4.3',
  'or-grok-4.20',
  'or-llama-4-maverick',
  'or-llama-4-scout',
  'or-nemotron-3-ultra',
  'or-nemotron-3-ultra-free',
  'or-nemotron-3-super',
  'or-nemotron-3-super-free',
  'or-nemotron-3-nano-free',
  'or-deepseek-v4-pro',
  'or-deepseek-v4-flash',
  'or-kimi-k2.6',
  'or-kimi-k2.5',
] as const;

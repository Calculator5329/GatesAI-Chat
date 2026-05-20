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
  // OpenRouter — curated picks across vendors
  // (Full catalog can be fetched live via /api/v1/models if needed)
  // ─────────────────────────────────────────────────────────────────
  // Frontier (re-exposed via OR for users with only an OR key)
  { id: 'or-claude-opus-4.7',     name: 'Claude Opus 4.7',   vendor: 'Anthropic', providerId: 'openrouter', providerModelId: 'anthropic/claude-opus-4.7' },
  { id: 'or-claude-sonnet-4.6',   name: 'Claude Sonnet 4.6', vendor: 'Anthropic', providerId: 'openrouter', providerModelId: 'anthropic/claude-sonnet-4.6' },
  { id: 'or-gpt-5.5-pro',         name: 'GPT-5.5 Pro',       vendor: 'OpenAI', providerId: 'openrouter', providerModelId: 'openai/gpt-5.5-pro' },
  { id: 'or-gpt-5.5',             name: 'GPT-5.5',           vendor: 'OpenAI', providerId: 'openrouter', providerModelId: 'openai/gpt-5.5' },
  { id: 'or-gpt-5.4',             name: 'GPT-5.4',           vendor: 'OpenAI', providerId: 'openrouter', providerModelId: 'openai/gpt-5.4' },
  { id: 'or-gpt-5.4-mini',        name: 'GPT-5.4 mini',      vendor: 'OpenAI', providerId: 'openrouter', providerModelId: 'openai/gpt-5.4-mini' },
  { id: 'or-gemini-3.1-pro',      name: 'Gemini 3.1 Pro',    vendor: 'Google', providerId: 'openrouter', providerModelId: 'google/gemini-3.1-pro-preview' },
  { id: 'or-gemini-3-flash',      name: 'Gemini 3 Flash',    vendor: 'Google', providerId: 'openrouter', providerModelId: 'google/gemini-3-flash-preview' },
  { id: 'or-gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', vendor: 'Google', providerId: 'openrouter', providerModelId: 'google/gemini-3.1-flash-lite-preview' },

  // xAI
  { id: 'or-grok-4.20',                 name: 'Grok 4.20',                vendor: 'xAI', providerId: 'openrouter', providerModelId: 'x-ai/grok-4.20' },
  { id: 'or-grok-4.20-multi-agent',     name: 'Grok 4.20 Multi-Agent',    vendor: 'xAI', providerId: 'openrouter', providerModelId: 'x-ai/grok-4.20-multi-agent' },

  // Open weights
  { id: 'or-deepseek-v4-pro',     name: 'DeepSeek V4 Pro',   vendor: 'DeepSeek', providerId: 'openrouter', providerModelId: 'deepseek/deepseek-v4-pro' },
  { id: 'or-deepseek-v4-flash',   name: 'DeepSeek V4 Flash', vendor: 'DeepSeek', providerId: 'openrouter', providerModelId: 'deepseek/deepseek-v4-flash' },
  { id: 'or-kimi-k2.6',           name: 'Kimi K2.6',         vendor: 'Moonshot', providerId: 'openrouter', providerModelId: 'moonshotai/kimi-k2.6' },
  { id: 'or-mistral-small',       name: 'Mistral Small',     vendor: 'Mistral', providerId: 'openrouter', providerModelId: 'mistralai/mistral-small-2603' },

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

import type { Model } from './types';

/**
 * The model catalog.
 *
 *   `id`               — stable identifier persisted on threads. Never rename.
 *   `providerModelId`  — what the provider's API actually expects. Update freely
 *                        as providers ship new versions; thread `id` won't change.
 *
 * Slugs verified against live provider docs / OpenRouter model pages
 * on 2026-04-25. See `docs/changelog.md` for the audit notes.
 */
export const MODELS: Model[] = [
  // ─────────────────────────────────────────────────────────────────
  // Anthropic — direct (https://docs.anthropic.com/.../all-models)
  // ─────────────────────────────────────────────────────────────────
  { id: 'claude-opus-4.7',   name: 'Claude Opus 4.7',   vendor: 'Anthropic', providerId: 'anthropic', providerModelId: 'claude-opus-4-7' },
  { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', vendor: 'Anthropic', providerId: 'anthropic', providerModelId: 'claude-sonnet-4-6' },
  { id: 'claude-opus-4.6',   name: 'Claude Opus 4.6',   vendor: 'Anthropic', providerId: 'anthropic', providerModelId: 'claude-opus-4-6' },
  { id: 'claude-haiku-4.5',  name: 'Claude Haiku 4.5',  vendor: 'Anthropic', providerId: 'anthropic', providerModelId: 'claude-haiku-4-5' },
  { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', vendor: 'Anthropic', providerId: 'anthropic', providerModelId: 'claude-sonnet-4-5' },

  // ─────────────────────────────────────────────────────────────────
  // OpenAI — direct (https://developers.openai.com/api/docs/models)
  // ─────────────────────────────────────────────────────────────────
  { id: 'gpt-5.5',           name: 'GPT-5.5',           vendor: 'OpenAI', providerId: 'openai', providerModelId: 'gpt-5.5' },
  { id: 'gpt-5.5-pro',       name: 'GPT-5.5 Pro',       vendor: 'OpenAI', providerId: 'openai', providerModelId: 'gpt-5.5-pro' },
  { id: 'gpt-5.4',           name: 'GPT-5.4',           vendor: 'OpenAI', providerId: 'openai', providerModelId: 'gpt-5.4' },
  { id: 'gpt-5.4-pro',       name: 'GPT-5.4 Pro',       vendor: 'OpenAI', providerId: 'openai', providerModelId: 'gpt-5.4-pro' },
  { id: 'gpt-5.4-mini',      name: 'GPT-5.4 mini',      vendor: 'OpenAI', providerId: 'openai', providerModelId: 'gpt-5.4-mini' },
  { id: 'gpt-5.4-nano',      name: 'GPT-5.4 nano',      vendor: 'OpenAI', providerId: 'openai', providerModelId: 'gpt-5.4-nano' },
  { id: 'gpt-5',             name: 'GPT-5',             vendor: 'OpenAI', providerId: 'openai', providerModelId: 'gpt-5' },

  // ─────────────────────────────────────────────────────────────────
  // Google — direct (Gemini API). Gemini 3 series is the current
  // frontier; Gemini 3 Pro Preview was shut down 2026-03-09 and now
  // resolves to 3.1 Pro Preview. 2.5 Flash Lite is still production.
  // ─────────────────────────────────────────────────────────────────
  { id: 'gemini-3.1-pro',         name: 'Gemini 3.1 Pro',         vendor: 'Google', providerId: 'gemini', providerModelId: 'gemini-3.1-pro-preview' },
  { id: 'gemini-3-flash',         name: 'Gemini 3 Flash',         vendor: 'Google', providerId: 'gemini', providerModelId: 'gemini-3-flash-preview' },
  { id: 'gemini-3.1-flash-image', name: 'Gemini 3.1 Flash Image', vendor: 'Google', providerId: 'gemini', providerModelId: 'gemini-3.1-flash-image-preview' },
  { id: 'gemini-2.5-flash-lite',  name: 'Gemini 2.5 Flash Lite',  vendor: 'Google', providerId: 'gemini', providerModelId: 'gemini-2.5-flash-lite' },

  // ─────────────────────────────────────────────────────────────────
  // Groq — production models only (https://console.groq.com/docs/models)
  // mixtral-8x7b-32768 was deprecated 2025-03-20.
  // ─────────────────────────────────────────────────────────────────
  { id: 'groq-llama-3.3-70b',     name: 'Llama 3.3 70B (Groq)',     vendor: 'Groq', providerId: 'groq', providerModelId: 'llama-3.3-70b-versatile' },
  { id: 'groq-llama-3.1-8b',      name: 'Llama 3.1 8B Instant (Groq)', vendor: 'Groq', providerId: 'groq', providerModelId: 'llama-3.1-8b-instant' },
  { id: 'groq-gpt-oss-120b',      name: 'GPT-OSS 120B (Groq)',      vendor: 'Groq', providerId: 'groq', providerModelId: 'openai/gpt-oss-120b' },
  { id: 'groq-gpt-oss-20b',       name: 'GPT-OSS 20B (Groq)',       vendor: 'Groq', providerId: 'groq', providerModelId: 'openai/gpt-oss-20b' },

  // ─────────────────────────────────────────────────────────────────
  // OpenRouter — curated picks across vendors
  // (Full catalog: 348 models — fetch live via /api/v1/models if needed)
  // ─────────────────────────────────────────────────────────────────
  // Frontier (re-exposed via OR for users with only an OR key)
  { id: 'or-claude-opus-4.7',     name: 'Claude Opus 4.7 (OpenRouter)',   vendor: 'OpenRouter', providerId: 'openrouter', providerModelId: 'anthropic/claude-opus-4.7' },
  { id: 'or-claude-sonnet-4.6',   name: 'Claude Sonnet 4.6 (OpenRouter)', vendor: 'OpenRouter', providerId: 'openrouter', providerModelId: 'anthropic/claude-sonnet-4.6' },
  { id: 'or-gpt-5.5-pro',         name: 'GPT-5.5 Pro (OpenRouter)',       vendor: 'OpenRouter', providerId: 'openrouter', providerModelId: 'openai/gpt-5.5-pro' },
  { id: 'or-gpt-5.5',             name: 'GPT-5.5 (OpenRouter)',           vendor: 'OpenRouter', providerId: 'openrouter', providerModelId: 'openai/gpt-5.5' },
  { id: 'or-gpt-5.4',             name: 'GPT-5.4 (OpenRouter)',           vendor: 'OpenRouter', providerId: 'openrouter', providerModelId: 'openai/gpt-5.4' },
  { id: 'or-gpt-5.4-mini',        name: 'GPT-5.4 mini (OpenRouter)',      vendor: 'OpenRouter', providerId: 'openrouter', providerModelId: 'openai/gpt-5.4-mini' },
  { id: 'or-gemini-3-pro',        name: 'Gemini 3 Pro (OpenRouter)',      vendor: 'OpenRouter', providerId: 'openrouter', providerModelId: 'google/gemini-3-pro-preview' },

  // xAI
  { id: 'or-grok-4.20',           name: 'Grok 4.20 (OpenRouter)',         vendor: 'OpenRouter', providerId: 'openrouter', providerModelId: 'x-ai/grok-4.20' },
  { id: 'or-grok-4-fast',         name: 'Grok 4 Fast (OpenRouter)',       vendor: 'OpenRouter', providerId: 'openrouter', providerModelId: 'x-ai/grok-4-fast' },
  { id: 'or-grok-code-fast-1',    name: 'Grok Code Fast 1 (OpenRouter)',  vendor: 'OpenRouter', providerId: 'openrouter', providerModelId: 'x-ai/grok-code-fast-1' },

  // Open weights
  { id: 'or-llama-4-maverick',    name: 'Llama 4 Maverick (OpenRouter)',  vendor: 'OpenRouter', providerId: 'openrouter', providerModelId: 'meta-llama/llama-4-maverick' },
  { id: 'or-llama-4-scout',       name: 'Llama 4 Scout (OpenRouter)',     vendor: 'OpenRouter', providerId: 'openrouter', providerModelId: 'meta-llama/llama-4-scout' },
  { id: 'or-deepseek-v3.2',       name: 'DeepSeek V3.2 (OpenRouter)',     vendor: 'OpenRouter', providerId: 'openrouter', providerModelId: 'deepseek/deepseek-v3.2' },
  { id: 'or-deepseek-r1',         name: 'DeepSeek R1 (OpenRouter)',       vendor: 'OpenRouter', providerId: 'openrouter', providerModelId: 'deepseek/deepseek-r1' },
  { id: 'or-qwen3-max',           name: 'Qwen3 Max (OpenRouter)',         vendor: 'OpenRouter', providerId: 'openrouter', providerModelId: 'qwen/qwen3-max' },
  { id: 'or-qwen3-vl-235b',       name: 'Qwen3 VL 235B (OpenRouter)',     vendor: 'OpenRouter', providerId: 'openrouter', providerModelId: 'qwen/qwen3-vl-235b-a22b-instruct' },
  { id: 'or-kimi-k2.6',           name: 'Kimi K2.6 (OpenRouter)',         vendor: 'OpenRouter', providerId: 'openrouter', providerModelId: 'moonshotai/kimi-k2.6' },
  { id: 'or-mistral-large-3',     name: 'Mistral Large 3 (OpenRouter)',   vendor: 'OpenRouter', providerId: 'openrouter', providerModelId: 'mistralai/mistral-large-2512' },
  { id: 'or-mistral-medium-3.1',  name: 'Mistral Medium 3.1 (OpenRouter)',vendor: 'OpenRouter', providerId: 'openrouter', providerModelId: 'mistralai/mistral-medium-3.1' },

  // Search
  { id: 'or-perplexity-sonar-pro',    name: 'Perplexity Sonar Pro (OpenRouter)',     vendor: 'OpenRouter', providerId: 'openrouter', providerModelId: 'perplexity/sonar-pro' },
  { id: 'or-perplexity-sonar-reason', name: 'Perplexity Sonar Reasoning Pro (OpenRouter)', vendor: 'OpenRouter', providerId: 'openrouter', providerModelId: 'perplexity/sonar-reasoning-pro' },

  // ─────────────────────────────────────────────────────────────────
  // Local (OpenAI-compatible) — model id depends on what's running
  // ─────────────────────────────────────────────────────────────────
  { id: 'local-default',          name: 'Local model',                    vendor: 'Local', providerId: 'local', providerModelId: 'local-model' },
];

export const DEFAULT_MODEL_ID = 'claude-sonnet-4.6';

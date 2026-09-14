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
  // OpenRouter: default catalog across leading labs (refreshed from the live
  // /api/v1/models feed on 2026-09-13; pricing is USD per 1M tokens)
  // (Full catalog can be fetched live via /api/v1/models if needed)
  // ─────────────────────────────────────────────────────────────────
  // OpenAI
  { id: 'or-gpt-6-astra', name: 'GPT-6 Astra', vendor: 'OpenAI', providerId: 'openrouter', providerModelId: 'openai/gpt-6-astra', description: 'OpenAI frontier flagship for the hardest reasoning and agent work.', contextLength: 1_050_000, pricing: { prompt: 10, completion: 50 } },
  { id: 'or-gpt-6-astra-pro', name: 'GPT-6 Astra Pro', vendor: 'OpenAI', providerId: 'openrouter', providerModelId: 'openai/gpt-6-astra-pro', description: 'Deeper-thinking Astra route for high-stakes work.', contextLength: 1_050_000, pricing: { prompt: 10, completion: 50 } },
  { id: 'or-gpt-5.6-sol', name: 'GPT-5.6 Sol', vendor: 'OpenAI', providerId: 'openrouter', providerModelId: 'openai/gpt-5.6-sol', description: 'OpenAI workhorse for coding and agents.', contextLength: 1_050_000, pricing: { prompt: 2, completion: 10 } },
  { id: 'or-gpt-5.6-sol-pro', name: 'GPT-5.6 Sol Pro', vendor: 'OpenAI', providerId: 'openrouter', providerModelId: 'openai/gpt-5.6-sol-pro', description: 'Longer-thinking Sol route.', contextLength: 1_050_000, pricing: { prompt: 2, completion: 10 } },
  { id: 'or-gpt-5.6-terra', name: 'GPT-5.6 Terra', vendor: 'OpenAI', providerId: 'openrouter', providerModelId: 'openai/gpt-5.6-terra', description: 'OpenAI general model with strong writing and vision.', contextLength: 1_050_000, pricing: { prompt: 2, completion: 12 } },
  { id: 'or-gpt-5.6-luna', name: 'GPT-5.6 Luna', vendor: 'OpenAI', providerId: 'openrouter', providerModelId: 'openai/gpt-5.6-luna', description: 'Fast, low-cost OpenAI model for everyday chat.', contextLength: 1_050_000, pricing: { prompt: 0.2, completion: 1.2 } },
  { id: 'or-gpt-astra-latest', name: 'GPT Astra latest', vendor: 'OpenAI', providerId: 'openrouter', providerModelId: '~openai/gpt-astra-latest', description: 'OpenRouter latest alias for the OpenAI Astra family.', contextLength: 1_050_000, pricing: { prompt: 10, completion: 50 } },
  { id: 'or-gpt-sol-latest', name: 'GPT Sol latest', vendor: 'OpenAI', providerId: 'openrouter', providerModelId: '~openai/gpt-sol-latest', description: 'OpenRouter latest alias for the OpenAI Sol family.', contextLength: 1_050_000, pricing: { prompt: 2, completion: 10 } },
  { id: 'or-gpt-terra-latest', name: 'GPT Terra latest', vendor: 'OpenAI', providerId: 'openrouter', providerModelId: '~openai/gpt-terra-latest', description: 'OpenRouter latest alias for the OpenAI Terra family.', contextLength: 1_050_000, pricing: { prompt: 2, completion: 12 } },
  { id: 'or-gpt-luna-latest', name: 'GPT Luna latest', vendor: 'OpenAI', providerId: 'openrouter', providerModelId: '~openai/gpt-luna-latest', description: 'OpenRouter latest alias for the OpenAI Luna family.', contextLength: 1_050_000, pricing: { prompt: 0.2, completion: 1.2 } },
  { id: 'or-gpt-mini-latest', name: 'GPT Mini latest', vendor: 'OpenAI', providerId: 'openrouter', providerModelId: '~openai/gpt-mini-latest', description: 'OpenRouter latest alias for the OpenAI GPT Mini family.', contextLength: 400_000, pricing: { prompt: 0.75, completion: 4.5 } },
  { id: 'or-gpt-5.5', name: 'GPT-5.5', vendor: 'OpenAI', providerId: 'openrouter', providerModelId: 'openai/gpt-5.5', description: 'Prior OpenAI flagship for complex professional work.', contextLength: 1_050_000, pricing: { prompt: 5, completion: 30 } },
  { id: 'or-gpt-5.5-pro', name: 'GPT-5.5 Pro', vendor: 'OpenAI', providerId: 'openrouter', providerModelId: 'openai/gpt-5.5-pro', description: 'Prior OpenAI deep-reasoning model.', contextLength: 1_050_000, pricing: { prompt: 30, completion: 180 } },
  { id: 'or-gpt-5.4', name: 'GPT-5.4', vendor: 'OpenAI', providerId: 'openrouter', providerModelId: 'openai/gpt-5.4', description: 'Older OpenAI flagship for fallback comparisons.', contextLength: 1_050_000, pricing: { prompt: 2.5, completion: 15 } },
  { id: 'or-gpt-5.4-mini', name: 'GPT-5.4 mini', vendor: 'OpenAI', providerId: 'openrouter', providerModelId: 'openai/gpt-5.4-mini', description: 'Compact OpenAI model for high-volume work.', contextLength: 400_000, pricing: { prompt: 0.75, completion: 4.5 } },
  { id: 'or-gpt-5.4-nano', name: 'GPT-5.4 nano', vendor: 'OpenAI', providerId: 'openrouter', providerModelId: 'openai/gpt-5.4-nano', description: 'Lowest-cost OpenAI model for simple extraction and ranking.', contextLength: 400_000, pricing: { prompt: 0.2, completion: 1.25 } },
  { id: 'or-gpt-5-mini', name: 'GPT-5 mini', vendor: 'OpenAI', providerId: 'openrouter', providerModelId: 'openai/gpt-5-mini', description: 'Legacy compact GPT-5 model.', contextLength: 400_000, pricing: { prompt: 0.25, completion: 2 } },
  // Anthropic
  { id: 'or-claude-fable-5.1', name: 'Claude Fable 5.1', vendor: 'Anthropic', providerId: 'openrouter', providerModelId: 'anthropic/claude-fable-5.1', description: 'Anthropic frontier model for the hardest reasoning and agent work.', contextLength: 1_000_000, pricing: { prompt: 10, completion: 50 } },
  { id: 'or-claude-fable-5', name: 'Claude Fable 5', vendor: 'Anthropic', providerId: 'openrouter', providerModelId: 'anthropic/claude-fable-5', description: 'Prior Claude Fable release.', contextLength: 1_000_000, pricing: { prompt: 10, completion: 50 } },
  { id: 'or-claude-opus-5', name: 'Claude Opus 5', vendor: 'Anthropic', providerId: 'openrouter', providerModelId: 'anthropic/claude-opus-5', description: 'Anthropic flagship for coding and agents.', contextLength: 1_000_000, pricing: { prompt: 5, completion: 25 } },
  { id: 'or-claude-sonnet-5', name: 'Claude Sonnet 5', vendor: 'Anthropic', providerId: 'openrouter', providerModelId: 'anthropic/claude-sonnet-5', description: 'Balanced Claude model for everyday coding and writing.', contextLength: 1_000_000, pricing: { prompt: 2, completion: 10 } },
  { id: 'or-claude-fable-latest', name: 'Claude Fable latest', vendor: 'Anthropic', providerId: 'openrouter', providerModelId: '~anthropic/claude-fable-latest', description: 'OpenRouter latest alias for the Claude Fable family.', contextLength: 1_000_000, pricing: { prompt: 10, completion: 50 } },
  { id: 'or-claude-opus-latest', name: 'Claude Opus latest', vendor: 'Anthropic', providerId: 'openrouter', providerModelId: '~anthropic/claude-opus-latest', description: 'OpenRouter latest alias for the Claude Opus family.', contextLength: 1_000_000, pricing: { prompt: 5, completion: 25 } },
  { id: 'or-claude-sonnet-latest', name: 'Claude Sonnet latest', vendor: 'Anthropic', providerId: 'openrouter', providerModelId: '~anthropic/claude-sonnet-latest', description: 'OpenRouter latest alias for the Claude Sonnet family.', contextLength: 1_000_000, pricing: { prompt: 2, completion: 10 } },
  { id: 'or-claude-haiku-latest', name: 'Claude Haiku latest', vendor: 'Anthropic', providerId: 'openrouter', providerModelId: '~anthropic/claude-haiku-latest', description: 'OpenRouter latest alias for the Claude Haiku family.', contextLength: 200_000, pricing: { prompt: 1, completion: 5 } },
  { id: 'or-claude-opus-4.8', name: 'Claude Opus 4.8', vendor: 'Anthropic', providerId: 'openrouter', providerModelId: 'anthropic/claude-opus-4.8', description: 'Prior Claude Opus flagship.', contextLength: 1_000_000, pricing: { prompt: 5, completion: 25 } },
  { id: 'or-claude-opus-4.8-fast', name: 'Claude Opus 4.8', vendor: 'Anthropic', providerId: 'openrouter', providerModelId: 'anthropic/claude-opus-4.8', description: 'The separate fast route was retired; this id now uses the standard Opus 4.8 route. Retains the old stable id for saved threads.', contextLength: 1_000_000, pricing: { prompt: 5, completion: 25 } },
  { id: 'or-claude-opus-4.7', name: 'Claude Opus 4.7', vendor: 'Anthropic', providerId: 'openrouter', providerModelId: 'anthropic/claude-opus-4.7', description: 'Older Claude Opus release.', contextLength: 1_000_000, pricing: { prompt: 5, completion: 25 } },
  { id: 'or-claude-sonnet-4.7', name: 'Claude Sonnet latest', vendor: 'Anthropic', providerId: 'openrouter', providerModelId: '~anthropic/claude-sonnet-latest', description: 'OpenRouter latest alias for the Claude Sonnet family. Retains the old stable id for saved threads.', contextLength: 1_000_000, pricing: { prompt: 2, completion: 10 } },
  { id: 'or-claude-sonnet-4.6', name: 'Claude Sonnet 4.6', vendor: 'Anthropic', providerId: 'openrouter', providerModelId: 'anthropic/claude-sonnet-4.6', description: 'Prior Claude Sonnet coding and agent model.', contextLength: 1_000_000, pricing: { prompt: 3, completion: 15 } },
  { id: 'or-claude-haiku-4.6', name: 'Claude Haiku latest', vendor: 'Anthropic', providerId: 'openrouter', providerModelId: '~anthropic/claude-haiku-latest', description: 'OpenRouter latest alias for the Claude Haiku family. Retains the old stable id for saved threads.', contextLength: 200_000, pricing: { prompt: 1, completion: 5 } },
  { id: 'or-claude-haiku-4.5', name: 'Claude Haiku 4.5', vendor: 'Anthropic', providerId: 'openrouter', providerModelId: 'anthropic/claude-haiku-4.5', description: 'Fast Claude model for lightweight work.', contextLength: 200_000, pricing: { prompt: 1, completion: 5 } },
  // Google
  { id: 'or-gemini-pro-latest', name: 'Gemini Pro latest', vendor: 'Google', providerId: 'openrouter', providerModelId: '~google/gemini-pro-latest', description: 'OpenRouter latest alias for Gemini Pro.', contextLength: 1_048_576, pricing: { prompt: 2, completion: 12 } },
  { id: 'or-gemini-3.1-pro', name: 'Gemini 3.1 Pro Preview', vendor: 'Google', providerId: 'openrouter', providerModelId: 'google/gemini-3.1-pro-preview', description: 'Large Gemini reasoning and vision model with controllable thinking. Retains the old stable id for saved threads.', contextLength: 1_048_576, pricing: { prompt: 2, completion: 12 } },
  { id: 'or-gemini-3.8-flash', name: 'Gemini 3.8 Flash', vendor: 'Google', providerId: 'openrouter', providerModelId: 'google/gemini-3.8-flash', description: 'Newest Gemini Flash: fast, multimodal, reliable tools.', contextLength: 1_048_576, pricing: { prompt: 0.75, completion: 3.75 } },
  { id: 'or-gemini-3.7-flash', name: 'Gemini 3.7 Flash', vendor: 'Google', providerId: 'openrouter', providerModelId: 'google/gemini-3.7-flash', description: 'Prior Gemini Flash release.', contextLength: 1_048_576, pricing: { prompt: 0.75, completion: 3.75 } },
  { id: 'or-gemini-3.5-flash', name: 'Gemini 3.5 Flash', vendor: 'Google', providerId: 'openrouter', providerModelId: 'google/gemini-3.5-flash', description: 'Older Gemini Flash family model.', contextLength: 1_048_576, pricing: { prompt: 1.5, completion: 9 } },
  { id: 'or-gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite', vendor: 'Google', providerId: 'openrouter', providerModelId: 'google/gemini-3.5-flash-lite', description: 'Cost-efficient Gemini model with controllable thinking.', contextLength: 1_048_576, pricing: { prompt: 0.3, completion: 2.5 } },
  { id: 'or-gemini-3-flash', name: 'Gemini Flash latest', vendor: 'Google', providerId: 'openrouter', providerModelId: '~google/gemini-flash-latest', description: 'OpenRouter latest alias for Gemini Flash. Retains the old stable id for saved threads.', contextLength: 1_048_576, pricing: { prompt: 0.75, completion: 3.75 } },
  { id: 'or-gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', vendor: 'Google', providerId: 'openrouter', providerModelId: 'google/gemini-3.1-flash-lite', description: 'Older cost-efficient Gemini model.', contextLength: 1_048_576, pricing: { prompt: 0.25, completion: 1.5 } },
  // xAI
  { id: 'or-grok-4.6', name: 'Grok 4.6', vendor: 'xAI', providerId: 'openrouter', providerModelId: 'x-ai/grok-4.6', description: 'xAI flagship reasoning model.', contextLength: 500_000, pricing: { prompt: 2, completion: 6 } },
  { id: 'or-grok-4.5', name: 'Grok 4.5', vendor: 'xAI', providerId: 'openrouter', providerModelId: 'x-ai/grok-4.5', description: 'Prior xAI reasoning model.', contextLength: 500_000, pricing: { prompt: 2, completion: 6 } },
  { id: 'or-grok-4.3', name: 'Grok 4.3', vendor: 'xAI', providerId: 'openrouter', providerModelId: 'x-ai/grok-4.3', description: 'Older xAI reasoning model.', contextLength: 1_000_000, pricing: { prompt: 1.25, completion: 2.5 } },
  { id: 'or-grok-4.20', name: 'Grok 4.20', vendor: 'xAI', providerId: 'openrouter', providerModelId: 'x-ai/grok-4.20', description: 'xAI large-context reasoning and agentic tool-calling model.', contextLength: 2_000_000, pricing: { prompt: 1.25, completion: 2.5 } },
  // Open weights and other labs
  { id: 'or-llama-4-maverick', name: 'Llama 4 Maverick', vendor: 'Meta', providerId: 'openrouter', providerModelId: 'meta-llama/llama-4-maverick', description: 'Meta multimodal MoE generalist.', contextLength: 1_048_576, pricing: { prompt: 0.2, completion: 0.696 } },
  { id: 'or-llama-4-scout', name: 'Llama 4 Scout', vendor: 'Meta', providerId: 'openrouter', providerModelId: 'meta-llama/llama-4-scout', description: 'Meta long-context multimodal MoE model.', contextLength: 1_310_720, pricing: { prompt: 0.1, completion: 0.3 } },
  { id: 'or-nemotron-3-ultra', name: 'Nemotron 3 Ultra', vendor: 'NVIDIA', providerId: 'openrouter', providerModelId: 'nvidia/nemotron-3-ultra-550b-a55b', description: 'NVIDIA open-weight frontier reasoning and orchestration MoE.', contextLength: 262_144, pricing: { prompt: 0.625, completion: 3.125 } },
  { id: 'or-nemotron-3-ultra-free', name: 'Nemotron 3 Ultra free', vendor: 'NVIDIA', providerId: 'openrouter', providerModelId: 'nvidia/nemotron-3-ultra-550b-a55b:free', description: 'Default chat, free OpenRouter route for Nemotron 3 Ultra open weights.', contextLength: 1_000_000, pricing: { prompt: 0, completion: 0 } },
  { id: 'or-nemotron-3-super', name: 'Nemotron 3 Super', vendor: 'NVIDIA', providerId: 'openrouter', providerModelId: 'nvidia/nemotron-3-super-120b-a12b', description: 'NVIDIA open-weight 120B/12B-active hybrid MoE for agentic systems.', contextLength: 262_144, pricing: { prompt: 0.085, completion: 0.4 } },
  { id: 'or-nemotron-3-super-free', name: 'Nemotron 3 Super free', vendor: 'NVIDIA', providerId: 'openrouter', providerModelId: 'nvidia/nemotron-3-super-120b-a12b:free', description: 'Free OpenRouter route for Nemotron 3 Super open weights.', contextLength: 262_144, pricing: { prompt: 0, completion: 0 } },
  { id: 'or-nemotron-3.5-lightning', name: 'Nemotron 3.5 Lightning', vendor: 'NVIDIA', providerId: 'openrouter', providerModelId: 'nvidia/nemotron-3.5-lightning', description: 'NVIDIA fast open-weight model for tool-heavy loops.', contextLength: 262_144, pricing: { prompt: 0.08, completion: 0.2 } },
  { id: 'or-nemotron-3.5-lightning-free', name: 'Nemotron 3.5 Lightning free', vendor: 'NVIDIA', providerId: 'openrouter', providerModelId: 'nvidia/nemotron-3.5-lightning:free', description: 'Free OpenRouter route for Nemotron 3.5 Lightning.', contextLength: 1_000_000, pricing: { prompt: 0, completion: 0 } },
  { id: 'or-nemotron-3-nano-free', name: 'Nemotron 3 Nano 30B', vendor: 'NVIDIA', providerId: 'openrouter', providerModelId: 'nvidia/nemotron-3-nano-30b-a3b', description: 'NVIDIA open-weight 30B/3B-active MoE. The free route was retired; this id now uses the low-cost paid route.', contextLength: 262_144, pricing: { prompt: 0.05, completion: 0.2 } },
  { id: 'or-nemotron-3-nano-omni-free', name: 'Nemotron 3 Nano Omni free', vendor: 'NVIDIA', providerId: 'openrouter', providerModelId: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', description: 'Free NVIDIA 30B/3B-active reasoning model with audio, image and video input.', contextLength: 256_000, pricing: { prompt: 0, completion: 0 } },
  { id: 'or-nemotron-3.5-content-safety', name: 'Nemotron 3.5 Content Safety free', vendor: 'NVIDIA', providerId: 'openrouter', providerModelId: 'nvidia/nemotron-3.5-content-safety:free', description: 'NVIDIA guardrail model for prompt and response moderation.', contextLength: 128_000, pricing: { prompt: 0, completion: 0 }, supportsTools: false },
  { id: 'or-deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', vendor: 'DeepSeek', providerId: 'openrouter', providerModelId: 'deepseek/deepseek-v4.1-flash', description: 'Newest low-cost DeepSeek model with vision.', contextLength: 1_048_576, pricing: { prompt: 0.15, completion: 0.6 } },
  { id: 'or-deepseek-v4-pro-0813', name: 'DeepSeek V4 Pro 0813', vendor: 'DeepSeek', providerId: 'openrouter', providerModelId: 'deepseek/deepseek-v4-pro-0813', description: 'Latest DeepSeek open-weight pro reasoning model.', contextLength: 1_048_576, pricing: { prompt: 0.5795, completion: 1.7384 } },
  { id: 'or-deepseek-v4-pro', name: 'DeepSeek V4 Pro', vendor: 'DeepSeek', providerId: 'openrouter', providerModelId: 'deepseek/deepseek-v4-pro', description: 'DeepSeek open-weight pro reasoning model (0423).', contextLength: 1_048_576, pricing: { prompt: 1.6, completion: 3.2 } },
  { id: 'or-deepseek-v4-flash', name: 'DeepSeek V4 Flash', vendor: 'DeepSeek', providerId: 'openrouter', providerModelId: 'deepseek/deepseek-v4-flash', description: 'Low-cost DeepSeek bulk inference model (0423).', contextLength: 1_048_576, pricing: { prompt: 0.0899, completion: 0.1797 } },
  { id: 'or-kimi-k3', name: 'Kimi K3', vendor: 'Moonshot', providerId: 'openrouter', providerModelId: 'moonshotai/kimi-k3', description: 'Moonshot flagship agentic model.', contextLength: 1_048_576, pricing: { prompt: 2.6481, completion: 13.2827 } },
  { id: 'or-kimi-k2.7-code', name: 'Kimi K2.7 Code', vendor: 'Moonshot', providerId: 'openrouter', providerModelId: 'moonshotai/kimi-k2.7-code', description: 'Moonshot coding-tuned Kimi model.', contextLength: 262_144, pricing: { prompt: 0.71, completion: 3.5 } },
  { id: 'or-kimi-k2.6', name: 'Kimi K2.6', vendor: 'Moonshot', providerId: 'openrouter', providerModelId: 'moonshotai/kimi-k2.6', description: 'Prior Kimi agentic MoE model.', contextLength: 262_144, pricing: { prompt: 0.95, completion: 4 } },
  { id: 'or-kimi-k2.5', name: 'Kimi K2.5', vendor: 'Moonshot', providerId: 'openrouter', providerModelId: 'moonshotai/kimi-k2.5', description: 'Older Kimi K2 agentic model.', contextLength: 262_144, pricing: { prompt: 0.45, completion: 2.25 } },
  { id: 'or-qwen3.8-max', name: 'Qwen3.8 Max', vendor: 'Qwen', providerId: 'openrouter', providerModelId: 'qwen/qwen3.8-max-0902', description: 'Alibaba flagship Qwen model with vision and video input.', contextLength: 1_000_000, pricing: { prompt: 2, completion: 6 } },
  { id: 'or-qwen3.8-flash', name: 'Qwen3.8 Flash', vendor: 'Qwen', providerId: 'openrouter', providerModelId: 'qwen/qwen3.8-flash', description: 'Fast low-cost Qwen model.', contextLength: 1_000_000, pricing: { prompt: 0.15, completion: 0.47 } },
  { id: 'or-glm-5.3', name: 'GLM 5.3', vendor: 'Z.ai', providerId: 'openrouter', providerModelId: 'z-ai/glm-5.3', description: 'Z.ai open-weight flagship for coding and agents.', contextLength: 1_310_720, pricing: { prompt: 1.092, completion: 3.432 } },
  { id: 'or-glm-5.3-flash', name: 'GLM 5.3 Flash', vendor: 'Z.ai', providerId: 'openrouter', providerModelId: 'z-ai/glm-5.3-flash', description: 'Fast low-cost GLM model.', contextLength: 1_310_720, pricing: { prompt: 0.15, completion: 0.5 } },
  { id: 'or-minimax-m3', name: 'MiniMax M3', vendor: 'MiniMax', providerId: 'openrouter', providerModelId: 'minimax/minimax-m3', description: 'MiniMax agentic model with vision and video input.', contextLength: 1_048_576, pricing: { prompt: 0.3, completion: 1.2 } },
  { id: 'or-mistral-medium-3.5', name: 'Mistral Medium 3.5', vendor: 'Mistral', providerId: 'openrouter', providerModelId: 'mistralai/mistral-medium-3-5', description: 'Mistral mid-size model for coding and multilingual work.', contextLength: 262_144, pricing: { prompt: 1.5, completion: 7.5 } },

  // ─────────────────────────────────────────────────────────────────
  // Direct image — synthetic "models" that bypass any LLM and send the
  // user's prompt straight to ComfyUI. Useful offline (no wifi): pick
  // one from the model menu and your message becomes the image prompt;
  // no chat round-trip happens.
  // ─────────────────────────────────────────────────────────────────
  {
    id: 'image-direct-comfy-draft',
    name: 'Draft image: SDXL',
    vendor: 'Local image',
    providerId: 'local-image',
    providerModelId: 'comfy-direct-draft',
    description: 'Fast SDXL Lightning draft render. Native size, no upscale, no LLM call.',
    supportsTools: false,
  },
  {
    id: 'image-direct-comfy',
    name: 'Normal image: Flux 2 Klein',
    vendor: 'Local image',
    providerId: 'local-image',
    providerModelId: 'comfy-direct',
    description: 'Default FLUX.2 Klein render. Native size, no upscale, no LLM call.',
    supportsTools: false,
  },
  {
    id: 'image-direct-comfy-upscale',
    name: 'Upscale image: Flux 2 Klein 2x',
    vendor: 'Local image',
    providerId: 'local-image',
    providerModelId: 'comfy-direct-upscale',
    description: 'FLUX.2 Klein render with a 2x hires-fix refinement pass. No LLM call.',
    supportsTools: false,
  },
];

export const DEFAULT_MODEL_ID = 'or-nemotron-3-ultra-free';

export const DEFAULT_OPENROUTER_CATALOG_MODEL_IDS = [
  'or-gpt-6-astra',
  'or-gpt-6-astra-pro',
  'or-gpt-5.6-sol',
  'or-gpt-5.6-sol-pro',
  'or-gpt-5.6-terra',
  'or-gpt-5.6-luna',
  'or-gpt-astra-latest',
  'or-gpt-sol-latest',
  'or-gpt-terra-latest',
  'or-gpt-luna-latest',
  'or-gpt-mini-latest',
  'or-gpt-5.5',
  'or-gpt-5.5-pro',
  'or-gpt-5.4-mini',
  'or-gpt-5.4-nano',
  'or-claude-fable-5.1',
  'or-claude-fable-5',
  'or-claude-opus-5',
  'or-claude-sonnet-5',
  'or-claude-fable-latest',
  'or-claude-opus-latest',
  'or-claude-sonnet-latest',
  'or-claude-haiku-latest',
  'or-claude-opus-4.8',
  'or-claude-sonnet-4.7',
  'or-claude-haiku-4.6',
  'or-gemini-pro-latest',
  'or-gemini-3.1-pro',
  'or-gemini-3.8-flash',
  'or-gemini-3.7-flash',
  'or-gemini-3.5-flash-lite',
  'or-gemini-3-flash',
  'or-grok-4.6',
  'or-grok-4.5',
  'or-grok-4.20',
  'or-llama-4-maverick',
  'or-llama-4-scout',
  'or-nemotron-3-ultra',
  'or-nemotron-3-ultra-free',
  'or-nemotron-3-super',
  'or-nemotron-3-super-free',
  'or-nemotron-3.5-lightning',
  'or-nemotron-3.5-lightning-free',
  'or-nemotron-3-nano-free',
  'or-nemotron-3-nano-omni-free',
  'or-deepseek-v4.1-flash',
  'or-deepseek-v4-pro-0813',
  'or-kimi-k3',
  'or-kimi-k2.7-code',
  'or-kimi-k2.6',
  'or-qwen3.8-max',
  'or-qwen3.8-flash',
  'or-glm-5.3',
  'or-glm-5.3-flash',
  'or-minimax-m3',
  'or-mistral-medium-3.5',
] as const;

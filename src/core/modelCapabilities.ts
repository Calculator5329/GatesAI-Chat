import type { Model } from './types';

/**
 * Whether a model accepts image inputs (vision). Pattern-matched against
 * provider + provider-model-id, with an explicit {@link Model.supportsVision}
 * override taking precedence. Centralized here so the composer, provider
 * adapters, and capability UI all agree.
 *
 * The heuristic is intentionally conservative for families that only
 * partially support vision (Groq, local): we default to false and let
 * the user override via explicit flag in the model entry.
 */
export function modelSupportsVision(model: Pick<Model, 'providerId' | 'providerModelId' | 'supportsVision'>): boolean {
  if (typeof model.supportsVision === 'boolean') return model.supportsVision;

  const id = (model.providerModelId || '').toLowerCase();

  switch (model.providerId) {
    case 'anthropic':
      return id.startsWith('claude-');

    case 'openai':
      return (
        id.startsWith('gpt-5') ||
        id.startsWith('gpt-4o') ||
        id.startsWith('gpt-4.1') ||
        id.startsWith('o1') ||
        id.startsWith('o3') ||
        id.startsWith('o4')
      );

    case 'gemini':
      return id.startsWith('gemini-');

    case 'openrouter':
      return (
        id.startsWith('anthropic/claude-') ||
        id.startsWith('openai/gpt-5') ||
        id.startsWith('openai/gpt-4o') ||
        id.startsWith('openai/gpt-4.1') ||
        id.startsWith('openai/o1') ||
        id.startsWith('openai/o3') ||
        id.startsWith('openai/o4') ||
        id.startsWith('google/gemini-') ||
        id.startsWith('x-ai/grok-') && id.includes('vision') ||
        /\bvl\b|llava|vision|moondream|minicpm-v|internvl/.test(id)
      );

    case 'local':
      return /llava|qwen[^/]*vl|qwen-vl|llama-?3\.2-vision|minicpm-v|internvl|moondream|bakllava|pixtral/.test(id);

    default:
      return false;
  }
}

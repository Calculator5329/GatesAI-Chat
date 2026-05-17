import type { LlmRequest } from '../../core/llm';

export interface ModelFormatProfile {
  id: string;
  label: string;
  match: RegExp;
  notes: string[];
  maxTokens?: number;
  openAiCompat?: {
    reasoningBudgetRatio?: number;
    minReasoningTokens?: number;
  };
}

export const MODEL_FORMAT_PROFILES: ModelFormatProfile[] = [
  {
    id: 'gemini-3-reasoning-budget',
    label: 'Gemini 3 visible-output budget',
    match: /(^|\/)gemini-3/i,
    maxTokens: 1024,
    notes: [
      'Caps default output budget for compatibility smoke tests.',
      'Sets OpenRouter reasoning.max_tokens so hidden thinking does not consume the whole reply.',
    ],
    openAiCompat: {
      reasoningBudgetRatio: 0.5,
      minReasoningTokens: 64,
    },
  },
];

export const DEFAULT_MODEL_FORMAT_PROFILE: ModelFormatProfile = {
  id: 'default-openai-compatible',
  label: 'Default OpenAI-compatible chat',
  match: /.^/,
  maxTokens: 512,
  notes: ['Plain text/tool-call smoke tests with no model-specific request extras.'],
};

export function resolveModelFormatProfile(modelId: string): ModelFormatProfile {
  return MODEL_FORMAT_PROFILES.find(profile => profile.match.test(modelId)) ?? DEFAULT_MODEL_FORMAT_PROFILE;
}

export function maxTokensForRequest(req: LlmRequest): number {
  return req.maxTokens ?? resolveModelFormatProfile(req.modelId).maxTokens ?? 4096;
}

export function openAiCompatBodyExtras(req: LlmRequest): Record<string, unknown> {
  const profile = resolveModelFormatProfile(req.modelId);
  const maxTokens = maxTokensForRequest(req);
  const extras: Record<string, unknown> = { max_tokens: maxTokens };
  const reasoning = profile.openAiCompat;
  if (reasoning?.reasoningBudgetRatio) {
    extras.reasoning = {
      max_tokens: Math.max(
        reasoning.minReasoningTokens ?? 64,
        Math.floor(maxTokens * reasoning.reasoningBudgetRatio),
      ),
    };
  }
  return extras;
}

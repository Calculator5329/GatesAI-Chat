// Implements LLM provider plumbing for modelFormatProfiles.
// Called by RouterStore/ChatStore through the LlmProvider interface; depends on core LLM messages, SSE/JSON parsing, and provider configs.
// Invariant: providers stream normalized LlmChunk events and do not mutate chat state.
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
    match: /(^|\/)gemini-3|^~google\/gemini-(pro|flash)-latest/i,
    notes: [
      'Does not cap normal chat output; explicit caller budgets still win for summaries and tests.',
      'Keeps Gemini on the shared OpenRouter reasoning path so thinking effort can be controlled per thread.',
    ],
  },
];

export const DEFAULT_MODEL_FORMAT_PROFILE: ModelFormatProfile = {
  id: 'default-openai-compatible',
  label: 'Default OpenAI-compatible chat',
  match: /.^/,
  // No default max_tokens — let the model use its full reply budget. Callers
  // that genuinely want a small reply (compaction, titling, micro-mode) still
  // pass `maxTokens` explicitly on the request and that value wins.
  notes: ['Plain text/tool-call defaults with no model-specific request extras.'],
};

export function resolveModelFormatProfile(modelId: string): ModelFormatProfile {
  return MODEL_FORMAT_PROFILES.find(profile => profile.match.test(modelId)) ?? DEFAULT_MODEL_FORMAT_PROFILE;
}

export function maxTokensForRequest(req: LlmRequest): number | undefined {
  return req.maxTokens ?? resolveModelFormatProfile(req.modelId).maxTokens;
}

export function openAiCompatBodyExtras(req: LlmRequest): Record<string, unknown> {
  const profile = resolveModelFormatProfile(req.modelId);
  const maxTokens = maxTokensForRequest(req);
  const extras: Record<string, unknown> = {};
  if (maxTokens != null) extras.max_tokens = maxTokens;
  if (req.thinkingEffort && req.thinkingEffort !== 'none') {
    extras.reasoning = {
      effort: req.thinkingEffort,
      exclude: true,
    };
    return extras;
  }
  const reasoning = profile.openAiCompat;
  if (reasoning?.reasoningBudgetRatio && maxTokens != null) {
    extras.reasoning = {
      max_tokens: Math.max(
        reasoning.minReasoningTokens ?? 64,
        Math.floor(maxTokens * reasoning.reasoningBudgetRatio),
      ),
    };
  }
  return extras;
}

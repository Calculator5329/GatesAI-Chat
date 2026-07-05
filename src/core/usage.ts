// Pure LLM usage and cost helpers shared by stores, selectors, and UI.
// Depends only on core contracts; never reads clocks or mutable app state.
// Invariant: model pricing is USD per 1M tokens.
import type { LlmUsage } from './llm';
import type { Model } from './types';

export const TOKENS_PER_PRICING_UNIT = 1_000_000;

export interface UsageTotals {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
}

export function computeUsageCostFromPricing(
  usage: Pick<LlmUsage, 'promptTokens' | 'completionTokens'>,
  pricing: Model['pricing'],
): number | undefined {
  if (!pricing) return undefined;
  const promptTokens = finiteNonNegative(usage.promptTokens);
  const completionTokens = finiteNonNegative(usage.completionTokens);
  if (promptTokens == null && completionTokens == null) return undefined;
  const promptCost = ((promptTokens ?? 0) * (pricing.prompt ?? 0)) / TOKENS_PER_PRICING_UNIT;
  const completionCost = ((completionTokens ?? 0) * (pricing.completion ?? 0)) / TOKENS_PER_PRICING_UNIT;
  return promptCost + completionCost;
}

export function normalizeLlmUsageForModel(usage: LlmUsage, model: Model | undefined): LlmUsage | null {
  const promptTokens = finiteNonNegative(usage.promptTokens);
  const completionTokens = finiteNonNegative(usage.completionTokens);
  const suppliedTotalTokens = finiteNonNegative(usage.totalTokens);
  const totalTokens = suppliedTotalTokens ?? (
    promptTokens != null || completionTokens != null
      ? (promptTokens ?? 0) + (completionTokens ?? 0)
      : undefined
  );

  const out: LlmUsage = {
    ...(usage.providerId ? { providerId: usage.providerId } : {}),
    ...(usage.modelId ? { modelId: usage.modelId } : {}),
    ...(promptTokens != null ? { promptTokens } : {}),
    ...(completionTokens != null ? { completionTokens } : {}),
    ...(totalTokens != null ? { totalTokens } : {}),
  };

  const reportedCost = finiteNonNegative(usage.costUsd);
  if (reportedCost != null) {
    out.costUsd = reportedCost;
    out.costSource = usage.costSource ?? (isLocalModel(model, usage) ? 'local' : 'provider');
    return hasUsagePayload(out) ? out : null;
  }

  if (isLocalModel(model, usage)) {
    out.costUsd = 0;
    out.costSource = 'local';
    return hasUsagePayload(out) ? out : null;
  }

  if (isKnownFreeModel(model)) {
    out.costUsd = 0;
    out.costSource = 'free';
    return hasUsagePayload(out) ? out : null;
  }

  const computed = computeUsageCostFromPricing(out, model?.pricing);
  if (computed != null) {
    out.costUsd = computed;
    out.costSource = computed === 0 ? 'free' : 'pricing';
  }

  return hasUsagePayload(out) ? out : null;
}

export function emptyUsageTotals(): UsageTotals {
  return {
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    costUsd: 0,
  };
}

export function addUsageToTotals(total: UsageTotals, usage: LlmUsage): void {
  total.requests += 1;
  total.promptTokens += finiteNonNegative(usage.promptTokens) ?? 0;
  total.completionTokens += finiteNonNegative(usage.completionTokens) ?? 0;
  total.totalTokens += finiteNonNegative(usage.totalTokens)
    ?? ((finiteNonNegative(usage.promptTokens) ?? 0) + (finiteNonNegative(usage.completionTokens) ?? 0));
  total.costUsd += finiteNonNegative(usage.costUsd) ?? 0;
}

export function formatUsd(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  const abs = Math.abs(safe);
  const decimals = abs > 0 && abs < 0.01 ? 4 : 2;
  return `$${safe.toFixed(decimals)}`;
}

export function formatTokenCount(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  return safe.toLocaleString();
}

function hasUsagePayload(usage: LlmUsage): boolean {
  return usage.promptTokens != null
    || usage.completionTokens != null
    || usage.totalTokens != null
    || usage.costUsd != null;
}

function isLocalModel(model: Model | undefined, usage: LlmUsage): boolean {
  return usage.providerId === 'ollama'
    || usage.providerId === 'openai-compat'
    || usage.providerId === 'local-image'
    || model?.providerId === 'ollama'
    || model?.providerId === 'openai-compat'
    || model?.providerId === 'local-image';
}

function isKnownFreeModel(model: Model | undefined): boolean {
  if (!model || model.providerId !== 'openrouter') return false;
  if (model.providerModelId.endsWith(':free')) return true;
  const pricing = model.pricing;
  return !!pricing && (pricing.prompt ?? 0) === 0 && (pricing.completion ?? 0) === 0;
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

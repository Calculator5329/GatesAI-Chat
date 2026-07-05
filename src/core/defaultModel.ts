import { DEFAULT_MODEL_ID } from './models';
import type { Model } from './types';
import { isLocalChatModel } from './localModelRules';
import { localModelContextLength } from './localModelMeta';

export interface DefaultModelRegistry {
  readonly all: readonly Model[];
  findById(id: string | undefined): Model | undefined;
}

export interface ResolveDefaultModelArgs {
  hasOpenRouterKey: boolean;
  ollamaOnline: boolean;
  localModels: readonly Model[];
  registry: DefaultModelRegistry;
}

const CHEAP_CLOUD_MODEL_IDS = [
  'or-gemini-3.1-flash-lite',
  'or-gemini-3-flash',
];

export function resolveDefaultModelId(args: ResolveDefaultModelArgs): string {
  if (args.hasOpenRouterKey) return DEFAULT_MODEL_ID;
  const local = args.ollamaOnline ? bestLocalModel(args.localModels) : undefined;
  return local?.id ?? DEFAULT_MODEL_ID;
}

export function resolveBackgroundModelId(args: ResolveDefaultModelArgs): string | null {
  if (args.hasOpenRouterKey) {
    return CHEAP_CLOUD_MODEL_IDS.find(id => args.registry.findById(id)) ?? DEFAULT_MODEL_ID;
  }
  if (!args.ollamaOnline) return null;
  return bestSmallLocalModel(args.localModels)?.id ?? null;
}

export function bestLocalModel(localModels: readonly Model[]): Model | undefined {
  return rankLocalModels(localModels, { preferSmall: false })[0];
}

export function bestSmallLocalModel(localModels: readonly Model[]): Model | undefined {
  return rankLocalModels(localModels, { preferSmall: true })[0];
}

function rankLocalModels(
  localModels: readonly Model[],
  options: { preferSmall: boolean },
): Model[] {
  return localModels
    .map((model, index) => ({ model, index }))
    .filter(item => isLocalChatModel(item.model))
    .sort((a, b) => compareLocalModels(a, b, options))
    .map(item => item.model);
}

function compareLocalModels(
  a: { model: Model; index: number },
  b: { model: Model; index: number },
  options: { preferSmall: boolean },
): number {
  const toolsDelta = toolsScore(b.model) - toolsScore(a.model);
  if (toolsDelta !== 0) return toolsDelta;

  if (options.preferSmall) {
    const sizeDelta = smallSizeScore(b.model) - smallSizeScore(a.model);
    if (sizeDelta !== 0) return sizeDelta;
  }

  const contextDelta = (localModelContextLength(b.model) ?? 0) - (localModelContextLength(a.model) ?? 0);
  if (contextDelta !== 0) return contextDelta;
  return a.index - b.index;
}

function toolsScore(model: Model): number {
  return model.supportsTools === false ? 0 : 1;
}

function smallSizeScore(model: Model): number {
  const size = parameterBillions(model.providerModelId);
  if (size == null) return 0;
  if (size <= 3.5) return 3;
  if (size <= 8) return 2;
  if (size <= 14) return 1;
  return 0;
}

function parameterBillions(providerModelId: string): number | null {
  const match = providerModelId.match(/(?:^|[:_-])(\d+(?:\.\d+)?)b(?:$|[_-])/i)
    ?? providerModelId.match(/(?:^|[:_-])(\d+(?:\.\d+)?)b$/i);
  return match ? Number(match[1]) : null;
}

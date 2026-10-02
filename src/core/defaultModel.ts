import { DEFAULT_MODEL_ID } from './models';
import type { Model } from './types';
import { isLocalChatModel } from './localModelRules';
import { isOllamaCloudModel, localModelParameterBillions } from './localModelMeta';

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

export interface ResolveChatDefaultArgs extends ResolveDefaultModelArgs {
  /** The "prefer local models" setting. */
  preferLocalModels: boolean;
  /** Model picker recents, newest first. */
  recentModelIds: readonly string[];
}

const CHEAP_CLOUD_MODEL_IDS = [
  'or-gemini-3.1-flash-lite',
  'or-gemini-3-flash',
];

/**
 * Model a new chat starts on. With preferLocalModels on and Ollama online, a
 * local chat model wins even over an OpenRouter key: the most recently picked
 * one that is still installed, else the best ranked. Otherwise the cloud
 * default with a key, or the best local model without one. Ollama cloud
 * models never count as local here.
 */
export function resolveDefaultModelId(args: ResolveChatDefaultArgs): string {
  if (args.preferLocalModels && args.ollamaOnline) {
    const local = recentLocalModel(args.localModels, args.recentModelIds) ?? bestLocalModel(args.localModels);
    if (local) return local.id;
  }
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

function recentLocalModel(localModels: readonly Model[], recentModelIds: readonly string[]): Model | undefined {
  for (const id of recentModelIds) {
    const model = localModels.find(item => item.id === id);
    if (model && runsOnThisMachine(model)) return model;
  }
  return undefined;
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
    .filter(item => runsOnThisMachine(item.model))
    .sort((a, b) => compareLocalModels(a, b, options))
    .map(item => item.model);
}

function runsOnThisMachine(model: Model): boolean {
  return isLocalChatModel(model) && !isOllamaCloudModel(model);
}

/**
 * Tool support first, then (for background helpers) a small-size tier, then
 * parameter count descending, then catalog order. Context length is left out:
 * Ollama reports the trained maximum, which ties across modern families.
 */
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

  const paramsDelta = (localModelParameterBillions(b.model) ?? 0) - (localModelParameterBillions(a.model) ?? 0);
  if (paramsDelta !== 0) return paramsDelta;
  return a.index - b.index;
}

function toolsScore(model: Model): number {
  return model.supportsTools === false ? 0 : 1;
}

function smallSizeScore(model: Model): number {
  const size = localModelParameterBillions(model);
  if (size == null) return 0;
  if (size <= 3.5) return 3;
  if (size <= 8) return 2;
  if (size <= 14) return 1;
  return 0;
}

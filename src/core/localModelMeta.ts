import type { Model } from './types';
import { modelSupportsVision } from './modelCapabilities';
import { ollamaModelSupportsTools } from './localModelRules';

/** Registry ids of Ollama models are `ollama-<tag>` (services/llm/ollamaCatalog). */
export const OLLAMA_MODEL_ID_PREFIX = 'ollama-';

/** What the composer banner and a failed turn say when a chat's local model is not on the configured Ollama. */
export function missingLocalModelMessage(tag: string, ollamaBaseUrl: string): string {
  return `${tag} is not on the Ollama at ${ollamaBaseUrl}. Pull it there, or pick another model for this chat.`;
}

export type LocalModelChip = 'vision' | 'reasoning' | 'fast' | 'tools';

/**
 * An Ollama catalog entry. Each extra field is set only when /api/tags
 * reported it. `supportsThinking` decides the reasoning chip.
 * `maxContextLength` is the trained maximum (`details.context_length`), shown
 * as a ceiling and never budgeted against: Ollama runs a smaller window unless
 * configured, so budgeting keeps the provider default from core/tokens.
 * `parameterBillions` comes from `details.parameter_size`. `remoteHost` marks
 * an Ollama cloud model, listed by the local server but run elsewhere.
 */
export type OllamaCatalogModel = Model & {
  supportsThinking?: boolean;
  maxContextLength?: number;
  parameterBillions?: number;
  remoteHost?: string;
};

export interface LocalModelMeta {
  family: string;
  tag: string;
  capabilities: LocalModelChip[];
  contextLength?: number;
  /** `CLOUD` for an Ollama cloud model, which runs on Ollama's servers, not this hardware. */
  costLabel: 'LOCAL' | 'CLOUD';
}

export type LocalModelContextProfile = 'full' | 'slim';

export const SMALL_LOCAL_CONTEXT_TOKENS = 8_000;

interface LocalFamilyMeta {
  family: string;
  match: RegExp;
  tag: string;
  capabilities: Array<Exclude<LocalModelChip, 'tools' | 'vision'>>;
  contextLength: number;
}

const LOCAL_FAMILIES: LocalFamilyMeta[] = [
  { family: 'qwen-coder', match: /^qwen[\w.-]*-coder|^qwen[\w.-]*coder/i, tag: 'local coding model', capabilities: ['fast'], contextLength: 128_000 },
  { family: 'deepseek-r1', match: /^deepseek-r1/i, tag: 'local reasoning model', capabilities: ['reasoning'], contextLength: 128_000 },
  { family: 'llava', match: /^llava/i, tag: 'local vision chat model', capabilities: [], contextLength: 4_096 },
  { family: 'llama', match: /^llama/i, tag: 'local general chat model', capabilities: ['fast'], contextLength: 128_000 },
  { family: 'qwen', match: /^qwen/i, tag: 'local multilingual chat model', capabilities: ['fast'], contextLength: 128_000 },
  { family: 'mistral', match: /^mistral|^mixtral/i, tag: 'local general chat model', capabilities: ['fast'], contextLength: 32_000 },
  { family: 'gemma', match: /^gemma/i, tag: 'local efficient chat model', capabilities: ['fast'], contextLength: 8_192 },
  { family: 'phi', match: /^phi/i, tag: 'local small chat model', capabilities: ['fast'], contextLength: 128_000 },
];

export function localModelMetaFor(model: OllamaCatalogModel): LocalModelMeta | null {
  if (model.providerId !== 'ollama') return null;
  const id = normalizeLocalModelId(model.providerModelId);
  const family = LOCAL_FAMILIES.find(item => item.match.test(id));
  const cloud = isOllamaCloudModel(model);
  const cloudTag = cloud ? 'Ollama cloud model' : undefined;
  const costLabel = cloud ? 'CLOUD' : 'LOCAL';
  if (!family) {
    const capabilities = capabilitiesForLocalModel(model, []);
    return {
      family: 'local',
      tag: cloudTag ?? 'private local chat',
      capabilities,
      costLabel,
    };
  }

  return {
    family: family.family,
    tag: cloudTag ?? family.tag,
    capabilities: capabilitiesForLocalModel(model, family.capabilities),
    contextLength: family.contextLength,
    costLabel,
  };
}

export function localModelContextLength(model: Model): number | undefined {
  return model.contextLength ?? model.contextWindow ?? localModelMetaFor(model)?.contextLength;
}

/** Most context the model supports, for display only: what Ollama reported, else the family table. */
export function localModelMaxContextLength(model: OllamaCatalogModel): number | undefined {
  return model.maxContextLength ?? localModelMetaFor(model)?.contextLength;
}

/** Size in billions of parameters: what Ollama reported, else one parsed from the tag (`qwen2.5:7b`). */
export function localModelParameterBillions(model: OllamaCatalogModel): number | undefined {
  if (model.parameterBillions !== undefined) return model.parameterBillions;
  const match = model.providerModelId.match(/(?:^|[:_-])(\d+(?:\.\d+)?)b(?:$|[_-])/i);
  return match ? Number(match[1]) : undefined;
}

/** True for an Ollama cloud model: the local server lists it but runs it on `remoteHost`. */
export function isOllamaCloudModel(model: OllamaCatalogModel): boolean {
  return Boolean(model.remoteHost);
}

export function localModelContextProfile(model: Model): LocalModelContextProfile {
  if (model.providerId !== 'ollama') return 'full';
  const contextLength = localModelContextLength(model);
  return contextLength != null && contextLength < SMALL_LOCAL_CONTEXT_TOKENS ? 'slim' : 'full';
}

/**
 * Explicit catalog flags (from Ollama's reported capabilities) win; the name
 * rules and family table only fill in what the catalog left unset.
 */
function capabilitiesForLocalModel(
  model: Model,
  base: Array<Exclude<LocalModelChip, 'tools' | 'vision'>>,
): LocalModelChip[] {
  const capabilities: LocalModelChip[] = [];
  const tools = model.supportsTools ?? ollamaModelSupportsTools(model.providerModelId);
  if (tools) capabilities.push('tools');
  if (modelSupportsVision(model)) capabilities.push('vision');
  const thinking = reportedThinking(model);
  capabilities.push(...(thinking === undefined ? base : base.filter(chip => chip !== 'reasoning')));
  if (thinking) capabilities.push('reasoning');
  return [...new Set(capabilities)];
}

function reportedThinking(model: Model): boolean | undefined {
  return 'supportsThinking' in model && typeof model.supportsThinking === 'boolean'
    ? model.supportsThinking
    : undefined;
}

function normalizeLocalModelId(id: string): string {
  return id.toLowerCase().replace(/^ollama[-/]/, '');
}

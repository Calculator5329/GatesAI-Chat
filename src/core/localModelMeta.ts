import type { Model } from './types';
import { modelSupportsVision } from './modelCapabilities';
import { ollamaModelSupportsTools } from './localModelRules';
import { contextWindowFor } from './tokens';

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
 * as a ceiling and never budgeted against. `contextLength` is the window the
 * model actually loads with: the Modelfile `num_ctx` from /api/show, or the
 * one GatesAI sends (services/llm/modelFormatProfiles); unset means Ollama's
 * own default (core/tokens OLLAMA_DEFAULT_CONTEXT_TOKENS). OllamaStore
 * derives it from the facts below, which are kept only while the tag's
 * `digest` is unchanged and persist with the catalog.
 * `parameterBillions` comes from `details.parameter_size`. `remoteHost` marks
 * an Ollama cloud model, listed by the local server but run elsewhere.
 */
export type OllamaCatalogModel = Model & {
  supportsThinking?: boolean;
  maxContextLength?: number;
  parameterBillions?: number;
  remoteHost?: string;
  /** Tag digest from /api/tags; a new digest means the tag was re-created. */
  digest?: string;
  /** Modelfile `num_ctx` from POST /api/show; unset when it sets none. */
  modelfileNumCtx?: number;
  /** The digest /api/show last answered for, so a restart does not ask again. */
  modelfileCheckedDigest?: string;
  /**
   * `context_length` that GET /api/ps last reported while the model was
   * loaded: the window Ollama gave whichever client loaded it last (Modelfile,
   * that client's `num_ctx`, server OLLAMA_CONTEXT_LENGTH or its VRAM-based
   * default). Decides the window only when the Modelfile sets no `num_ctx`.
   * Kept after unload; dropped on a new digest or a new base URL.
   */
  observedContextLength?: number;
};

export interface LocalModelMeta {
  family: string;
  tag: string;
  capabilities: LocalModelChip[];
  contextLength?: number;
  /** `CLOUD` for an Ollama cloud model, which runs on Ollama's servers, not this hardware. */
  costLabel: 'LOCAL' | 'CLOUD';
}

/**
 * How much prompt a local model gets, from its loaded window: `slim` (< 8000)
 * forces micro mode, `compact` (< 32768) keeps the chat's mode but sends the
 * compact prompt and tool schemas (SP-2), `full` sends everything.
 */
export type LocalModelContextProfile = 'full' | 'compact' | 'slim';

export const SMALL_LOCAL_CONTEXT_TOKENS = 8_000;

/**
 * Below this loaded window (and at or above SMALL_LOCAL_CONTEXT_TOKENS) a
 * local turn keeps full history but sends the compact prompt and tool
 * schemas (SP-2; services/chat/promptSlimming). 16384-window models land here.
 */
export const COMPACT_LOCAL_CONTEXT_TOKENS = 32_768;

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

/**
 * The window an Ollama model runs with: what /api/show or the request sets,
 * else Ollama's default. Never the family table, which holds trained sizes
 * that Ollama does not load unless told to.
 */
export function localModelContextLength(model: Model): number | undefined {
  if (model.providerId !== 'ollama') return model.contextLength ?? model.contextWindow;
  if (isOllamaCloudModel(model)) return model.contextLength ?? ollamaCloudContextLength(model);
  return contextWindowFor(model);
}

/**
 * An Ollama cloud model runs on Ollama's servers, not with the local 4096
 * default: its window is the reported maximum, else the compact threshold so
 * it still runs `full`.
 */
export function ollamaCloudContextLength(model: OllamaCatalogModel): number {
  return model.maxContextLength ?? COMPACT_LOCAL_CONTEXT_TOKENS;
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

/** True for a coding-tuned model (qwen2.5-coder, devstral, codestral, ...), which the chat default ranks last. */
export function isCodingTunedLocalModel(model: OllamaCatalogModel): boolean {
  return /coder|codestral|codellama|codegemma|devstral/i.test(model.providerModelId);
}

/** True for an Ollama cloud model: the local server lists it but runs it on `remoteHost`. */
export function isOllamaCloudModel(model: OllamaCatalogModel): boolean {
  return Boolean(model.remoteHost);
}

export function localModelContextProfile(model: Model): LocalModelContextProfile {
  if (model.providerId !== 'ollama' || isOllamaCloudModel(model)) return 'full';
  const contextLength = localModelContextLength(model);
  if (contextLength == null) return 'full';
  if (contextLength < SMALL_LOCAL_CONTEXT_TOKENS) return 'slim';
  return contextLength < COMPACT_LOCAL_CONTEXT_TOKENS ? 'compact' : 'full';
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

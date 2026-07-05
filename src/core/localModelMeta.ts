import type { Model } from './types';
import { modelSupportsVision } from './modelCapabilities';
import { ollamaModelSupportsTools } from './localModelRules';

export type LocalModelChip = 'vision' | 'reasoning' | 'fast' | 'tools';

export interface LocalModelMeta {
  family: string;
  tag: string;
  capabilities: LocalModelChip[];
  contextLength?: number;
  costLabel: 'LOCAL';
}

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

export function localModelMetaFor(model: Model): LocalModelMeta | null {
  if (model.providerId !== 'ollama') return null;
  const id = normalizeLocalModelId(model.providerModelId);
  const family = LOCAL_FAMILIES.find(item => item.match.test(id));
  if (!family) {
    const capabilities = capabilitiesForLocalModel(model, []);
    return {
      family: 'local',
      tag: 'private local chat',
      capabilities,
      costLabel: 'LOCAL',
    };
  }

  return {
    family: family.family,
    tag: family.tag,
    capabilities: capabilitiesForLocalModel(model, family.capabilities),
    contextLength: family.contextLength,
    costLabel: 'LOCAL',
  };
}

export function localModelContextLength(model: Model): number | undefined {
  return model.contextLength ?? model.contextWindow ?? localModelMetaFor(model)?.contextLength;
}

function capabilitiesForLocalModel(
  model: Model,
  base: Array<Exclude<LocalModelChip, 'tools' | 'vision'>>,
): LocalModelChip[] {
  const capabilities: LocalModelChip[] = [];
  if (model.supportsTools !== false && ollamaModelSupportsTools(model.providerModelId)) capabilities.push('tools');
  if (modelSupportsVision(model)) capabilities.push('vision');
  capabilities.push(...base);
  return [...new Set(capabilities)];
}

function normalizeLocalModelId(id: string): string {
  return id.toLowerCase().replace(/^ollama[-/]/, '');
}

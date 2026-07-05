import type { Model } from './types';

const OLLAMA_TOOL_BLOCKLIST = [
  /^gemma\d*(:|$)/i,
  /^phi\d*(:|$)/i,
  /^codellama(:|$)/i,
];

const OLLAMA_EMBEDDING_BLOCKLIST = [
  /^nomic-embed/i,
  /^mxbai-embed/i,
  /^all-minilm/i,
  /^bge-/i,
  /-embed(:|$)/i,
];

const OLLAMA_VISION_ONLY_BLOCKLIST = [
  /^moondream(:|$)/i,
];

export function isOllamaEmbeddingModelTag(providerModelId: string): boolean {
  return OLLAMA_EMBEDDING_BLOCKLIST.some(re => re.test(providerModelId));
}

export function ollamaModelSupportsTools(providerModelId: string): boolean {
  return !OLLAMA_TOOL_BLOCKLIST.some(re => re.test(providerModelId));
}

export function isOllamaVisionOnlyModelTag(providerModelId: string): boolean {
  return OLLAMA_VISION_ONLY_BLOCKLIST.some(re => re.test(providerModelId));
}

export function isLocalChatModel(model: Pick<Model, 'providerId' | 'providerModelId'>): boolean {
  if (model.providerId !== 'ollama') return false;
  const id = model.providerModelId;
  return !isOllamaEmbeddingModelTag(id) && !isOllamaVisionOnlyModelTag(id);
}

import type { ProviderId } from './llm';

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  desc: string;
  /** Whether this provider needs an API key from the user. */
  needsKey: boolean;
  /** Whether this provider needs a base URL (local OpenAI-compatible servers). */
  needsBaseUrl: boolean;
  /** Sensible default base URL when applicable. */
  defaultBaseUrl?: string;
  /** Where to get a key (shown as a help link). */
  keyUrl?: string;
}

/** Order is the order shown in the API menu. */
export const PROVIDERS: ProviderInfo[] = [
  { id: 'openrouter', name: 'OpenRouter', desc: 'Unified gateway — 300+ models',  needsKey: true,  needsBaseUrl: false, keyUrl: 'https://openrouter.ai/keys' },
  { id: 'anthropic',  name: 'Anthropic',  desc: 'Claude Opus, Sonnet, Haiku',     needsKey: true,  needsBaseUrl: false, keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'openai',     name: 'OpenAI',     desc: 'GPT-5, GPT-4.1, o-series',       needsKey: true,  needsBaseUrl: false, keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'gemini',     name: 'Google AI',  desc: 'Gemini 2.5 Pro, Flash',          needsKey: true,  needsBaseUrl: false, keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'groq',       name: 'Groq',       desc: 'Fast Llama / Mixtral inference', needsKey: true,  needsBaseUrl: false, keyUrl: 'https://console.groq.com/keys' },
  { id: 'local',      name: 'Local',      desc: 'Ollama, LM Studio, vLLM, llama.cpp', needsKey: false, needsBaseUrl: true, defaultBaseUrl: 'http://localhost:11434/v1' },
];

export function findProvider(id: ProviderId): ProviderInfo | undefined {
  return PROVIDERS.find(p => p.id === id);
}

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
];

export function findProvider(id: ProviderId): ProviderInfo | undefined {
  return PROVIDERS.find(p => p.id === id);
}

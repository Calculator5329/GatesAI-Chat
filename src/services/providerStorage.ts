import type { ProviderConfigs } from '../core/llm';

const KEY = 'gatesai.providers.v1';
const ROUTING_KEY = 'gatesai.routing.v1';

export function loadProviderConfigs(): ProviderConfigs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ProviderConfigs;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveProviderConfigs(configs: ProviderConfigs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(configs));
  } catch {
    // ignore quota / privacy-mode failures
  }
}

/**
 * Which path wins when both a direct provider key and an OpenRouter key are
 * configured. `'direct'` matches the historical behavior; `'openrouter'`
 * funnels everything routable through OR for unified billing/logging.
 */
export type DefaultProvider = 'direct' | 'openrouter';

export function loadDefaultProvider(): DefaultProvider {
  try {
    const raw = localStorage.getItem(ROUTING_KEY);
    if (!raw) return 'direct';
    const parsed = JSON.parse(raw) as { defaultProvider?: DefaultProvider };
    return parsed?.defaultProvider === 'openrouter' ? 'openrouter' : 'direct';
  } catch {
    return 'direct';
  }
}

export function saveDefaultProvider(value: DefaultProvider): void {
  try {
    localStorage.setItem(ROUTING_KEY, JSON.stringify({ defaultProvider: value }));
  } catch {
    // ignore quota / privacy-mode failures
  }
}

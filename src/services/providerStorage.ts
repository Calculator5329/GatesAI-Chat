import type { ProviderConfigs } from '../core/llm';

const KEY = 'gatesai.providers.v1';
const ROUTING_KEY = 'gatesai.routing.v1';

export function loadProviderConfigs(): ProviderConfigs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ProviderConfigs;
    if (!parsed || typeof parsed !== 'object') return {};
    localStorage.removeItem(ROUTING_KEY);
    const next: ProviderConfigs = {};
    const openrouterKey = extractOpenRouterKey(parsed);
    if (openrouterKey) next.openrouter = { apiKey: openrouterKey };
    return next;
  } catch {
    return {};
  }
}

export function saveProviderConfigs(configs: ProviderConfigs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(configs));
    localStorage.removeItem(ROUTING_KEY);
  } catch {
    // ignore quota / privacy-mode failures
  }
}

function extractOpenRouterKey(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined;
  const obj = parsed as Record<string, unknown>;
  const nested = obj.openrouter ?? obj.openRouter;
  if (typeof nested === 'string') return nested.trim() || undefined;
  if (nested && typeof nested === 'object') {
    const value = (nested as Record<string, unknown>).apiKey ?? (nested as Record<string, unknown>).key;
    if (typeof value === 'string') return value.trim() || undefined;
  }
  for (const key of ['openrouterApiKey', 'openRouterApiKey', 'openrouterKey', 'openRouterKey']) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  const apiKeys = obj.apiKeys;
  if (apiKeys && typeof apiKeys === 'object') {
    const value = (apiKeys as Record<string, unknown>).openrouter ?? (apiKeys as Record<string, unknown>).openRouter;
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

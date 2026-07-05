// Persists or coordinates service-level state for providerStorage.
// Called by stores and tool services; depends on snapshot contracts, bridge/local storage, and core types.
// Invariant: services normalize legacy data before handing snapshots back to stores.
import type { ProviderConfigs } from '../core/llm';
import { jsonSlot } from './storage/jsonSlot';
import { browserLocalStorage, type KeyValuePersistence, type PersistenceProvider } from './storage/persistenceProvider';
import { normalizeOpenAiCompatBaseUrl } from './llm/openaiCompatCatalog';

/**
 * Owns the provider-credentials slot. The parser is the migration boundary
 * for the OpenRouter-only foundation: any historical shape (nested
 * `openrouter`, top-level `openrouterApiKey`, `apiKeys.openRouter`, etc.)
 * is reduced to the canonical `{ openrouter: { apiKey } }`. The legacy
 * `gatesai.routing.v1` slot is cleaned up on every load so it doesn't
 * resurface.
 */
const ROUTING_KEY = 'gatesai.routing.v1';

export function createProviderConfigsPersistence(
  storage: KeyValuePersistence = browserLocalStorage(),
): PersistenceProvider<ProviderConfigs> {
  return jsonSlot<ProviderConfigs>('gatesai.providers.v1', raw => {
    try {
      storage.removeItem(ROUTING_KEY);
    } catch {
      // ignore quota / privacy-mode failures
    }
    if (!raw || typeof raw !== 'object') return {};
    const next: ProviderConfigs = {};
    const openrouterKey = extractOpenRouterKey(raw);
    if (openrouterKey) next.openrouter = { apiKey: openrouterKey };
    const openAiCompat = extractOpenAiCompatConfig(raw);
    if (openAiCompat) next['openai-compat'] = openAiCompat;
    return next;
  }, storage);
}

export const providerConfigsPersistence = createProviderConfigsPersistence();

export const loadProviderConfigs = providerConfigsPersistence.load;
export const saveProviderConfigs = providerConfigsPersistence.save;

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

function extractOpenAiCompatConfig(parsed: unknown): ProviderConfigs['openai-compat'] | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined;
  const obj = parsed as Record<string, unknown>;
  const nested = obj['openai-compat'] ?? obj.openaiCompat ?? obj.openAiCompat;
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) return undefined;
  const source = nested as Record<string, unknown>;
  const baseUrl = typeof source.baseUrl === 'string' ? normalizeOpenAiCompatBaseUrl(source.baseUrl) : '';
  const apiKey = typeof source.apiKey === 'string' && source.apiKey.trim() ? source.apiKey.trim() : undefined;
  const label = typeof source.label === 'string' && source.label.trim() ? source.label.trim() : undefined;
  const available = typeof source.available === 'boolean' ? source.available : undefined;
  if (!baseUrl && !apiKey && !label && available === undefined) return undefined;
  return {
    ...(baseUrl ? { baseUrl } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(label ? { label } : {}),
    ...(available !== undefined ? { available } : {}),
  };
}

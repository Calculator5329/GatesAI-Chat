import type { ProviderConfigs } from '../core/llm';

const KEY = 'gatesai.providers.v1';

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

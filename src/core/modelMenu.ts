// Defines shared modelMenu domain contracts and pure helpers for chat, models, tokens, or workspace paths.
// Called by stores, services, components, and tests; depends on stable TypeScript data shapes.
// Invariant: core modules stay side-effect free except for explicit cache helpers.
import type { Model } from './types';

export interface ModelMenuSection {
  title: string;
  models: Model[];
  favorite?: boolean;
}

export const FAVORITE_MODEL_IDS = [
  'or-gemini-3-flash',
  'or-deepseek-v4-flash',
  'or-gpt-5.5',
  'or-claude-opus-4.7',
  'or-gemini-3.1-pro',
  'image-direct-comfy',
] as const;

export const FAVORITE_PROVIDER_MODEL_IDS = [
  'google/gemini-3-flash-preview',
  'deepseek/deepseek-v4-flash',
  'openai/gpt-5.5',
  'anthropic/claude-opus-4.7',
  'google/gemini-3.1-pro-preview',
  'comfy-direct',
] as const;

export const TOP_PROVIDER_VENDOR_ORDER = [
  'Google',
  'Anthropic',
  'OpenAI',
  'DeepSeek',
  'xAI',
] as const;

export function buildModelMenuSections(models: readonly Model[]): ModelMenuSection[] {
  const byId = new Map(models.map(model => [model.id, model]));
  const byProviderModelId = new Map(models.map(model => [model.providerModelId, model]));
  const favoriteModels = FAVORITE_MODEL_IDS
    .map((id, index) => byId.get(id) ?? byProviderModelId.get(FAVORITE_PROVIDER_MODEL_IDS[index]))
    .filter((model): model is Model => Boolean(model));
  const favoriteIds = new Set(favoriteModels.map(model => model.id));
  const favoriteProviderModelIds = new Set(favoriteModels.map(model => model.providerModelId));
  const remaining = models.filter(model =>
    !favoriteIds.has(model.id) &&
    !favoriteProviderModelIds.has(model.providerModelId)
  );
  const byVendor = new Map<string, Model[]>();

  for (const model of remaining) {
    const group = byVendor.get(model.vendor) ?? [];
    group.push(model);
    byVendor.set(model.vendor, group);
  }

  const sections: ModelMenuSection[] = [];
  if (favoriteModels.length) {
    sections.push({ title: 'Favorites', models: favoriteModels, favorite: true });
  }

  for (const vendor of TOP_PROVIDER_VENDOR_ORDER) {
    const group = byVendor.get(vendor);
    if (!group?.length) continue;
    sections.push({ title: vendor, models: group });
    byVendor.delete(vendor);
  }

  for (const [vendor, group] of byVendor) {
    if (group.length) sections.push({ title: vendor, models: group });
  }

  return sections;
}

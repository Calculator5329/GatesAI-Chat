import type { Model } from '../../core/types';

export type OpenRouterCompatibilityMode = 'curated' | 'sample' | 'all';

export function selectOpenRouterCompatibilityTargets(
  models: Model[],
  mode: OpenRouterCompatibilityMode,
): Model[] {
  const openrouter = uniqueByProviderModel(models)
    .filter(model => model.providerId === 'openrouter')
    .filter(model => model.supportsTools !== false);
  if (mode === 'all') return openrouter;
  const curated = openrouter.filter(model => !model.dynamic);
  if (mode === 'curated') return curated.length ? curated : openrouter.slice(0, 16);

  const byVendor = new Map<string, Model[]>();
  for (const model of openrouter) {
    const bucket = byVendor.get(model.vendor) ?? [];
    bucket.push(model);
    byVendor.set(model.vendor, bucket);
  }
  return [...byVendor.values()].flatMap(bucket => bucket.slice(0, 2)).slice(0, 32);
}

function uniqueByProviderModel(models: Model[]): Model[] {
  const seen = new Set<string>();
  const out: Model[] = [];
  for (const model of models) {
    const key = `${model.providerId}:${model.providerModelId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(model);
  }
  return out;
}

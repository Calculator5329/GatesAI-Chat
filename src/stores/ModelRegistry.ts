// Owns observable ModelRegistry state and actions for the app runtime.
// Called by RootStore, React context hooks, and service callbacks; depends on services/core contracts.
// Invariant: mutations happen through store actions so UI derivations stay consistent.
import { computed, makeAutoObservable } from 'mobx';
import type { Model } from '../core/types';
import type { ProviderId } from '../core/llm';
import { MODELS as CURATED } from '../core/models';

/**
 * Single source of truth for "all known models".
 *
 *   curated  — compiled into the bundle (`core/models.ts`)
 *   dynamic  — hydrated at runtime (today: OpenRouter `/api/v1/models`)
 *
 * `all` dedupes: if a curated and a dynamic entry share the same
 * `providerModelId` under the same `providerId`, the dynamic one wins
 * (its data is fresher — pricing, context length, current name).
 *
 * No persistence here. Caching of dynamic entries is the loader's job.
 */
export class ModelRegistry {
  curated: readonly Model[] = CURATED;
  dynamic: Model[] = [];

  constructor() {
    makeAutoObservable(this, {
      all: computed,
      byVendor: computed,
    });
  }

  get all(): Model[] {
    const seen = new Set<string>();
    const out: Model[] = [];
    for (const m of this.dynamic) {
      const key = `${m.providerId}::${m.providerModelId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(m);
    }
    for (const m of this.curated) {
      const key = `${m.providerId}::${m.providerModelId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(m);
    }
    return out;
  }

  findById(id: string | undefined): Model | undefined {
    if (!id) return undefined;
    const direct = this.all.find(m => m.id === id);
    if (direct) return direct;

    const curated = this.curated.find(m => m.id === id);
    if (!curated) return undefined;
    const hydrated = this.dynamic.find(m =>
      m.providerId === curated.providerId
      && m.providerModelId === curated.providerModelId
    );
    return hydrated ? { ...curated, ...hydrated, id: curated.id } : curated;
  }

  byProvider(): Record<ProviderId, Model[]> {
    const out: Record<ProviderId, Model[]> = {
      openrouter: [],
      ollama: [],
      'local-image': [],
    };
    for (const m of this.all) out[m.providerId].push(m);
    return out;
  }

  dynamicForProvider(providerId: ProviderId): Model[] {
    return this.dynamic.filter(m => m.providerId === providerId);
  }

  get byVendor(): Map<string, Model[]> {
    const out = new Map<string, Model[]>();
    for (const m of this.all) {
      const arr = out.get(m.vendor) ?? [];
      arr.push(m);
      out.set(m.vendor, arr);
    }
    return out;
  }

  setDynamicForProvider(providerId: ProviderId, models: Model[]): void {
    const kept = this.dynamic.filter(m => m.providerId !== providerId);
    this.dynamic = [...kept, ...models];
  }

  clearDynamicForProvider(providerId: ProviderId): void {
    this.dynamic = this.dynamic.filter(m => m.providerId !== providerId);
  }
}

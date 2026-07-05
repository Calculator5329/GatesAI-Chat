import type { Model } from '../../core/types';
import { DEFAULT_MODEL_ID, DEFAULT_OPENROUTER_CATALOG_MODEL_IDS } from '../../core/models';
import {
  availableSources,
  isModelAvailable,
  type RuntimeAvailability,
} from '../../core/modelPickerAvailability';
import {
  buildPickerSections,
  limitModelSections,
  type CapabilityFilter,
  type PickerSection,
  type SourceFilter,
} from '../../core/modelPicker';

export interface ModelSectionRegistry {
  readonly all: readonly Model[];
  findById(id: string | undefined): Model | undefined;
}

export interface ModelSectionFilters {
  currentModelId: string | undefined;
  defaultModelId?: string;
  source: SourceFilter;
  caps: ReadonlySet<CapabilityFilter>;
  recentIds: readonly string[];
  runtime: RuntimeAvailability;
}

export interface ComputedModelSections {
  sourceTabs: SourceFilter[];
  effectiveSource: SourceFilter;
  sections: PickerSection[];
  displaySections: PickerSection[];
  flat: Model[];
  flatIndexById: Map<string, number>;
  favoriteSet: Set<string>;
  defaultModelId: string;
  totalMatching: number;
  hiddenCount: number;
}

export function computeModelSections(
  registry: ModelSectionRegistry,
  query: string,
  filters: ModelSectionFilters,
  favorites: readonly string[],
): ComputedModelSections {
  const sourceTabs = availableSources(filters.runtime);
  const effectiveSource: SourceFilter = sourceTabs.includes(filters.source) ? filters.source : 'auto';
  const registryAll = registry.all;
  const defaultModelId = filters.defaultModelId ?? DEFAULT_MODEL_ID;
  const all = registryAll.filter(model => isModelAvailable(model, filters.runtime));
  const currentModel = registry.findById(filters.currentModelId);
  const recommendableCurrent = currentModel && isModelAvailable(currentModel, filters.runtime)
    ? currentModel
    : undefined;

  const byId = new Map(registryAll.map(model => [model.id, model]));
  const favoriteModels = favorites
    .map(id => byId.get(id) ?? registry.findById(id))
    .filter((model): model is Model => Boolean(model))
    .filter(model => isModelAvailable(model, filters.runtime));

  const verifiedModels = DEFAULT_OPENROUTER_CATALOG_MODEL_IDS
    .map(id => registry.findById(id))
    .filter((model): model is Model => Boolean(model))
    .filter(model => isModelAvailable(model, filters.runtime));

  const sections = buildPickerSections({
    all,
    verifiedModels,
    currentModel: recommendableCurrent,
    query,
    caps: filters.caps,
    source: effectiveSource,
    recentIds: [...filters.recentIds],
    favoriteModels,
  });
  const displaySections = limitModelSections(sections, query);
  const flat = displaySections.flatMap(section => section.models);
  const flatIndexById = new Map(flat.map((model, index) => [model.id, index]));
  const totalMatching = sections.reduce((sum, section) => sum + section.models.length, 0);

  return {
    sourceTabs,
    effectiveSource,
    sections,
    displaySections,
    flat,
    flatIndexById,
    favoriteSet: new Set(favorites),
    defaultModelId,
    totalMatching,
    hiddenCount: totalMatching - flat.length,
  };
}

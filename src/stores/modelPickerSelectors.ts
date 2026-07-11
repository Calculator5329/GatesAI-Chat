import type { Model } from '../core/types';
import { DEFAULT_MODEL_ID, DEFAULT_OPENROUTER_CATALOG_MODEL_IDS } from '../core/models';
import {
  availableSources,
  isModelAvailable,
  type RuntimeAvailability,
} from '../core/modelPickerAvailability';
import {
  buildPickerSections,
  limitModelSections,
  type CapabilityFilter,
  type PickerSection,
  type SourceFilter,
} from '../core/modelPicker';

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

interface SelectorArgs {
  registry: ModelSectionRegistry;
  query: string;
  filters: ModelSectionFilters;
  favorites: readonly string[];
}

/**
 * Creates a picker selector whose result is stable while its inputs are
 * stable. The popover changes several independent UI states (hover, focus,
 * and active row); keeping this cache here prevents those renders from
 * rebuilding the arrays consumed by memoized ModelRow children.
 */
export function createModelSectionsSelector(): (args: SelectorArgs) => ComputedModelSections {
  let previous: SelectorArgs | undefined;
  let result: ComputedModelSections | undefined;

  return (args: SelectorArgs): ComputedModelSections => {
    if (result && previous && sameSelectorArgs(previous, args)) return result;
    previous = args;
    result = computeModelSectionsFromArgs(args);
    return result;
  };
}

function sameSelectorArgs(previous: SelectorArgs, next: SelectorArgs): boolean {
  const previousFilters = previous.filters;
  const nextFilters = next.filters;
  // The component intentionally creates a small registry adapter inline;
  // its observable `all` snapshot is the identity-bearing input here.
  return previous.registry.all === next.registry.all
    && previous.query === next.query
    && previous.favorites === next.favorites
    && previousFilters.currentModelId === nextFilters.currentModelId
    && previousFilters.defaultModelId === nextFilters.defaultModelId
    && previousFilters.source === nextFilters.source
    && previousFilters.caps === nextFilters.caps
    && previousFilters.recentIds === nextFilters.recentIds
    && previousFilters.runtime.webLite === nextFilters.runtime.webLite
    && previousFilters.runtime.ollamaOnline === nextFilters.runtime.ollamaOnline
    && previousFilters.runtime.comfyReady === nextFilters.runtime.comfyReady
    && previousFilters.runtime.openAiCompatAvailable === nextFilters.runtime.openAiCompatAvailable;
}

function computeModelSectionsFromArgs(args: SelectorArgs): ComputedModelSections {
  const { registry, query, filters, favorites } = args;
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

// Kept as a pure entry point for selector tests and callers that do not need
// cross-render caching.
export function computeModelSections(
  registry: ModelSectionRegistry,
  query: string,
  filters: ModelSectionFilters,
  favorites: readonly string[],
): ComputedModelSections {
  return computeModelSectionsFromArgs({ registry, query, filters, favorites });
}

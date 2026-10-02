// Pure model-picker domain logic: section building, filtering, badges, and
// display copy. Extracted from components/editorial/ModelPopover so the popover
// is presentation-only (and lazy-loadable) while this logic stays unit-testable
// without React. Depends only on core types/capabilities — no MobX, no UI.
import type { Model } from './types';
import { modelSupportsVision } from './modelCapabilities';
import type { ModelPickerSource } from './modelPickerAvailability';
import { bestLocalModel } from './defaultModel';
import { localModelMaxContextLength, localModelMetaFor } from './localModelMeta';

export type SourceFilter = ModelPickerSource;
export type CapabilityFilter = 'vision' | 'tools' | 'reasoning' | 'fast' | 'free';

export const CAPABILITY_FILTERS: ReadonlyArray<{ id: CapabilityFilter; label: string }> = [
  { id: 'vision', label: 'vision' },
  { id: 'tools', label: 'tools' },
  { id: 'reasoning', label: 'reasoning' },
  { id: 'fast', label: 'fast' },
  { id: 'free', label: 'free' },
];

export const VERIFIED_SECTION_TITLE = 'Verified';

export interface ModelMeta {
  tag: string;
  capabilities: Array<'vision' | 'reasoning' | 'fast' | 'tools'>;
  costLabel?: '$' | '$$' | '$$$' | 'LOCAL' | 'CLOUD' | 'FREE';
}

export interface PickerSection {
  title: string;
  models: Model[];
  favorite?: boolean;
}

export interface ModelBadge {
  label: string;
  tone?: 'muted' | 'accent' | 'warn';
  title?: string;
  icon?: 'vision' | 'tools';
}

const BROWSE_SECTION_LIMIT = 8;
const SEARCH_RESULT_LIMIT = 80;

export const AUTO_MODEL: Model = {
  id: 'auto-gemini-3-flash',
  name: 'Auto',
  vendor: 'Recommended',
  providerId: 'openrouter',
  providerModelId: '~google/gemini-flash-latest',
  description: 'best available chat model',
  supportsVision: true,
};

const META: Record<string, ModelMeta> = {
  'auto-gemini-3-flash': { tag: 'best available chat model', capabilities: ['vision', 'tools', 'fast'] },
  'or-gemini-3-flash': { tag: 'latest Gemini Flash, vision, reliable tools', capabilities: ['vision', 'tools', 'fast'], costLabel: '$' },
  'or-gemini-3.8-flash': { tag: 'newest Gemini Flash, vision, reliable tools', capabilities: ['vision', 'tools', 'fast'], costLabel: '$' },
  'or-gemini-3.7-flash': { tag: 'prior Gemini Flash', capabilities: ['vision', 'tools', 'fast'], costLabel: '$' },
  'or-gemini-3.5-flash-lite': { tag: 'cheapest Gemini, vision', capabilities: ['vision', 'tools', 'fast'], costLabel: '$' },
  'or-gpt-6-astra': { tag: 'OpenAI frontier reasoning and agents', capabilities: ['vision', 'tools', 'reasoning'], costLabel: '$$$' },
  'or-gpt-6-astra-pro': { tag: 'deeper-thinking Astra', capabilities: ['vision', 'tools', 'reasoning'], costLabel: '$$$' },
  'or-gpt-6-sol': { tag: 'OpenAI coding and agent workhorse', capabilities: ['vision', 'tools', 'reasoning'], costLabel: '$$' },
  'or-gpt-6-sol-pro': { tag: 'pro-reasoning Sol', capabilities: ['vision', 'tools', 'reasoning'], costLabel: '$$' },
  'or-gpt-6-luna': { tag: 'fast lowest-cost OpenAI chat', capabilities: ['vision', 'tools', 'fast'], costLabel: '$' },
  'or-gpt-6-luna-pro': { tag: 'pro-reasoning Luna', capabilities: ['vision', 'tools', 'reasoning'], costLabel: '$' },
  'or-gpt-5.6-sol': { tag: 'prior OpenAI Sol', capabilities: ['vision', 'tools', 'reasoning'], costLabel: '$$' },
  'or-gpt-5.6-sol-pro': { tag: 'prior longer-thinking Sol', capabilities: ['vision', 'tools', 'reasoning'], costLabel: '$$$' },
  'or-gpt-5.6-terra': { tag: 'OpenAI writing and vision generalist', capabilities: ['vision', 'tools', 'reasoning'], costLabel: '$$' },
  'or-gpt-5.6-luna': { tag: 'prior fast OpenAI chat', capabilities: ['vision', 'tools', 'fast'], costLabel: '$' },
  'or-gpt-astra-latest': { tag: 'latest OpenAI Astra', capabilities: ['vision', 'tools', 'reasoning'], costLabel: '$$$' },
  'or-gpt-sol-latest': { tag: 'latest OpenAI Sol', capabilities: ['vision', 'tools', 'reasoning'], costLabel: '$$' },
  'or-gpt-terra-latest': { tag: 'latest OpenAI Terra', capabilities: ['vision', 'tools', 'reasoning'], costLabel: '$$' },
  'or-gpt-luna-latest': { tag: 'latest OpenAI Luna', capabilities: ['vision', 'tools', 'fast'], costLabel: '$' },
  'or-claude-fable-5.1': { tag: 'Anthropic frontier reasoning and agents', capabilities: ['vision', 'tools', 'reasoning'], costLabel: '$$$' },
  'or-claude-fable-5': { tag: 'prior Claude Fable', capabilities: ['vision', 'tools', 'reasoning'], costLabel: '$$$' },
  'or-claude-fable-latest': { tag: 'latest Claude Fable', capabilities: ['vision', 'tools', 'reasoning'], costLabel: '$$$' },
  'or-claude-opus-5.5': { tag: 'Claude flagship for coding and agents', capabilities: ['vision', 'tools', 'reasoning'], costLabel: '$$$' },
  'or-claude-opus-5': { tag: 'prior Claude Opus', capabilities: ['vision', 'tools', 'reasoning'], costLabel: '$$$' },
  'or-claude-sonnet-5.5': { tag: 'balanced Claude coding and writing', capabilities: ['vision', 'tools', 'reasoning'], costLabel: '$$' },
  'or-claude-sonnet-5': { tag: 'prior Claude Sonnet', capabilities: ['vision', 'tools', 'reasoning'], costLabel: '$$' },
  'or-grok-4.7': { tag: 'xAI flagship coding and agents', capabilities: ['vision', 'tools', 'reasoning'], costLabel: '$$' },
  'or-grok-4.6': { tag: 'prior xAI reasoning', capabilities: ['vision', 'tools', 'reasoning'], costLabel: '$$' },
  'or-grok-4.5': { tag: 'older xAI reasoning', capabilities: ['vision', 'tools', 'reasoning'], costLabel: '$$' },
  'or-deepseek-v4.1-flash': { tag: 'fast low-cost DeepSeek with vision', capabilities: ['vision', 'tools', 'fast'], costLabel: '$' },
  'or-deepseek-v4-pro-0813': { tag: 'latest DeepSeek reasoning', capabilities: ['tools', 'reasoning'], costLabel: '$' },
  'or-kimi-k3': { tag: 'Moonshot flagship agents', capabilities: ['vision', 'tools', 'reasoning'], costLabel: '$$' },
  'or-kimi-k2.7-code': { tag: 'Moonshot coding model', capabilities: ['vision', 'tools'], costLabel: '$' },
  'or-nemotron-3.5-lightning': { tag: 'fast open-weight tool loops', capabilities: ['tools', 'fast'], costLabel: '$' },
  'or-nemotron-3.5-lightning-free': { tag: 'free fast open-weight tool loops', capabilities: ['tools', 'fast'], costLabel: 'FREE' },
  'or-nemotron-3-nano-omni-free': { tag: 'free open-weight audio, image and video input', capabilities: ['vision', 'tools', 'reasoning'], costLabel: 'FREE' },
  'or-qwen3.8-max': { tag: 'Alibaba flagship, vision and video', capabilities: ['vision', 'tools', 'reasoning'], costLabel: '$$' },
  'or-qwen3.8-flash': { tag: 'fast low-cost Qwen', capabilities: ['vision', 'tools', 'fast'], costLabel: '$' },
  'or-glm-5.3': { tag: 'Z.ai open-weight coding and agents', capabilities: ['tools', 'reasoning'], costLabel: '$' },
  'or-glm-5.3-flash': { tag: 'fast low-cost GLM', capabilities: ['vision', 'tools', 'fast'], costLabel: '$' },
  'or-minimax-m3': { tag: 'MiniMax agents, vision and video', capabilities: ['vision', 'tools', 'reasoning'], costLabel: '$' },
  'or-mistral-medium-3.5': { tag: 'Mistral coding and multilingual', capabilities: ['vision', 'tools'], costLabel: '$$' },
  'or-deepseek-v4-flash': { tag: 'fast low-cost reasoning', capabilities: ['fast', 'reasoning'], costLabel: '$' },
  'or-gpt-5.5': { tag: 'strong API tools and reasoning', capabilities: ['vision', 'tools', 'reasoning'], costLabel: '$$' },
  'or-claude-opus-4.7': { tag: 'older Claude Opus', capabilities: ['vision', 'tools', 'reasoning'], costLabel: '$$$' },
  'or-claude-sonnet-4.7': { tag: 'latest Claude Sonnet coding and agents', capabilities: ['vision', 'tools', 'reasoning'], costLabel: '$$' },
  'or-claude-haiku-4.6': { tag: 'latest fast Claude agent model', capabilities: ['vision', 'tools', 'fast'], costLabel: '$' },
  'or-claude-opus-latest': { tag: 'latest premium Claude reasoning', capabilities: ['vision', 'tools', 'reasoning'], costLabel: '$$$' },
  'or-gemini-3.1-pro': { tag: 'preview API reasoning and vision', capabilities: ['vision', 'tools', 'reasoning'], costLabel: '$$' },
  'image-direct-comfy': { tag: 'local ComfyUI image generation', capabilities: ['fast'], costLabel: 'LOCAL' },
  'or-deepseek-v4-pro': { tag: 'reasoning', capabilities: ['reasoning'] },
  'or-gpt-5.5-pro': { tag: 'premium API tools and reasoning', capabilities: ['vision', 'tools', 'reasoning'] },
  'or-gemini-3.1-flash-lite': { tag: 'fast API vision', capabilities: ['vision', 'fast'], costLabel: '$' },
  'or-nemotron-3-ultra': { tag: 'open-weight frontier reasoning', capabilities: ['tools', 'reasoning'], costLabel: '$' },
  'or-nemotron-3-ultra-free': { tag: 'default chat, free open-weight frontier reasoning', capabilities: ['tools', 'reasoning'], costLabel: 'FREE' },
  'or-nemotron-3-super': { tag: 'open-weight efficient MoE reasoning', capabilities: ['tools', 'reasoning', 'fast'], costLabel: '$' },
  'or-nemotron-3-super-free': { tag: 'free open-weight efficient MoE', capabilities: ['tools', 'reasoning', 'fast'], costLabel: 'FREE' },
  'or-nemotron-3-nano-free': { tag: 'low-cost open-weight 30B/3B active MoE', capabilities: ['tools', 'fast'], costLabel: '$' },
  'or-nemotron-3.5-content-safety': { tag: 'guardrail moderation model', capabilities: [], costLabel: '$' },
};

const META_BY_PROVIDER_MODEL_ID: Record<string, ModelMeta> = {
  '~google/gemini-flash-latest': META['or-gemini-3-flash'],
  'google/gemini-3.8-flash': META['or-gemini-3.8-flash'],
  'openai/gpt-6-astra': META['or-gpt-6-astra'],
  'openai/gpt-6-sol': META['or-gpt-6-sol'],
  'openai/gpt-6-luna': META['or-gpt-6-luna'],
  'openai/gpt-5.6-sol': META['or-gpt-5.6-sol'],
  'anthropic/claude-fable-5.1': META['or-claude-fable-5.1'],
  'anthropic/claude-opus-5.5': META['or-claude-opus-5.5'],
  'anthropic/claude-opus-5': META['or-claude-opus-5'],
  'anthropic/claude-sonnet-5.5': META['or-claude-sonnet-5.5'],
  'anthropic/claude-sonnet-5': META['or-claude-sonnet-5'],
  'x-ai/grok-4.7': META['or-grok-4.7'],
  'deepseek/deepseek-v4-flash': META['or-deepseek-v4-flash'],
  'openai/gpt-5.5': META['or-gpt-5.5'],
  '~anthropic/claude-opus-latest': META['or-claude-opus-latest'],
  '~anthropic/claude-sonnet-latest': META['or-claude-sonnet-4.7'],
  'google/gemini-3.1-pro-preview': META['or-gemini-3.1-pro'],
  'nvidia/nemotron-3-ultra-550b-a55b': META['or-nemotron-3-ultra'],
  'nvidia/nemotron-3-ultra-550b-a55b:free': META['or-nemotron-3-ultra-free'],
  'nvidia/nemotron-3-super-120b-a12b': META['or-nemotron-3-super'],
  'nvidia/nemotron-3-super-120b-a12b:free': META['or-nemotron-3-super-free'],
  'nvidia/nemotron-3-nano-30b-a3b': META['or-nemotron-3-nano-free'],
  'nvidia/nemotron-3.5-lightning:free': META['or-nemotron-3.5-lightning-free'],
  'nvidia/nemotron-3.5-content-safety:free': META['or-nemotron-3.5-content-safety'],
  'comfy-direct': META['image-direct-comfy'],
};

export function metaFor(model: Model): ModelMeta | null {
  const localMeta = localModelMetaFor(model);
  if (localMeta) {
    return {
      tag: localMeta.tag,
      capabilities: localMeta.capabilities,
      costLabel: localMeta.costLabel,
    };
  }
  return META[model.id] ?? META_BY_PROVIDER_MODEL_ID[model.providerModelId] ?? null;
}

// Keeps picker order stable: recommended/current choices first, then verified,
// recents, and the source browse list last, because keyboard navigation
// assumes rows do not jump while local runtimes or catalog refreshes update in
// the background. Each model gets one row, in the first section that lists it
// (see removeDuplicateRowsAcrossSections); Favorites is the only repeat.
export function buildPickerSections(args: {
  all: readonly Model[];
  verifiedModels: readonly Model[];
  currentModel: Model | undefined;
  query: string;
  caps: ReadonlySet<CapabilityFilter>;
  source: SourceFilter;
  /** Recent picks, newest first, resolved by the caller like favorites. */
  recentModels: readonly Model[];
  favoriteModels: readonly Model[];
}): PickerSection[] {
  const normalizedQuery = args.query.trim().toLowerCase();
  const matches = (model: Model): boolean =>
    (!normalizedQuery || matchesQuery(model, normalizedQuery)) && matchesCaps(model, args.caps);
  const sourceModels = args.all.filter(model => sourceMatches(model, args.source));
  const base = normalizedQuery ? args.all.filter(matches) : sourceModels.filter(matches);
  const sections: PickerSection[] = [];

  // User-pinned favorites lead the list in every source/search view (filtered
  // by the active source unless browsing "auto"), mirroring the recents pattern.
  const favorites = dedupeModels([...args.favoriteModels])
    .filter(model => args.source === 'auto' || sourceMatches(model, args.source))
    .filter(matches);
  const pushFavorites = (): void => {
    if (favorites.length) sections.push({ title: 'Favorites', models: favorites });
  };
  // The curated, live-verified catalog. Featured prominently because it's what
  // gets used the overwhelming majority of the time. Resolved by the caller
  // (via the registry) so live-superseded curated entries are still included.
  const verified = dedupeModels([...args.verifiedModels])
    .filter(model => sourceMatches(model, args.source))
    .filter(matches);

  const rawRecommended = dedupeModels([
    AUTO_MODEL,
    ...(args.currentModel ? [args.currentModel] : []),
    bestLocalModel(args.all.filter(model => model.providerId === 'ollama')),
  ]).filter(matches);
  const recommended = args.source === 'auto'
    ? rawRecommended
    : rawRecommended.filter(model => sourceMatches(model, args.source));

  pushFavorites();

  if (args.source === 'auto' && recommended.length) {
    sections.push({ title: 'Recommended', models: recommended, favorite: true });
    if (verified.length) sections.push({ title: VERIFIED_SECTION_TITLE, models: verified, favorite: true });
    const recent = dedupeModels([...args.recentModels]).filter(matches);
    if (recent.length) sections.push({ title: 'Recent', models: recent });
    return removeDuplicateRowsAcrossSections(sections);
  }

  if (!normalizedQuery && recommended.length) {
    sections.push({ title: 'Recommended', models: recommended, favorite: true });
  }

  if (verified.length && (args.source === 'cloud' || args.source === 'auto')) {
    sections.push({ title: VERIFIED_SECTION_TITLE, models: verified, favorite: true });
  }

  // Recent sits above the browse list so a pick past the browse limit keeps its
  // row; the browse list then skips it along with the verified models.
  const recent = dedupeModels([...args.recentModels])
    .filter(model => sourceMatches(model, args.source))
    .filter(matches);
  if (recent.length) sections.push({ title: 'Recent', models: recent });

  const sourceSectionModels = base.filter(model => sourceMatches(model, args.source));
  if (sourceSectionModels.length) {
    sections.push({ title: titleForSource(args.source), models: sourceSectionModels });
  }

  return removeDuplicateRowsAcrossSections(sections);
}

function sourceMatches(model: Model, source: SourceFilter): boolean {
  if (source === 'auto') return true;
  if (source === 'cloud') return model.providerId === 'openrouter';
  if (source === 'local') return model.providerId === 'ollama';
  return model.providerId === 'local-image';
}

function titleForSource(source: SourceFilter): string {
  if (source === 'cloud') return 'Cloud';
  if (source === 'local') return 'Local';
  if (source === 'image') return 'Image';
  return 'Recommended';
}

function matchesQuery(model: Model, normalizedQuery: string): boolean {
  return (
    model.name.toLowerCase().includes(normalizedQuery) ||
    model.vendor.toLowerCase().includes(normalizedQuery) ||
    model.id.toLowerCase().includes(normalizedQuery) ||
    model.providerModelId.toLowerCase().includes(normalizedQuery)
  );
}

function dedupeModels(models: Array<Model | undefined>): Model[] {
  const seen = new Set<string>();
  const out: Model[] = [];
  for (const model of models) {
    if (!model || seen.has(model.id)) continue;
    seen.add(model.id);
    out.push(model);
  }
  return out;
}

// A model is its route: a curated entry, its live-catalog twin (`or-live-*`)
// and legacy alias ids that keep old threads working all send the same
// providerModelId, so they share one row. Auto shares Gemini Flash's route but
// is a routing choice with its own row. Favorites is a pinned shortcut shelf
// that repeats rows by design (its rows carry their own test ids), so it
// neither claims nor loses rows.
function rowKey(model: Model): string {
  return model.id === AUTO_MODEL.id ? model.id : `${model.providerId}::${model.providerModelId}`;
}

function removeDuplicateRowsAcrossSections(sections: PickerSection[]): PickerSection[] {
  const seen = new Set<string>();
  return sections.map(section => {
    if (section.title === 'Favorites') return section;
    const models = section.models.filter(model => {
      const key = rowKey(model);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { ...section, models };
  }).filter(section => section.models.length > 0);
}

export function limitModelSections(sections: PickerSection[], query: string): PickerSection[] {
  const searching = query.trim().length > 0;
  if (searching) {
    let remaining = SEARCH_RESULT_LIMIT;
    const limited: PickerSection[] = [];
    for (const section of sections) {
      if (remaining <= 0) break;
      const models = section.models.slice(0, remaining);
      if (models.length) limited.push({ ...section, models });
      remaining -= models.length;
    }
    return limited;
  }

  return sections
    .map(section => ({
      ...section,
      models: section.favorite || section.title === VERIFIED_SECTION_TITLE || section.title === 'Favorites'
        ? section.models
        : section.models.slice(0, BROWSE_SECTION_LIMIT),
    }))
    .filter(section => section.models.length > 0);
}

/** Local runtimes have no per-token cost; cloud models are free only at $0. */
function isFreeModel(model: Model): boolean {
  if (model.providerId !== 'openrouter') return true;
  const pricing = model.pricing;
  if (!pricing) return false;
  return (pricing.prompt ?? 0) === 0 && (pricing.completion ?? 0) === 0;
}

function modelHasCapability(model: Model, cap: CapabilityFilter): boolean {
  switch (cap) {
    case 'vision':
      return modelSupportsVision(model);
    case 'tools':
      return model.providerId !== 'local-image' && model.supportsTools !== false;
    case 'reasoning':
      return metaFor(model)?.capabilities.includes('reasoning') ?? false;
    case 'fast':
      return metaFor(model)?.capabilities.includes('fast') ?? false;
    case 'free':
      return isFreeModel(model);
  }
}

function matchesCaps(model: Model, caps: ReadonlySet<CapabilityFilter>): boolean {
  for (const cap of caps) {
    if (!modelHasCapability(model, cap)) return false;
  }
  return true;
}

export function emptyStateMessage(query: string, hasCapFilters: boolean, source: SourceFilter): string {
  const trimmed = query.trim();
  if (trimmed && hasCapFilters) return `No models match "${trimmed}" with the selected capability filters.`;
  if (trimmed) return `No models match "${trimmed}".`;
  if (hasCapFilters) return 'No models match the selected capability filters.';
  if (source === 'local') return 'No local models yet. Start Ollama, or download a model from Settings > Models > Local.';
  if (source === 'image') return 'No image models available. Start ComfyUI or ComfyUI Desktop and GatesAI finds it.';
  return 'No models available.';
}

export function bestForLine(model: Model, meta: ModelMeta | null): string {
  if (model.description) return model.description;
  if (model.providerId === 'ollama') {
    const tools = model.supportsTools === false ? 'tools off' : 'tools ready';
    return `${meta?.tag ?? 'private local chat'}; ${tools}`;
  }
  if (meta?.tag) return meta.tag;
  if (model.providerId === 'local-image') return 'local ComfyUI image generation';
  return describeDynamic(model);
}

// Every row reaching the picker passed `isModelAvailable`, so local models are
// always online by construction — the picker hides offline Ollama/ComfyUI
// entirely rather than rendering a disabled/"offline" row. The "online" badge
// is kept as a positive "this is live" cue.
export function badgesForModel(model: Model): ModelBadge[] {
  const meta = metaFor(model);
  const badges: ModelBadge[] = [];
  if (model.id === AUTO_MODEL.id) badges.push({ label: 'AUTO', tone: 'accent' });
  else if (model.providerId === 'ollama') {
    badges.push(meta?.costLabel === 'CLOUD'
      ? { label: 'CLOUD', title: 'Listed by your Ollama server; runs on Ollama\'s cloud' }
      : { label: 'LOCAL', title: 'Local endpoint; no cloud token cost' });
  }
  else if (model.providerId === 'local-image') badges.push({ label: 'IMAGE' });

  if (model.providerId === 'ollama') {
    badges.push({ label: 'online', tone: 'accent' });
    if (meta?.capabilities.includes('tools')) badges.push({ label: 'tools', icon: 'tools', title: 'Tools' });
    if (meta?.capabilities.includes('vision')) badges.push({ label: 'vision', icon: 'vision', title: 'Vision' });
    if (meta?.capabilities.includes('reasoning')) badges.push({ label: 'reasoning', title: 'Reasoning' });
    if (meta?.capabilities.includes('fast')) badges.push({ label: 'fast', title: 'Fast' });
    const maxCtx = formatContext(localModelMaxContextLength(model));
    if (maxCtx) badges.push({ label: `up to ${maxCtx}`, title: 'Most context this model supports; Ollama runs a smaller window unless configured' });
  } else if (model.providerId === 'local-image') {
    badges.push({ label: 'online', tone: 'accent' });
  } else {
    if (modelSupportsVision(model)) badges.push({ label: 'vision', icon: 'vision', title: 'Vision' });
    if (model.supportsTools !== false) badges.push({ label: 'tools', icon: 'tools', title: 'Tools' });
    const ctx = formatContext(model.contextLength ?? model.contextWindow);
    if (ctx) badges.push({ label: ctx, title: 'Context window' });
  }

  if (meta?.costLabel && !badges.some(badge => badge.label === meta.costLabel)) {
    badges.push({ label: meta.costLabel, tone: meta.costLabel === '$$$' ? 'warn' : 'muted', title: 'Relative cost' });
  }
  return badges.slice(0, 6);
}

function formatContext(tokens: number | undefined): string | undefined {
  if (!tokens || tokens <= 0) return undefined;
  if (tokens >= 1_000_000) return `${Math.round(tokens / 1_000_000)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return `${tokens}`;
}

function describeDynamic(model: Model): string {
  const bits: string[] = [];
  if (model.pricing?.prompt != null && model.pricing.completion != null) {
    bits.push(`$${formatPrice(model.pricing.prompt)} / $${formatPrice(model.pricing.completion)} per 1M`);
  } else if (model.pricing?.prompt != null) {
    bits.push(`$${formatPrice(model.pricing.prompt)} / 1M in`);
  }
  if (bits.length === 0) return model.providerModelId;
  return bits.join(' - ');
}

function formatPrice(usdPerMillion: number): string {
  if (usdPerMillion === 0) return '0';
  return usdPerMillion.toFixed(2);
}

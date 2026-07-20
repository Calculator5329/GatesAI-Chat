import type { OpenRouterCatalogModel } from './catalog';

export interface CompatibilityFamilyResult {
  id: string;
  label: string;
  selection: 'all-since-floor' | 'recent';
  models: OpenRouterCatalogModel[];
}

export interface CompatibilityCatalogAudit {
  passed: boolean;
  auditedAt: string;
  selected: OpenRouterCatalogModel[];
  families: CompatibilityFamilyResult[];
  errors: string[];
  notices: string[];
}

interface FamilyPolicy {
  id: string;
  label: string;
  selection: CompatibilityFamilyResult['selection'];
  minimumCount: number;
  recentCount?: number;
  matches(model: OpenRouterCatalogModel, catalog: OpenRouterCatalogModel[]): boolean;
}

export const CURSOR_COMPAT_NOTICE = [
  'Cursor Composer is intentionally not probed: Cursor does not expose its in-house models',
  'through OpenRouter, and GatesAI supports only OpenRouter, Ollama, and ComfyUI routes.',
].join(' ');

const FAMILY_POLICIES: FamilyPolicy[] = [
  {
    id: 'claude-sonnet-4-plus',
    label: 'Every active Claude released since Sonnet 4',
    selection: 'all-since-floor',
    minimumCount: 2,
    matches: (model, catalog) => {
      const floor = catalog.find(item => item.id === 'anthropic/claude-sonnet-4')?.created;
      return model.id.startsWith('anthropic/claude-') && floor != null && model.created >= floor;
    },
  },
  {
    id: 'gemini-2-plus',
    label: 'Every active Gemini 2.x and newer text route',
    selection: 'all-since-floor',
    minimumCount: 2,
    matches: model => /^google\/gemini-(?:[2-9]|[1-9]\d)(?:[.-]|$)/.test(model.id),
  },
  {
    id: 'openai-gpt-5-plus',
    label: 'Every active OpenAI GPT-5 family text route',
    selection: 'all-since-floor',
    minimumCount: 2,
    matches: model => model.id.startsWith('openai/gpt-5'),
  },
  recent('meta-recent', 'Recent Meta models', model => (
    model.id.startsWith('meta/') || model.id.startsWith('meta-llama/')
  )),
  recent('grok-recent', 'Recent Grok models', model => model.id.startsWith('x-ai/grok-')),
  recent('kimi-k2-recent', 'Recent Kimi K2 models', model => model.id.startsWith('moonshotai/kimi-k2')),
  recent('glm-recent', 'Recent GLM models', model => model.id.startsWith('z-ai/glm-')),
  recent('nemotron-recent', 'Recent Nemotron models', model => model.id.includes('/nemotron-')),
  recent('deepseek-recent', 'Recent DeepSeek models', model => model.id.startsWith('deepseek/')),
];

export function auditCompatibilityCatalog(
  catalog: OpenRouterCatalogModel[],
  now = new Date(),
): CompatibilityCatalogAudit {
  const eligible = catalog
    .filter(model => isEligibleTextRoute(model, now))
    .filter(model => !isRedundantVariant(model, catalog));
  const errors: string[] = [];
  const families = FAMILY_POLICIES.map(policy => {
    const matches = eligible
      .filter(model => policy.matches(model, eligible))
      .sort((left, right) => right.created - left.created || left.id.localeCompare(right.id));
    const models = policy.selection === 'recent'
      ? matches.slice(0, policy.recentCount)
      : matches;
    if (models.length < policy.minimumCount) {
      errors.push(`${policy.label} selected ${models.length}; policy requires at least ${policy.minimumCount}.`);
    }
    return { id: policy.id, label: policy.label, selection: policy.selection, models };
  });
  const selected = uniqueModels(families.flatMap(family => family.models));

  return {
    passed: errors.length === 0,
    auditedAt: now.toISOString(),
    selected,
    families,
    errors,
    notices: [CURSOR_COMPAT_NOTICE],
  };
}

export function modelSupportsTools(model: OpenRouterCatalogModel): boolean {
  return model.supported_parameters?.includes('tools') === true;
}

function recent(
  id: string,
  label: string,
  matches: FamilyPolicy['matches'],
): FamilyPolicy {
  return { id, label, selection: 'recent', minimumCount: 2, recentCount: 3, matches };
}

function isEligibleTextRoute(model: OpenRouterCatalogModel, now: Date): boolean {
  if (model.id.startsWith('~')) return false;
  if (model.architecture?.output_modalities && !model.architecture.output_modalities.includes('text')) return false;
  if (/(?:^|[-/])(image|guard|safety|moderation|embedding|rerank)(?:[-/:]|$)/.test(model.id)) return false;
  if (model.expiration_date) {
    const expiry = Date.parse(model.expiration_date);
    if (Number.isFinite(expiry) && expiry <= now.getTime()) return false;
  }
  return true;
}

function isRedundantVariant(model: OpenRouterCatalogModel, catalog: OpenRouterCatalogModel[]): boolean {
  if (!model.id.endsWith(':free')) return false;
  return catalog.some(candidate => candidate.id === model.id.slice(0, -':free'.length));
}

function uniqueModels(models: OpenRouterCatalogModel[]): OpenRouterCatalogModel[] {
  const seen = new Set<string>();
  return models.filter(model => {
    if (seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  }).sort((left, right) => left.id.localeCompare(right.id));
}

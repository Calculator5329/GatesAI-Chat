// Renders the editorial chat ModelPopover surface and its local interaction state.
// Called by EditorialChat, EditorialMessage, or the sidebar shell; depends on RootStore hooks, core message types, and UI primitives.
// Invariant: persisted chat state stays in stores while components derive view state from props/hooks.
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import type { Model } from '../../core/types';
import { DEFAULT_MODEL_ID, DEFAULT_OPENROUTER_CATALOG_MODEL_IDS } from '../../core/models';
import { modelSupportsVision } from '../../core/modelCapabilities';
import { Icons } from '../ui/icons';
import { useLocalRuntimeStore, useModelRegistry } from '../../stores/context';

interface ModelPopoverProps {
  currentModelId: string | undefined;
  onPick: (modelId: string) => void;
  onClose: () => void;
}

type SourceFilter = 'auto' | 'cloud' | 'local' | 'image';

interface ModelMeta {
  tag: string;
  capabilities: Array<'vision' | 'reasoning' | 'fast' | 'tools'>;
  costLabel?: '$' | '$$' | '$$$' | 'LOCAL' | 'FREE';
}

interface PickerSection {
  title: string;
  models: Model[];
  favorite?: boolean;
}

const BROWSE_SECTION_LIMIT = 8;
const SEARCH_RESULT_LIMIT = 80;

const AUTO_MODEL: Model = {
  id: 'auto-gemini-3-flash',
  name: 'Auto: Gemini 3 Flash API',
  vendor: 'Recommended',
  providerId: 'openrouter',
  providerModelId: '~google/gemini-flash-latest',
  description: 'default API chat, vision, reliable tools',
  supportsVision: true,
};

const META: Record<string, ModelMeta> = {
  'auto-gemini-3-flash': { tag: 'default API chat, vision, reliable tools', capabilities: ['vision', 'tools', 'fast'], costLabel: '$' },
  'or-gemini-3-flash': { tag: 'default API chat, vision, reliable tools', capabilities: ['vision', 'tools', 'fast'], costLabel: '$' },
  'or-deepseek-v4-flash': { tag: 'fast low-cost reasoning', capabilities: ['fast', 'reasoning'], costLabel: '$' },
  'or-gpt-5.5': { tag: 'strong API tools and reasoning', capabilities: ['vision', 'tools', 'reasoning'], costLabel: '$$' },
  'or-claude-opus-latest': { tag: 'latest premium Claude reasoning', capabilities: ['vision', 'tools', 'reasoning'], costLabel: '$$$' },
  'or-gemini-3.1-pro': { tag: 'large API reasoning and vision', capabilities: ['vision', 'tools', 'reasoning'], costLabel: '$$' },
  'image-direct-comfy': { tag: 'local ComfyUI image generation', capabilities: ['fast'], costLabel: 'LOCAL' },
  'or-deepseek-v4-pro': { tag: 'reasoning', capabilities: ['reasoning'] },
  'or-gpt-5.5-pro': { tag: 'premium API tools and reasoning', capabilities: ['vision', 'tools', 'reasoning'] },
  'or-gemini-3.1-flash-lite': { tag: 'fast API vision', capabilities: ['vision', 'fast'], costLabel: '$' },
  'or-nemotron-3-ultra': { tag: 'open-weight frontier reasoning', capabilities: ['tools', 'reasoning'], costLabel: '$' },
  'or-nemotron-3-ultra-free': { tag: 'free open-weight frontier reasoning', capabilities: ['tools', 'reasoning'], costLabel: 'FREE' },
  'or-nemotron-3-super': { tag: 'open-weight efficient MoE reasoning', capabilities: ['tools', 'reasoning', 'fast'], costLabel: '$' },
  'or-nemotron-3-super-free': { tag: 'free open-weight efficient MoE', capabilities: ['tools', 'reasoning', 'fast'], costLabel: 'FREE' },
  'or-nemotron-3-nano-free': { tag: 'free open-weight 30B/3B active MoE', capabilities: ['tools', 'fast'], costLabel: 'FREE' },
  'or-nemotron-3.5-content-safety': { tag: 'guardrail moderation model', capabilities: [], costLabel: '$' },
};

const META_BY_PROVIDER_MODEL_ID: Record<string, ModelMeta> = {
  '~google/gemini-flash-latest': META['or-gemini-3-flash'],
  'deepseek/deepseek-v4-flash': META['or-deepseek-v4-flash'],
  'openai/gpt-5.5': META['or-gpt-5.5'],
  '~anthropic/claude-opus-latest': META['or-claude-opus-latest'],
  'google/gemini-3.1-pro': META['or-gemini-3.1-pro'],
  'nvidia/nemotron-3-ultra-550b-a55b': META['or-nemotron-3-ultra'],
  'nvidia/nemotron-3-ultra-550b-a55b:free': META['or-nemotron-3-ultra-free'],
  'nvidia/nemotron-3-super-120b-a12b': META['or-nemotron-3-super'],
  'nvidia/nemotron-3-super-120b-a12b:free': META['or-nemotron-3-super-free'],
  'nvidia/nemotron-3-nano-30b-a3b:free': META['or-nemotron-3-nano-free'],
  'nvidia/nemotron-3.5-content-safety': META['or-nemotron-3.5-content-safety'],
  'comfy-direct': META['image-direct-comfy'],
};

function VendorMark({ vendor, size = 12 }: { vendor: string; size?: number }) {
  const common: CSSProperties = {
    width: size, height: size,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
    opacity: 0.85,
  };
  switch (vendor) {
    case 'Favorites':
    case 'Recommended':
    case 'Recent':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="var(--accent)" style={{ flexShrink: 0, opacity: 0.9 }}>
          <path d="M8 1.5l2 4.5 5 .5-3.8 3.3 1.2 4.7L8 12l-4.4 2.5L4.8 9.8 1 6.5l5-.5z" />
        </svg>
      );
    case 'Cloud':
    case 'OpenRouter':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: 'var(--text-dim)' }}>
          <path d="M3 12h6l3-4 3 8 3-4h3" />
        </svg>
      );
    case 'Local':
    case 'Image':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: 'var(--text-dim)' }}>
          <rect x="3" y="4" width="18" height="12" rx="1" />
          <path d="M8 20h8M12 16v4" />
        </svg>
      );
    default:
      return <span style={{ ...common, color: 'var(--text-faint)', fontSize: 10 }}>{vendor[0]}</span>;
  }
}

const SEGMENT_WRAP_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr)',
  gap: 3,
  padding: 4,
  borderBottom: '1px solid var(--border)',
  background: 'rgba(255,255,255,0.02)',
};

const SEGMENT_STYLE: CSSProperties = {
  height: 24,
  border: '1px solid transparent',
  borderRadius: 5,
  background: 'transparent',
  color: 'var(--text-faint)',
  fontFamily: '"Geist Mono", monospace',
  fontSize: 10,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  cursor: 'pointer',
};

const ROW_LEFT_STYLE: CSSProperties = { display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 };
const ROW_RIGHT_STYLE: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4, minWidth: 0, flexWrap: 'wrap' };
const STAR_ICON_STYLE: CSSProperties = { flexShrink: 0, opacity: 0.85 };
const NAME_STYLE_BASE: CSSProperties = {
  fontSize: 13,
  fontWeight: 400,
  letterSpacing: 0,
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
};
const SUBLINE_STYLE_BASE: CSSProperties = {
  gridColumn: '1 / -1',
  fontSize: 11,
  fontStyle: 'italic',
  fontFamily: '"Source Serif 4", Georgia, serif',
  lineHeight: 1.35,
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
};

function Badge({ children, tone = 'muted', title }: { children: ReactNode; tone?: 'muted' | 'accent' | 'warn'; title?: string }) {
  const color = badgeColor(tone);
  return (
    <span
      title={title}
      style={{
        border: '1px solid var(--border)',
        borderRadius: 3,
        padding: '0 4px',
        fontSize: 9,
        lineHeight: '14px',
        fontFamily: '"Geist Mono", monospace',
        letterSpacing: '0.04em',
        color,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

function IconBadge({ kind, tone = 'muted', title }: { kind: 'vision' | 'tools'; tone?: 'muted' | 'warn'; title: string }) {
  const color = badgeColor(tone);
  return (
    <span
      title={title}
      aria-label={title}
      style={{
        width: 16,
        height: 16,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color,
        opacity: 0.82,
        flex: 'none',
      }}
    >
      {kind === 'vision' ? <Icons.Eye /> : <Icons.Tool />}
    </span>
  );
}

interface RowProps {
  model: Model;
  meta: ModelMeta | null;
  selected: boolean;
  active: boolean;
  isFavorite: boolean;
  disabledReason?: string;
  ollamaOnline: boolean;
  comfyReady: boolean;
  flatIndex: number;
  onPick: (model: Model) => void;
  onToggleFavorite: (model: Model) => void;
  onHover: (index: number) => void;
}

const ModelRow = memo(function ModelRow({
  model, meta, selected, active, isFavorite, disabledReason, ollamaOnline, comfyReady, flatIndex, onPick, onToggleFavorite, onHover,
}: RowProps) {
  const disabled = !!disabledReason;
  const subline = disabledReason ?? bestForLine(model, meta);
  const rowStyle: CSSProperties = {
    position: 'relative',
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(90px, auto)',
    rowGap: 1,
    padding: '7px 14px 7px 18px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.42 : 1,
    filter: disabled ? 'grayscale(0.8)' : undefined,
    background: active && !disabled ? 'var(--panel-2)' : 'transparent',
    borderLeft: selected ? `2px solid ${disabled ? 'var(--text-faint)' : 'var(--accent)'}` : '2px solid transparent',
    transition: 'background 80ms ease',
  };
  const nameStyle: CSSProperties = {
    ...NAME_STYLE_BASE,
    color: disabled ? 'var(--text-faint)' : selected ? 'var(--text)' : 'var(--text-dim)',
  };
  const sublineStyle: CSSProperties = {
    ...SUBLINE_STYLE_BASE,
    color: disabled ? 'var(--text-dim)' : 'var(--text-faint)',
  };
  return (
    <div
      data-model-row={model.id}
      onClick={() => { if (!disabled) onPick(model); }}
      onMouseEnter={() => onHover(flatIndex)}
      aria-disabled={disabled || undefined}
      title={disabledReason}
      style={rowStyle}
    >
      <div style={ROW_LEFT_STYLE}>
        <span style={nameStyle}>{model.name}</span>
        <button
          type="button"
          className="model-popover__favorite"
          aria-label={isFavorite ? `Unfavorite ${model.name}` : `Favorite ${model.name}`}
          aria-pressed={isFavorite}
          title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(model); }}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            padding: 0, border: 'none', background: 'transparent', cursor: 'pointer',
            flexShrink: 0, lineHeight: 0,
            opacity: isFavorite ? 1 : 0.35,
          }}
        >
          <svg
            width="10" height="10" viewBox="0 0 16 16"
            fill={isFavorite ? 'var(--accent)' : 'none'}
            stroke={isFavorite ? 'var(--accent)' : 'var(--text-faint)'}
            strokeWidth="1.4"
            style={STAR_ICON_STYLE}
          >
            <path d="M8 1.5l2 4.5 5 .5-3.8 3.3 1.2 4.7L8 12l-4.4 2.5L4.8 9.8 1 6.5l5-.5z" />
          </svg>
        </button>
      </div>
      <div style={ROW_RIGHT_STYLE}>
        {badgesForModel(model, ollamaOnline, comfyReady).map(badge => (
          badge.icon
            ? <IconBadge key={badge.label} kind={badge.icon} tone={badge.tone === 'warn' ? 'warn' : 'muted'} title={badge.title ?? badge.label} />
            : <Badge key={badge.label} tone={badge.tone} title={badge.title}>{badge.label}</Badge>
        ))}
      </div>
      <div style={sublineStyle}>{subline}</div>
    </div>
  );
});

export const ModelPopover = observer(function ModelPopover({ currentModelId, onPick, onClose }: ModelPopoverProps) {
  const registry = useModelRegistry();
  const localRuntime = useLocalRuntimeStore();
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [source, setSource] = useState<SourceFilter>(() => registry.pickerSource());
  const [recentIds, setRecentIds] = useState<string[]>(() => registry.recentModelIds());
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => registry.favoriteModelIds());

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handleDocClick);
    return () => document.removeEventListener('mousedown', handleDocClick);
  }, [onClose]);

  const all = registry.all;
  const currentModel = registry.findById(currentModelId);
  const ollamaOnline = localRuntime.runtimes.ollama.status === 'online';
  const comfyReady = localRuntime.comfyReady;

  // Resolve favorites through the registry (not just the deduped `all` map): a
  // favorited id can be a curated id that a dynamic catalog entry supersedes
  // under the same providerModelId, in which case it's absent from `all` but
  // findById still resolves it via the curated fallback.
  const favoriteModels = useMemo(() => {
    const byId = new Map(all.map(model => [model.id, model]));
    return favoriteIds
      .map(id => byId.get(id) ?? registry.findById(id))
      .filter((model): model is Model => Boolean(model));
  }, [favoriteIds, registry, all]);

  const sections = useMemo(() => {
    return buildPickerSections({
      all,
      currentModel,
      query,
      source,
      recentIds,
      favoriteModels,
    });
  }, [all, currentModel, query, source, recentIds, favoriteModels]);

  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);

  const displaySections = useMemo(() => limitModelSections(sections, query), [sections, query]);
  const flat = useMemo(() => displaySections.flatMap(g => g.models), [displaySections]);
  const flatIndexById = useMemo(() => new Map(flat.map((m, index) => [m.id, index])), [flat]);
  const totalMatching = sections.reduce((sum, section) => sum + section.models.length, 0);
  const hiddenCount = totalMatching - flat.length;

  useEffect(() => {
    setActiveIdx(i => Math.min(i, Math.max(0, flat.length - 1)));
  }, [flat.length]);

  const setSourceAndPersist = (next: SourceFilter) => {
    setSource(next);
    setActiveIdx(0);
    registry.setPickerSource(next);
  };

  const pickModel = useCallback((model: Model) => {
    const resolvedId = model.id === AUTO_MODEL.id ? DEFAULT_MODEL_ID : model.id;
    setRecentIds(registry.rememberRecentModel(resolvedId));
    onPick(resolvedId);
    onClose();
  }, [registry, onClose, onPick]);
  const toggleFavorite = useCallback((model: Model) => {
    const resolvedId = model.id === AUTO_MODEL.id ? DEFAULT_MODEL_ID : model.id;
    setFavoriteIds(registry.toggleFavoriteModel(resolvedId));
  }, [registry]);
  const hoverModelAt = useCallback((index: number) => {
    setActiveIdx(index);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, Math.max(0, flat.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const activeModel = flat[activeIdx];
      if (activeModel && !disabledReasonForModel(activeModel, comfyReady)) pickModel(activeModel);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      ref={ref}
      className="model-popover"
      onKeyDown={onKeyDown}
      style={{
        position: 'absolute', bottom: 'calc(100% + 8px)', left: 0,
        width: 390, maxHeight: 500,
        display: 'flex', flexDirection: 'column',
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        overflow: 'hidden',
        zIndex: 30,
        fontFamily: '"Geist", ui-sans-serif, system-ui, sans-serif',
      }}
    >
      <div style={SEGMENT_WRAP_STYLE} role="tablist" aria-label="Model source">
        {(['auto', 'cloud', 'local', 'image'] as const).map(value => (
          <button
            key={value}
            type="button"
            onClick={() => setSourceAndPersist(value)}
            data-source-filter={value}
            aria-selected={source === value}
            style={{
              ...SEGMENT_STYLE,
              background: source === value ? 'var(--panel-2)' : 'transparent',
              borderColor: source === value ? 'var(--border)' : 'transparent',
              color: source === value ? 'var(--text-dim)' : 'var(--text-faint)',
            }}
          >
            {value}
          </button>
        ))}
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 14px',
        borderBottom: '1px solid var(--border)',
      }}>
        <span style={{ color: 'var(--text-faint)', display: 'flex' }}><Icons.Search /></span>
        <input
          ref={inputRef}
          value={query}
          onChange={e => { setQuery(e.target.value); setActiveIdx(0); }}
          placeholder="Search models..."
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            color: 'var(--text)', fontSize: 13,
            fontFamily: '"Geist", ui-sans-serif, system-ui, sans-serif',
            letterSpacing: 0,
          }}
        />
        {query && (
          <span
            onClick={() => setQuery('')}
            style={{ color: 'var(--text-faint)', cursor: 'pointer', display: 'flex' }}
          ><Icons.Close /></span>
        )}
      </div>

      <div style={{ overflowY: 'auto', flex: 1, paddingBottom: 6 }}>
        {displaySections.length === 0 && (
          <div style={{
            padding: '24px 16px', textAlign: 'center',
            color: 'var(--text-faint)', fontSize: 12,
            fontStyle: 'italic',
            fontFamily: '"Source Serif 4", Georgia, serif',
          }}>
            No models match "{query}".
          </div>
        )}
        {displaySections.map(({ title, models, favorite }) => (
          <div key={title}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '12px 14px 6px 18px',
            }}>
              <VendorMark vendor={title} size={11} />
              <span style={{
                fontSize: 10, fontWeight: 500,
                color: 'var(--text-faint)',
                textTransform: 'uppercase', letterSpacing: '0.12em',
                fontFamily: '"Geist Mono", monospace',
              }}>{title}</span>
              {favorite && (
                <span style={{
                  fontSize: 9, color: 'var(--accent)',
                  border: '1px solid var(--accent)', opacity: 0.7,
                  borderRadius: 2, padding: '0 4px',
                  fontFamily: '"Geist Mono", monospace',
                  letterSpacing: '0.08em',
                }}>PICK</span>
              )}
            </div>
            {models.map(model => {
              const meta = META[model.id] ?? META_BY_PROVIDER_MODEL_ID[model.providerModelId] ?? null;
              const flatIndex = flatIndexById.get(model.id) ?? -1;
              const disabledReason = disabledReasonForModel(model, comfyReady);
              const favoriteKey = model.id === AUTO_MODEL.id ? DEFAULT_MODEL_ID : model.id;
              const selected = model.id === AUTO_MODEL.id
                ? currentModelId === DEFAULT_MODEL_ID
                : model.id === currentModelId;
              return (
                <ModelRow
                  key={`${title}-${model.id}`}
                  model={model}
                  meta={meta}
                  selected={selected}
                  active={flatIndex === activeIdx}
                  isFavorite={favoriteSet.has(favoriteKey)}
                  disabledReason={disabledReason}
                  ollamaOnline={ollamaOnline}
                  comfyReady={comfyReady}
                  flatIndex={flatIndex}
                  onPick={pickModel}
                  onToggleFavorite={toggleFavorite}
                  onHover={hoverModelAt}
                />
              );
            })}
          </div>
        ))}
        {hiddenCount > 0 && (
          <div style={{
            padding: '10px 16px 12px',
            color: 'var(--text-faint)',
            fontSize: 11,
            lineHeight: 1.4,
            fontStyle: 'italic',
            fontFamily: '"Source Serif 4", Georgia, serif',
            borderTop: '1px solid var(--border)',
          }}>
            {query.trim()
              ? `Showing the first ${flat.length} matches. Refine search to narrow ${hiddenCount} more.`
              : `Showing top ${source} models. Search to find all ${totalMatching}.`}
          </div>
        )}
      </div>

      <div style={{
        padding: '7px 14px',
        borderTop: '1px solid var(--border)',
        fontFamily: '"Geist Mono", monospace',
        fontSize: 10, color: 'var(--text-faint)',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        textAlign: 'right',
      }}>
        {hiddenCount > 0 ? `${flat.length} of ${totalMatching}` : flat.length} models
      </div>
    </div>
  );
});

// Keeps picker order stable: recommended/current choices first, then source
// and recents, because keyboard navigation assumes rows do not jump while
// local runtimes or catalog refreshes update in the background.
function buildPickerSections(args: {
  all: readonly Model[];
  currentModel: Model | undefined;
  query: string;
  source: SourceFilter;
  recentIds: string[];
  favoriteModels: readonly Model[];
}): PickerSection[] {
  const normalizedQuery = args.query.trim().toLowerCase();
  const allById = new Map(args.all.map(model => [model.id, model]));
  const sourceModels = args.all.filter(model => sourceMatches(model, args.source));
  const base = normalizedQuery ? args.all.filter(model => matchesQuery(model, normalizedQuery)) : sourceModels;
  const sections: PickerSection[] = [];

  // User-pinned favorites lead the list in every source/search view (filtered
  // by the active source unless browsing "auto"), mirroring the recents pattern.
  const favorites = dedupeModels([...args.favoriteModels])
    .filter(model => args.source === 'auto' || sourceMatches(model, args.source))
    .filter(model => !normalizedQuery || matchesQuery(model, normalizedQuery));
  const pushFavorites = (): void => {
    if (favorites.length) sections.push({ title: 'Favorites', models: favorites });
  };
  const defaultCatalog = DEFAULT_OPENROUTER_CATALOG_MODEL_IDS
    .map(id => allById.get(id))
    .filter((model): model is Model => Boolean(model))
    .filter(model => sourceMatches(model, args.source))
    .filter(model => !normalizedQuery || matchesQuery(model, normalizedQuery));

  const rawRecommended = dedupeModels([
    AUTO_MODEL,
    ...(args.currentModel ? [args.currentModel] : []),
    firstLocalModel(args.all),
  ]).filter(model => !normalizedQuery || matchesQuery(model, normalizedQuery));
  const recommended = args.source === 'auto'
    ? rawRecommended
    : rawRecommended.filter(model => sourceMatches(model, args.source));

  pushFavorites();

  if (args.source === 'auto' && recommended.length) {
    sections.push({ title: 'Recommended', models: recommended, favorite: true });
    if (defaultCatalog.length) sections.push({ title: 'Default catalog', models: defaultCatalog });
    const recent = args.recentIds
      .map(id => allById.get(id))
      .filter((model): model is Model => Boolean(model))
      .filter(model => !normalizedQuery || matchesQuery(model, normalizedQuery));
    if (recent.length) sections.push({ title: 'Recent', models: dedupeModels(recent) });
    return removeDuplicateRowsAcrossSections(sections);
  }

  if (!normalizedQuery && recommended.length) {
    sections.push({ title: 'Recommended', models: recommended, favorite: true });
  }

  if (defaultCatalog.length && (args.source === 'cloud' || args.source === 'auto')) {
    sections.push({ title: 'Default catalog', models: defaultCatalog });
  }

  const sourceTitle = titleForSource(args.source);
  const sourceSectionModels = base.filter(model => sourceMatches(model, args.source));
  if (sourceSectionModels.length) {
    sections.push({ title: sourceTitle, models: sourceSectionModels });
  }

  const recent = args.recentIds
    .map(id => allById.get(id))
    .filter((model): model is Model => Boolean(model))
    .filter(model => sourceMatches(model, args.source))
    .filter(model => !normalizedQuery || matchesQuery(model, normalizedQuery));
  if (recent.length) sections.push({ title: 'Recent', models: dedupeModels(recent) });

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

function firstLocalModel(models: readonly Model[]): Model | undefined {
  return models.find(model => model.providerId === 'ollama');
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

function removeDuplicateRowsAcrossSections(sections: PickerSection[]): PickerSection[] {
  const seen = new Set<string>();
  return sections.map(section => {
    if (section.title === 'Recent' || section.title === 'Favorites') return section;
    const models = section.models.filter(model => {
      const key = model.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { ...section, models };
  }).filter(section => section.models.length > 0);
}

function limitModelSections(sections: PickerSection[], query: string): PickerSection[] {
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
      models: section.favorite || section.title === 'Default catalog' || section.title === 'Favorites'
        ? section.models
        : section.models.slice(0, BROWSE_SECTION_LIMIT),
    }))
    .filter(section => section.models.length > 0);
}

function bestForLine(model: Model, meta: ModelMeta | null): string {
  if (model.description) return model.description;
  if (meta?.tag) return meta.tag;
  if (model.providerId === 'ollama') {
    const tools = model.supportsTools === false ? 'tools off' : 'micro tools recommended';
    return `private local chat; ${tools}`;
  }
  if (model.providerId === 'local-image') return 'local ComfyUI image generation';
  return describeDynamic(model);
}

function badgesForModel(model: Model, ollamaOnline: boolean, comfyReady: boolean): Array<{ label: string; tone?: 'muted' | 'accent' | 'warn'; title?: string; icon?: 'vision' | 'tools' }> {
  const meta = META[model.id] ?? META_BY_PROVIDER_MODEL_ID[model.providerModelId] ?? null;
  const badges: Array<{ label: string; tone?: 'muted' | 'accent' | 'warn'; title?: string; icon?: 'vision' | 'tools' }> = [];
  if (model.id === AUTO_MODEL.id) badges.push({ label: 'AUTO', tone: 'accent' });
  else if (model.providerId === 'ollama') badges.push({ label: 'LOCAL' });
  else if (model.providerId === 'local-image') badges.push({ label: 'IMAGE' });

  if (model.providerId === 'ollama') {
    badges.push({ label: ollamaOnline ? 'online' : 'offline', tone: ollamaOnline ? 'accent' : 'warn' });
    if (model.supportsTools !== false) badges.push({ label: 'tools', icon: 'tools', title: 'Tools' });
  } else if (model.providerId === 'local-image') {
    badges.push({ label: comfyReady ? 'online' : 'offline', tone: comfyReady ? 'accent' : 'warn' });
  } else {
    if (modelSupportsVision(model)) badges.push({ label: 'vision', icon: 'vision', title: 'Vision' });
    if (model.supportsTools !== false) badges.push({ label: 'tools', icon: 'tools', title: 'Tools' });
  }

  if (meta?.costLabel) badges.push({ label: meta.costLabel, tone: meta.costLabel === '$$$' ? 'warn' : 'muted', title: 'Relative cost' });
  return badges.slice(0, 5);
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

function badgeColor(tone: 'muted' | 'accent' | 'warn'): string {
  if (tone === 'accent') return 'var(--accent)';
  if (tone === 'warn') return '#d19a66';
  return 'var(--text-faint)';
}

function formatPrice(usdPerMillion: number): string {
  if (usdPerMillion === 0) return '0';
  return usdPerMillion.toFixed(2);
}

function disabledReasonForModel(model: Model, comfyReady: boolean): string | undefined {
  if (model.providerId !== 'local-image' || comfyReady) return undefined;
  return 'Enable and connect ComfyUI in Local settings to use local image generation.';
}


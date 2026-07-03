// The model-picker popover: search, capability/source filtering, favorites, and
// keyboard selection. Rendered by EditorialComposer (lazy-loaded); reads the
// model registry + local-runtime store via hooks. All section/filter/badge
// logic lives in core/modelPicker — this surface is presentation only.
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import type { Model } from '../../core/types';
import { DEFAULT_MODEL_ID } from '../../core/models';
import { isWebLite } from '../../core/runtime';
import { isVerifiedModelId } from '../../core/modelPickerAvailability';
import {
  AUTO_MODEL,
  badgesForModel,
  bestForLine,
  CAPABILITY_FILTERS,
  emptyStateMessage,
  metaFor,
  VERIFIED_SECTION_TITLE,
  type CapabilityFilter,
  type ModelMeta,
  type SourceFilter,
} from '../../core/modelPicker';
import { Icons } from '../ui/icons';
import { useEditorial } from '../../stores/context';
import { computeModelSections } from './modelPopoverSections';

interface ModelPopoverProps {
  currentModelId: string | undefined;
  onPick: (modelId: string) => void;
  onClose: () => void;
}

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
    case VERIFIED_SECTION_TITLE:
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
  gap: 3,
  padding: 4,
  borderBottom: '1px solid var(--border)',
  background: 'rgba(255,255,255,0.02)',
};

const CAP_WRAP_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
  padding: '6px 10px 8px',
  borderBottom: '1px solid var(--border)',
};

function VerifiedMark({ size = 11 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="var(--accent)"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ flexShrink: 0, opacity: 0.9 }}
    >
      <path d="M2.5 8.5l3 3 8-8" />
    </svg>
  );
}

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

function badgeColor(tone: 'muted' | 'accent' | 'warn'): string {
  if (tone === 'accent') return 'var(--accent)';
  if (tone === 'warn') return '#d19a66';
  return 'var(--text-faint)';
}

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
  verified: boolean;
  flatIndex: number;
  onPick: (model: Model) => void;
  onToggleFavorite: (model: Model) => void;
  onHover: (index: number) => void;
}

const ModelRow = memo(function ModelRow({
  model, meta, selected, active, isFavorite, verified, flatIndex, onPick, onToggleFavorite, onHover,
}: RowProps) {
  // Unusable models (offline Ollama / ComfyUI) are filtered out of the picker
  // entirely by `isModelAvailable`, so every row rendered here is selectable.
  const subline = bestForLine(model, meta);
  const rowStyle: CSSProperties = {
    position: 'relative',
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(90px, auto)',
    rowGap: 1,
    padding: '7px 14px 7px 18px',
    cursor: 'pointer',
    background: active ? 'var(--panel-2)' : 'transparent',
    borderLeft: selected ? '2px solid var(--accent)' : '2px solid transparent',
    transition: 'background 80ms ease',
  };
  const nameStyle: CSSProperties = {
    ...NAME_STYLE_BASE,
    color: selected ? 'var(--text)' : 'var(--text-dim)',
  };
  const sublineStyle: CSSProperties = {
    ...SUBLINE_STYLE_BASE,
    color: 'var(--text-faint)',
  };
  return (
    <div
      className="model-popover__row"
      data-model-row={model.id}
      role="option"
      aria-selected={selected}
      data-active={active || undefined}
      data-selected={selected || undefined}
      onClick={() => onPick(model)}
      onMouseEnter={() => onHover(flatIndex)}
      style={rowStyle}
    >
      <div style={ROW_LEFT_STYLE}>
        <span style={nameStyle}>{model.name}</span>
        {verified && <span title="Verified — covered by the live model test suite"><VerifiedMark size={11} /></span>}
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
        {badgesForModel(model).map(badge => (
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
  const { registry, localRuntime } = useEditorial();
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [source, setSource] = useState<SourceFilter>(() => registry.pickerSource());
  const [caps, setCaps] = useState<ReadonlySet<CapabilityFilter>>(() => new Set());
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

  const registryAll = registry.all;
  const ollamaOnline = localRuntime.runtimes.ollama.status === 'online';
  const comfyReady = localRuntime.comfyReady;

  const webLite = isWebLite();
  const computedSections = useMemo(() => computeModelSections(
    {
      all: registryAll,
      findById: id => registry.findById(id),
    },
    query,
    {
      currentModelId,
      source,
      caps,
      recentIds,
      runtime: { webLite, ollamaOnline, comfyReady },
    },
    favoriteIds,
  ), [registry, registryAll, query, currentModelId, source, caps, recentIds, favoriteIds, webLite, ollamaOnline, comfyReady]);

  const {
    sourceTabs,
    effectiveSource,
    displaySections,
    flat,
    flatIndexById,
    favoriteSet,
    totalMatching,
    hiddenCount,
  } = computedSections;

  useEffect(() => {
    setActiveIdx(i => Math.min(i, Math.max(0, flat.length - 1)));
  }, [flat.length]);

  const setSourceAndPersist = (next: SourceFilter) => {
    setSource(next);
    setActiveIdx(0);
    registry.setPickerSource(next);
  };

  const toggleCap = useCallback((cap: CapabilityFilter) => {
    setActiveIdx(0);
    setCaps(prev => {
      const next = new Set(prev);
      if (next.has(cap)) next.delete(cap); else next.add(cap);
      return next;
    });
  }, []);

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
      if (activeModel) pickModel(activeModel);
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
      <div
        style={{ ...SEGMENT_WRAP_STYLE, gridTemplateColumns: `repeat(${sourceTabs.length}, 1fr)` }}
        role="tablist"
        aria-label="Model source"
      >
        {sourceTabs.map(value => (
          <button
            key={value}
            type="button"
            className="model-popover__segment"
            role="tab"
            onClick={() => setSourceAndPersist(value)}
            data-source-filter={value}
            data-active={effectiveSource === value || undefined}
            aria-selected={effectiveSource === value}
            style={{
              ...SEGMENT_STYLE,
              background: effectiveSource === value ? 'var(--panel-2)' : 'transparent',
              borderColor: effectiveSource === value ? 'var(--border)' : 'transparent',
              color: effectiveSource === value ? 'var(--text-dim)' : 'var(--text-faint)',
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
          <button
            type="button"
            className="model-popover__clear"
            aria-label="Clear model search"
            onClick={() => setQuery('')}
            style={{ color: 'var(--text-faint)', cursor: 'pointer', display: 'flex', border: 0, background: 'transparent', padding: 0 }}
          ><Icons.Close /></button>
        )}
      </div>

      <div style={CAP_WRAP_STYLE} role="group" aria-label="Capability filters">
        {CAPABILITY_FILTERS.map(cap => {
          const on = caps.has(cap.id);
          return (
            <button
              key={cap.id}
              type="button"
              className="model-popover__cap-filter"
              data-cap-filter={cap.id}
              aria-pressed={on}
              data-active={on || undefined}
              onClick={() => toggleCap(cap.id)}
              style={{
                height: 20,
                padding: '0 8px',
                borderRadius: 10,
                border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                background: on ? 'rgba(var(--accent-rgb, 120 140 255), 0.14)' : 'transparent',
                color: on ? 'var(--accent)' : 'var(--text-faint)',
                fontFamily: '"Geist Mono", monospace',
                fontSize: 10,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              {cap.label}
            </button>
          );
        })}
      </div>

      <div role="listbox" aria-label="Models" style={{ overflowY: 'auto', flex: 1, paddingBottom: 6 }}>
        {displaySections.length === 0 && (
          <div style={{
            padding: '24px 16px', textAlign: 'center',
            color: 'var(--text-faint)', fontSize: 12,
            fontStyle: 'italic',
            fontFamily: '"Source Serif 4", Georgia, serif',
          }}>
            {emptyStateMessage(query, caps.size > 0, effectiveSource)}
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
              const meta = metaFor(model);
              const flatIndex = flatIndexById.get(model.id) ?? -1;
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
                  verified={isVerifiedModelId(model.id)}
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
              : `Showing top ${effectiveSource} models. Search to find all ${totalMatching}.`}
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

// React.lazy needs a default export; named export kept for tests/direct use.
export default ModelPopover;

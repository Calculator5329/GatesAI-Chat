import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import type { Model } from '../../core/types';
import { Icons } from '../ui/icons';
import { useLocalRuntimeStore, useModelRegistry } from '../../stores/context';
import { buildModelMenuSections } from '../../core/modelMenu';

interface ModelPopoverProps {
  currentModelId: string | undefined;
  onPick: (modelId: string) => void;
  onClose: () => void;
}

interface ModelMeta {
  /** Short tag — keep under ~40 chars. */
  tag: string;
  capabilities: Array<'vision' | 'reasoning' | 'fast' | 'tools'>;
  costLabel?: '$' | '$$' | '$$$' | 'LOCAL';
  starred?: boolean;
}

const META: Record<string, ModelMeta> = {
  'or-gemini-3-flash':     { tag: 'Vision · fast',                    capabilities: ['vision', 'fast'], costLabel: '$', starred: true },
  'or-deepseek-v4-flash':  { tag: 'Fast · reasoning',                  capabilities: ['fast', 'reasoning'], costLabel: '$', starred: true },
  'or-gpt-5.5':            { tag: 'Vision · tools · reasoning',        capabilities: ['vision', 'tools', 'reasoning'], costLabel: '$$', starred: true },
  'or-claude-opus-4.7':    { tag: 'Vision · tools · reasoning',       capabilities: ['vision', 'tools', 'reasoning'], costLabel: '$$$', starred: true },
  'or-gemini-3.1-pro':     { tag: 'Vision · tools · reasoning',       capabilities: ['vision', 'tools', 'reasoning'], costLabel: '$$', starred: true },
  'image-direct-comfy':    { tag: 'FLUX.2 Klein direct local image',   capabilities: ['fast'], costLabel: 'LOCAL', starred: true },
  'or-deepseek-v4-pro':    { tag: 'Reasoning',                         capabilities: ['reasoning'] },
  'or-gpt-5.5-pro':        { tag: 'Vision · tools · reasoning',       capabilities: ['vision', 'tools', 'reasoning'] },
  'or-gemini-3.1-flash-lite': { tag: 'Vision · fast',                 capabilities: ['vision', 'fast'] },
};

const META_BY_PROVIDER_MODEL_ID: Record<string, ModelMeta> = {
  'google/gemini-3-flash-preview': META['or-gemini-3-flash'],
  'deepseek/deepseek-v4-flash': META['or-deepseek-v4-flash'],
  'openai/gpt-5.5': META['or-gpt-5.5'],
  'anthropic/claude-opus-4.7': META['or-claude-opus-4.7'],
  'google/gemini-3.1-pro-preview': META['or-gemini-3.1-pro'],
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
    case 'Anthropic':
      return <img src="/anthropic_white.svg" alt="" style={common} />;
    case 'xAI':
      return <img src="/xai_dark.svg" alt="" style={common} />;
    case 'Favorites':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="var(--accent)" style={{ flexShrink: 0, opacity: 0.9 }}>
          <path d="M8 1.5l2 4.5 5 .5-3.8 3.3 1.2 4.7L8 12l-4.4 2.5L4.8 9.8 1 6.5l5-.5z" />
        </svg>
      );
    case 'OpenRouter':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: 'var(--text-dim)' }}>
          <path d="M3 12h6l3-4 3 8 3-4h3" />
        </svg>
      );
    case 'Local':
    case 'Local image':
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

function CapabilityIcon({ kind }: { kind: 'vision' | 'reasoning' | 'fast' | 'tools' }) {
  const common: CSSProperties = {
    width: 16, height: 16,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    color: 'var(--text-faint)',
    flexShrink: 0,
  };
  let title = '';
  let icon: ReactNode = null;
  switch (kind) {
    case 'vision':
      title = 'Vision';
      icon = (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5S1 8 1 8z" /><circle cx="8" cy="8" r="2" />
        </svg>
      );
      break;
    case 'reasoning':
      title = 'Reasoning';
      icon = (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 2a4 4 0 0 0-2.5 7.1V12h5V9.1A4 4 0 0 0 8 2z" /><path d="M6 14h4" />
        </svg>
      );
      break;
    case 'fast':
      title = 'Fast';
      icon = (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 1L3 9h4l-1 6 6-8H8l1-6z" />
        </svg>
      );
      break;
    case 'tools':
      title = 'Tool use';
      icon = (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.5 2.5a3 3 0 0 0-3.8 3.8L2 11l3 3 4.7-4.7a3 3 0 0 0 3.8-3.8L11 8 8 5z" />
        </svg>
      );
      break;
  }
  return <span title={title} style={common}>{icon}</span>;
}

function CostPill({ label }: { label: NonNullable<ModelMeta['costLabel']> }) {
  return (
    <span
      title={label === 'LOCAL' ? 'Local model' : 'Relative cost tier'}
      style={{
        color: label === '$$$' ? 'var(--accent)' : 'var(--text-faint)',
        border: '1px solid var(--border)',
        borderRadius: 2,
        padding: '0 4px',
        fontSize: 9,
        lineHeight: '14px',
        fontFamily: '"Geist Mono", monospace',
        letterSpacing: '0.04em',
      }}
    >
      {label}
    </span>
  );
}

interface RowProps {
  model: Model;
  meta: ModelMeta | null;
  selected: boolean;
  active: boolean;
  disabledReason?: string;
  onPick: () => void;
  onHover: () => void;
}

function ModelRow({ model, meta, selected, active, disabledReason, onPick, onHover }: RowProps) {
  const disabled = !!disabledReason;
  const subline = disabledReason ?? (meta ? meta.tag : describeDynamic(model));
  return (
    <div
      onClick={() => { if (!disabled) onPick(); }}
      onMouseEnter={onHover}
      aria-disabled={disabled || undefined}
      title={disabledReason}
      style={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        rowGap: 1,
        padding: '7px 14px 7px 18px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.42 : 1,
        filter: disabled ? 'grayscale(0.8)' : undefined,
        background: active && !disabled ? 'var(--panel-2)' : 'transparent',
        borderLeft: selected ? `2px solid ${disabled ? 'var(--text-faint)' : 'var(--accent)'}` : '2px solid transparent',
        transition: 'background 80ms ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
        <span style={{
          color: disabled ? 'var(--text-faint)' : selected ? 'var(--text)' : 'var(--text-dim)',
          fontSize: 13,
          fontWeight: 400,
          letterSpacing: '-0.005em',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{model.name}</span>
        {meta?.starred && (
          <svg width="9" height="9" viewBox="0 0 16 16" fill="var(--accent)" style={{ flexShrink: 0, opacity: 0.85 }}>
            <path d="M8 1.5l2 4.5 5 .5-3.8 3.3 1.2 4.7L8 12l-4.4 2.5L4.8 9.8 1 6.5l5-.5z" />
          </svg>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {meta?.costLabel && <CostPill label={meta.costLabel} />}
        {meta && meta.capabilities.map(c => <CapabilityIcon key={c} kind={c} />)}
      </div>
      <div style={{
        gridColumn: '1 / -1',
        color: disabled ? 'var(--text-dim)' : 'var(--text-faint)',
        fontSize: 11,
        fontStyle: 'italic',
        fontFamily: '"Source Serif 4", Georgia, serif',
        lineHeight: 1.35,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{subline}</div>
    </div>
  );
}

function describeDynamic(m: Model): string {
  const bits: string[] = [];
  if (m.contextLength) bits.push(`${formatContext(m.contextLength)} ctx`);
  if (m.pricing?.prompt != null && m.pricing.completion != null) {
    bits.push(`$${formatPrice(m.pricing.prompt)} / $${formatPrice(m.pricing.completion)} per 1M`);
  } else if (m.pricing?.prompt != null) {
    bits.push(`$${formatPrice(m.pricing.prompt)} / 1M in`);
  }
  if (bits.length === 0) return m.providerModelId;
  return bits.join(' · ');
}

function formatContext(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

function formatPrice(usdPerMillion: number): string {
  if (usdPerMillion === 0) return '0';
  if (usdPerMillion < 1) return usdPerMillion.toFixed(2);
  return usdPerMillion.toFixed(2);
}

export const ModelPopover = observer(function ModelPopover({ currentModelId, onPick, onClose }: ModelPopoverProps) {
  const registry = useModelRegistry();
  const localRuntime = useLocalRuntimeStore();
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter(m => {
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.vendor.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        m.providerModelId.toLowerCase().includes(q)
      );
    });
  }, [all, query]);

  const grouped = useMemo(() => {
    return buildModelMenuSections(filtered);
  }, [filtered]);

  const flat = useMemo(() => grouped.flatMap(g => g.models), [grouped]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, Math.max(0, flat.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const m = flat[activeIdx];
      if (m && !disabledReasonForModel(m, localRuntime.comfyReady)) {
        onPick(m.id);
        onClose();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      ref={ref}
      onKeyDown={onKeyDown}
      style={{
        position: 'absolute', bottom: 'calc(100% + 8px)', left: 0,
        width: 360, maxHeight: 460,
        display: 'flex', flexDirection: 'column',
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        borderRadius: 2,
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        overflow: 'hidden',
        zIndex: 30,
        fontFamily: '"Geist", ui-sans-serif, system-ui, sans-serif',
      }}
    >
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
          placeholder="Search models…"
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            color: 'var(--text)', fontSize: 13,
            fontFamily: '"Geist", ui-sans-serif, system-ui, sans-serif',
            letterSpacing: '-0.005em',
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
        {grouped.length === 0 && (
          <div style={{
            padding: '24px 16px', textAlign: 'center',
            color: 'var(--text-faint)', fontSize: 12,
            fontStyle: 'italic',
            fontFamily: '"Source Serif 4", Georgia, serif',
          }}>
            No models match “{query}”.
          </div>
        )}
        {grouped.map(({ title, models }) => (
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
              {models.some(model => model.dynamic) && (
                <span style={{
                  fontSize: 9, color: 'var(--accent)',
                  border: '1px solid var(--accent)', opacity: 0.7,
                  borderRadius: 2, padding: '0 4px',
                  fontFamily: '"Geist Mono", monospace',
                  letterSpacing: '0.08em',
                }}>LIVE</span>
              )}
            </div>
            {models.map(m => {
              const meta = META[m.id] ?? META_BY_PROVIDER_MODEL_ID[m.providerModelId] ?? null;
              const flatIdx = flat.findIndex(x => x.id === m.id);
              const disabledReason = disabledReasonForModel(m, localRuntime.comfyReady);
              return (
                <ModelRow
                  key={m.id}
                  model={m}
                  meta={meta}
                  selected={m.id === currentModelId}
                  active={flatIdx === activeIdx}
                  disabledReason={disabledReason}
                  onPick={() => { onPick(m.id); onClose(); }}
                  onHover={() => setActiveIdx(flatIdx)}
                />
              );
            })}
          </div>
        ))}
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 14px',
        borderTop: '1px solid var(--border)',
        fontFamily: '"Geist Mono", monospace',
        fontSize: 10, color: 'var(--text-faint)',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span><Kbd>↑↓</Kbd> nav</span>
          <span><Kbd>↵</Kbd> select</span>
          <span><Kbd>esc</Kbd> close</span>
        </span>
        <span>{flat.length} models</span>
      </div>
    </div>
  );
});

function disabledReasonForModel(model: Model, comfyReady: boolean): string | undefined {
  if (model.providerId !== 'local-image' || comfyReady) return undefined;
  return 'Enable and connect ComfyUI in Local settings to use local image generation.';
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '0 4px',
      borderRadius: 2,
      border: '1px solid var(--border)',
      color: 'var(--text-dim)',
      fontSize: 9.5,
      marginRight: 4,
    }}>{children}</span>
  );
}

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import type { Model } from '../../core/types';
import { Icons } from '../ui/icons';
import { useModelRegistry } from '../../stores/context';

interface ModelPopoverProps {
  currentModelId: string | undefined;
  onPick: (modelId: string) => void;
  onClose: () => void;
}

interface ModelMeta {
  /** Short tag — keep under ~40 chars. */
  tag: string;
  capabilities: Array<'vision' | 'reasoning' | 'fast' | 'tools'>;
  starred?: boolean;
}

const META: Record<string, ModelMeta> = {
  'claude-opus-4.7':       { tag: 'Frontier — best for hard work',    capabilities: ['vision', 'tools', 'reasoning'], starred: true },
  'claude-sonnet-4.6':     { tag: 'Sonnet for real-world work',       capabilities: ['vision', 'tools', 'reasoning'], starred: true },
  'claude-opus-4.6':       { tag: 'Prior frontier — still excellent', capabilities: ['vision', 'tools', 'reasoning'] },
  'claude-haiku-4.5':      { tag: 'Snappy everyday model',            capabilities: ['vision', 'fast'] },
  'claude-sonnet-4.5':     { tag: 'Stable Sonnet baseline',           capabilities: ['vision', 'tools'] },
  'gpt-5.5':               { tag: 'Frontier for complex work',        capabilities: ['vision', 'tools', 'reasoning'], starred: true },
  'gpt-5.5-pro':           { tag: 'Deep reasoning, highest accuracy', capabilities: ['vision', 'tools', 'reasoning'] },
  'gpt-5.4':               { tag: 'Flagship for chat & code',         capabilities: ['vision', 'tools', 'reasoning'], starred: true },
  'gpt-5.4-pro':           { tag: 'Pro tier — extended reasoning',    capabilities: ['vision', 'tools', 'reasoning'] },
  'gpt-5.4-mini':          { tag: 'Fast everyday OpenAI',             capabilities: ['vision', 'fast'] },
  'gpt-5.4-nano':          { tag: 'Cheapest GPT-5.4',                 capabilities: ['fast'] },
  'gpt-5':                 { tag: 'Prior flagship',                   capabilities: ['vision', 'tools', 'reasoning'] },
  'gemini-3.1-pro':        { tag: 'Frontier reasoning, 1M context',   capabilities: ['vision', 'tools', 'reasoning'], starred: true },
  'gemini-3-flash':        { tag: 'Fast frontier — cheap & capable',  capabilities: ['vision', 'tools', 'fast'], starred: true },
  'gemini-3.1-flash-image':{ tag: 'Nano Banana 2 — image gen',        capabilities: ['vision', 'fast'] },
  'gemini-2.5-flash-lite': { tag: 'Cheapest Gemini, low-latency',     capabilities: ['fast'] },
  'groq-llama-3.3-70b':    { tag: 'Llama on Groq — extreme speed',    capabilities: ['fast'] },
  'groq-llama-3.1-8b':     { tag: 'Tiny Llama, instant',              capabilities: ['fast'] },
  'groq-gpt-oss-120b':     { tag: 'GPT-OSS 120B on Groq',             capabilities: ['fast', 'reasoning'] },
  'groq-gpt-oss-20b':      { tag: 'GPT-OSS 20B on Groq',              capabilities: ['fast'] },
  'or-deepseek-v4-pro':    { tag: 'DeepSeek V4 Pro via OpenRouter',   capabilities: ['reasoning'] },
  'or-deepseek-v4-flash':  { tag: 'DeepSeek V4 Flash via OpenRouter', capabilities: ['fast', 'reasoning'] },
  'or-gpt-5.5':            { tag: 'GPT-5.5 via OpenRouter',           capabilities: ['vision', 'tools', 'reasoning'] },
  'or-gpt-5.5-pro':        { tag: 'GPT-5.5 Pro via OpenRouter',       capabilities: ['vision', 'tools', 'reasoning'] },
  'or-gemini-3.1-pro':     { tag: 'Gemini 3.1 Pro via OpenRouter',    capabilities: ['vision', 'tools', 'reasoning'] },
  'or-gemini-3.1-flash-lite': { tag: 'Gemini 3.1 Flash Lite via OpenRouter', capabilities: ['vision', 'fast'] },
};

const VENDOR_ORDER = ['OpenRouter', 'Local image', 'Ollama'] as const;
const OR_CATALOG_GROUP = 'OpenRouter Catalog';

function VendorMark({ vendor, size = 12 }: { vendor: string; size?: number }) {
  const common: CSSProperties = {
    width: size, height: size,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
    opacity: 0.85,
  };
  switch (vendor) {
    case 'OpenAI':
      return <img src="/openai_dark.svg" alt="" style={common} />;
    case 'Anthropic':
      return <img src="/anthropic_white.svg" alt="" style={common} />;
    case 'Google':
      return <img src="/gemini.svg" alt="" style={common} />;
    case 'Groq':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0, color: 'var(--text-dim)' }}>
          <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 16a6 6 0 1 1 6-6 6 6 0 0 1-6 6z" />
          <circle cx="12" cy="12" r="2.2" />
        </svg>
      );
    case 'OpenRouter':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: 'var(--text-dim)' }}>
          <path d="M3 12h6l3-4 3 8 3-4h3" />
        </svg>
      );
    case 'Local':
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

interface RowProps {
  model: Model;
  meta: ModelMeta | null;
  selected: boolean;
  active: boolean;
  onPick: () => void;
  onHover: () => void;
}

function ModelRow({ model, meta, selected, active, onPick, onHover }: RowProps) {
  const subline = meta ? meta.tag : describeDynamic(model);
  return (
    <div
      onClick={onPick}
      onMouseEnter={onHover}
      style={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        rowGap: 1,
        padding: '7px 14px 7px 18px',
        cursor: 'pointer',
        background: active ? 'var(--panel-2)' : 'transparent',
        borderLeft: selected ? '2px solid var(--accent)' : '2px solid transparent',
        transition: 'background 80ms ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
        <span style={{
          color: selected ? 'var(--text)' : 'var(--text-dim)',
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
        {meta && meta.capabilities.map(c => <CapabilityIcon key={c} kind={c} />)}
      </div>
      <div style={{
        gridColumn: '1 / -1',
        color: 'var(--text-faint)',
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
    const curated = filtered.filter(m => !m.dynamic);
    const dynamic = filtered.filter(m => m.dynamic);
    const byVendor = new Map<string, Model[]>();
    for (const m of curated) {
      const arr = byVendor.get(m.vendor) ?? [];
      arr.push(m);
      byVendor.set(m.vendor, arr);
    }
    const ordered: Array<{ vendor: string; models: Model[] }> = [];
    for (const v of VENDOR_ORDER) {
      const ms = byVendor.get(v);
      if (ms && ms.length) ordered.push({ vendor: v, models: ms });
      byVendor.delete(v);
    }
    for (const [v, ms] of byVendor) ordered.push({ vendor: v, models: ms });
    if (dynamic.length) ordered.push({ vendor: OR_CATALOG_GROUP, models: dynamic });
    return ordered;
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
      if (m) {
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
        {grouped.map(({ vendor, models }) => (
          <div key={vendor}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '12px 14px 6px 18px',
            }}>
              <VendorMark vendor={vendor === OR_CATALOG_GROUP ? 'OpenRouter' : vendor} size={11} />
              <span style={{
                fontSize: 10, fontWeight: 500,
                color: 'var(--text-faint)',
                textTransform: 'uppercase', letterSpacing: '0.12em',
                fontFamily: '"Geist Mono", monospace',
              }}>{vendor}</span>
              {vendor === OR_CATALOG_GROUP && (
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
              const meta = META[m.id] ?? null;
              const flatIdx = flat.findIndex(x => x.id === m.id);
              return (
                <ModelRow
                  key={m.id}
                  model={m}
                  meta={meta}
                  selected={m.id === currentModelId}
                  active={flatIdx === activeIdx}
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

import type { CSSProperties } from 'react';
import type { ToolCall } from '../../core/llm';
import type { ToolCallStyleKey, ToolResult } from '../../core/types';

/**
 * Renders the assistant's tool invocation and the subsequent tool result.
 * All five variants prioritize "stay out of the way" — they share the
 * design rule that the *result* line carries the meaning and the call
 * itself is either suppressed or reduced to a leader glyph. This keeps
 * the conversation focused on prose and removes the two-row redundancy
 * the earlier designs all suffered from.
 *
 * Adding a sixth: append to the union in `core/types.ts`, register in
 * `VARIANTS`, and the picker in Appearance picks it up automatically.
 */

interface CallProps {
  call: ToolCall;
  style: ToolCallStyleKey;
}

interface ResultProps {
  result: ToolResult;
  style: ToolCallStyleKey;
}

export function ToolCallView({ call, style }: CallProps) {
  const Renderer = VARIANTS[style].Call;
  return <Renderer call={call} />;
}

export function ToolResultView({ result, style }: ResultProps) {
  const Renderer = VARIANTS[style].Result;
  return <Renderer result={result} />;
}

// ─────────────────────────────────────────────────────────────────────────
// Variant 1 — whisper. Single line, no glyphs, "tool · action · result".
// The call renders nothing (the result line tells the whole story).
// ─────────────────────────────────────────────────────────────────────────

function WhisperCall(_: { call: ToolCall }) {
  return null;
}

function WhisperResult({ result }: { result: ToolResult }) {
  return (
    <div style={{
      ...mono(11), color: 'var(--text-faint)',
      letterSpacing: '0.02em',
      padding: '4px 0',
      whiteSpace: 'pre-wrap',
    }}>
      {result.toolName} · {oneLine(result.content)}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Variant 2 — dot. A single accent dot + tool name. Bare minimum to
// indicate "something happened" without disclosing what.
// ─────────────────────────────────────────────────────────────────────────

function DotCall(_: { call: ToolCall }) {
  return null;
}

function DotResult({ result }: { result: ToolResult }) {
  return (
    <div
      title={oneLine(result.content)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '4px 0',
        ...mono(11), color: 'var(--text-faint)',
      }}
    >
      <span style={{
        width: 5, height: 5, borderRadius: '50%',
        background: 'var(--accent)', opacity: 0.55,
        flexShrink: 0,
      }} />
      <span>{result.toolName}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Variant 3 — aside. Italic serif murmur. Reads as a parenthetical.
// ─────────────────────────────────────────────────────────────────────────

function AsideCall(_: { call: ToolCall }) {
  return null;
}

function AsideResult({ result }: { result: ToolResult }) {
  return (
    <div style={{
      fontFamily: '"Source Serif 4", Iowan Old Style, Georgia, serif',
      fontSize: 13, lineHeight: 1.5,
      color: 'var(--text-faint)',
      fontStyle: 'italic',
      padding: '4px 0',
      whiteSpace: 'pre-wrap',
    }}>
      {asideFor(result)}
    </div>
  );
}

function asideFor(r: ToolResult): string {
  // Cheap natural-language remap for known tools. Falls through to the
  // raw content for anything else.
  const c = oneLine(r.content);
  if (r.toolName === 'memory') {
    if (/^saved/i.test(c))     return 'saved a memory';
    if (/^removed/i.test(c))   return 'forgot a memory';
    if (/^updated/i.test(c))   return 'updated a memory';
    if (/^already/i.test(c))   return 'already remembered';
    if (/^no fact/i.test(c))   return 'nothing to forget';
    if (/^error/i.test(c))     return 'memory tool errored';
    if (/^\d+\./.test(c))      return 'looked up what I remember';
  }
  return c.length > 80 ? `${c.slice(0, 77)}…` : c;
}

// ─────────────────────────────────────────────────────────────────────────
// Variant 4 — mark. A thin accent rule in the left margin. Zero text.
// Hover reveals what happened via the native title tooltip.
// ─────────────────────────────────────────────────────────────────────────

function MarkCall(_: { call: ToolCall }) {
  return null;
}

function MarkResult({ result }: { result: ToolResult }) {
  return (
    <div
      title={`${result.toolName}: ${oneLine(result.content)}`}
      style={{
        height: 14,
        marginLeft: -2,
        paddingLeft: 4,
        borderLeft: '2px solid color-mix(in srgb, var(--accent) 55%, transparent)',
        // No text. The bar IS the indicator.
      }}
      aria-label={`${result.toolName} ran`}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Variant 5 — hidden. The model uses tools; you never see them.
// ─────────────────────────────────────────────────────────────────────────

function HiddenCall(_: { call: ToolCall }) {
  return null;
}

function HiddenResult(_: { result: ToolResult }) {
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Registry + helpers
// ─────────────────────────────────────────────────────────────────────────

interface VariantSet {
  Call: (props: { call: ToolCall }) => React.ReactElement | null;
  Result: (props: { result: ToolResult }) => React.ReactElement | null;
}

const VARIANTS: Record<ToolCallStyleKey, VariantSet> = {
  whisper: { Call: WhisperCall, Result: WhisperResult },
  dot:     { Call: DotCall,     Result: DotResult },
  aside:   { Call: AsideCall,   Result: AsideResult },
  mark:    { Call: MarkCall,    Result: MarkResult },
  hidden:  { Call: HiddenCall,  Result: HiddenResult },
};

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function mono(size: number): CSSProperties {
  return { fontFamily: '"Geist Mono", ui-monospace, monospace', fontSize: size };
}

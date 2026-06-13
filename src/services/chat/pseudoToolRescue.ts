// Rescue parser for small local models that print pseudo tool calls like
// `fs.write({ path: "...", content: "..." })` as prose instead of emitting
// structured tool_call chunks. ChatStore runs this only on the Ollama path
// when a round produced zero structured calls but tools were offered.
// Stateless and defensive: at most 3 rescued calls per round.
import type { ToolCall } from '../../core/llm';

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function extractLocalPseudoToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  let searchFrom = 0;
  while (calls.length < 3) {
    const idx = text.indexOf('fs.write', searchFrom);
    if (idx < 0) break;
    const openParen = text.indexOf('(', idx + 'fs.write'.length);
    if (openParen < 0) break;
    const inner = readBalancedParens(text, openParen);
    if (!inner) {
      searchFrom = idx + 'fs.write'.length;
      continue;
    }
    const path = readObjectStringProperty(inner, 'path');
    const content =
      readObjectStringProperty(inner, 'content') ??
      readObjectStringProperty(inner, 'contents');
    if (path && content != null) {
      calls.push({
        id: newId('tc-rescue'),
        name: 'fs',
        arguments: {
          action: 'write',
          path: normalizeRescuedWorkspacePath(path),
          content,
        },
      });
    }
    searchFrom = inner.end + 1;
  }
  return calls;
}

function readBalancedParens(text: string, openIndex: number): { value: string; end: number } | null {
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return { value: text.slice(openIndex + 1, i), end: i };
    }
  }
  return null;
}

function readObjectStringProperty(source: { value: string } | string, key: string): string | null {
  const text = typeof source === 'string' ? source : source.value;
  const keyMatch = new RegExp(`\\b${key}\\s*:`).exec(text);
  if (!keyMatch) return null;
  let i = keyMatch.index + keyMatch[0].length;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  const quote = text[i];
  if (quote !== '"' && quote !== "'" && quote !== '`') return null;
  i += 1;
  let out = '';
  let escaped = false;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      out += decodeSimpleEscape(ch);
      escaped = false;
    } else if (ch === '\\') {
      escaped = true;
    } else if (ch === quote) {
      return out;
    } else {
      out += ch;
    }
  }
  return null;
}

function decodeSimpleEscape(ch: string): string {
  if (ch === 'n') return '\n';
  if (ch === 'r') return '\r';
  if (ch === 't') return '\t';
  return ch;
}

function normalizeRescuedWorkspacePath(path: string): string {
  const trimmed = path.trim().replace(/\\/g, '/');
  if (trimmed.startsWith('/workspace/')) return trimmed;
  if (trimmed === '/workspace') return '/workspace';
  return `/workspace/${trimmed.replace(/^\/+/, '')}`;
}

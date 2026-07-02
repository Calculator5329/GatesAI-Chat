import type { LlmChunk, ToolCall } from '../../core/llm';
import { parseJsonObject } from './json';

/*
 * Duplication map before this extraction:
 * - OpenAI tool deltas/finish drain: openaiCompat.ts 124-185.
 * - Ollama tool calls/done mapping: ollama.ts 149-252.
 * - Usage/errors stay local: openaiCompat.ts 136-140/263-287, ollama.ts 174-176/307-320.
 * - No generic loop: SSE framing and Ollama NDJSON trailing/missing-done handling do not fit cleanly.
 */

export type StreamFinishReason = Exclude<NonNullable<Extract<LlmChunk, { type: 'done' }>['finishReason']>, 'cancelled' | 'error'>;

interface ToolCallDeltaSlot { id: string; name: string; argsBuf: string }
export interface ToolCallDeltaState { readonly slots: Map<number, ToolCallDeltaSlot> }

const FINISH_REASON_MAP: Record<string, StreamFinishReason> = {
  stop: 'stop',
  done: 'stop',
  length: 'length',
  max_tokens: 'length',
  max_output_tokens: 'length',
  tool_calls: 'tool_use',
  tool_use: 'tool_use',
  content_filter: 'content_filter',
};

export function createToolCallDeltaState(): ToolCallDeltaState { return { slots: new Map() }; }

export function accumulateToolCallDelta(state: ToolCallDeltaState, fragment: unknown): void {
  const parsed = parseToolCallDeltaFragment(fragment);
  if (!parsed) return;

  const slot = state.slots.get(parsed.index) ?? { id: '', name: '', argsBuf: '' };
  if (parsed.id) slot.id = parsed.id;
  if (parsed.name) slot.name = parsed.name;
  if (parsed.argumentsDelta !== undefined) slot.argsBuf += parsed.argumentsDelta;
  state.slots.set(parsed.index, slot);
}

export function finalizeToolCallDeltas(state: ToolCallDeltaState, makeFallbackId: (name: string) => string = name => `${name}-${Math.random().toString(36).slice(2, 8)}`): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const [, slot] of [...state.slots.entries()].sort(([a], [b]) => a - b)) {
    if (!slot.name) continue;
    const parsedArgs = parseJsonObject(slot.argsBuf);
    calls.push({
      id: slot.id || makeFallbackId(slot.name),
      name: slot.name,
      arguments: parsedArgs.value,
      ...(!parsedArgs.ok ? {
        argumentsError: parsedArgs.error,
        rawArguments: parsedArgs.rawPreview,
      } : {}),
    });
  }
  return calls;
}

export function normalizeFinishReason(providerValue: unknown): StreamFinishReason | undefined {
  if (providerValue == null || providerValue === false) return undefined;
  return providerValue === true
    ? 'stop'
    : typeof providerValue === 'string'
      ? FINISH_REASON_MAP[providerValue]
      : undefined;
}

export function normalizeToolCallArguments(
  raw: unknown,
  invalidMessage: string,
): Pick<ToolCall, 'arguments' | 'argumentsError' | 'rawArguments'> {
  if (raw === undefined || raw === null) return { arguments: {} };
  if (isRecord(raw)) return { arguments: raw };
  return { arguments: {}, argumentsError: invalidMessage, rawArguments: previewValue(raw) };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function finiteNumber(value: unknown, min = Number.NEGATIVE_INFINITY): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= min ? value : undefined;
}

function parseToolCallDeltaFragment(value: unknown): { index: number; id?: string; name?: string; argumentsDelta?: string } | null {
  if (!isRecord(value) || typeof value.index !== 'number' || !Number.isInteger(value.index)) return null;
  const fn = isRecord(value.function) ? value.function : undefined;
  const fnArgs = fn?.arguments;
  const parsed = {
    index: value.index,
    id: typeof value.id === 'string' ? value.id : undefined,
    name: typeof fn?.name === 'string' ? fn.name : typeof value.name === 'string' ? value.name : undefined,
    argumentsDelta: typeof fnArgs === 'string' ? fnArgs : typeof value.arguments === 'string' ? value.arguments : undefined,
  };
  return parsed.id || parsed.name || parsed.argumentsDelta !== undefined ? parsed : null;
}

function previewValue(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    if (json) return json.slice(0, 500);
  } catch { /* ignore */ }
  return String(value).slice(0, 500);
}

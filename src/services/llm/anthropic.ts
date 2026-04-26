import type { LlmChunk, LlmMessage, LlmProvider, LlmRequest, ToolCall, ToolDef } from '../../core/llm';
import { safeJsonObject } from './json';
import { ensureOk, parseSse } from './sse';

interface AnthropicEvent {
  type: string;
  index?: number;
  content_block?: {
    type: 'text' | 'tool_use';
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  };
  delta?: {
    type?: 'text_delta' | 'input_json_delta';
    text?: string;
    partial_json?: string;
    stop_reason?: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';
  };
}

/**
 * Anthropic Messages API. Streams `content_block_*` events.
 *
 * - Text: `content_block_delta` with `delta.type === 'text_delta'`.
 * - Tool calls: `content_block_start` with `content_block.type === 'tool_use'`
 *   carries the tool's `id` and `name`. The arguments stream as
 *   `content_block_delta` with `delta.type === 'input_json_delta'` (a
 *   `partial_json` fragment per chunk). On `content_block_stop` we parse the
 *   accumulated buffer and emit one `tool_call` chunk.
 *
 * The browser-direct path requires the
 * `anthropic-dangerous-direct-browser-access` header.
 */
export class AnthropicProvider implements LlmProvider {
  readonly id = 'anthropic' as const;
  private readonly apiKey?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }

  ready(): boolean { return Boolean(this.apiKey); }

  async *stream(req: LlmRequest, signal: AbortSignal): AsyncIterable<LlmChunk> {
    if (!this.apiKey) {
      yield { type: 'done', finishReason: 'error', error: 'Anthropic key missing' };
      return;
    }

    const { messages, leftoverSystem } = buildAnthropicMessages(req.messages);
    const system = [req.systemPrompt, leftoverSystem].filter(Boolean).join('\n\n') || undefined;

    let response: Response;
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: req.modelId,
          max_tokens: req.maxTokens ?? 4096,
          stream: true,
          ...(system ? { system } : {}),
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
          ...(req.tools && req.tools.length > 0 ? { tools: req.tools.map(toAnthropicTool) } : {}),
          messages,
        }),
      });
    } catch (err) {
      if (signal.aborted) { yield { type: 'done', finishReason: 'cancelled' }; return; }
      yield { type: 'done', finishReason: 'error', error: (err as Error).message };
      return;
    }

    try { await ensureOk(response, 'Anthropic'); }
    catch (err) { yield { type: 'done', finishReason: 'error', error: (err as Error).message }; return; }

    /** Per-block accumulator keyed by Anthropic's `index`. */
    const blocks = new Map<number, { kind: 'text' | 'tool'; toolId?: string; toolName?: string; argsBuf: string }>();
    let finishReason: 'stop' | 'length' | 'tool_use' | undefined;
    try {
      for await (const data of parseSse(response, signal)) {
        let evt: AnthropicEvent;
        try { evt = JSON.parse(data) as AnthropicEvent; } catch { continue; }

        if (evt.type === 'content_block_start' && typeof evt.index === 'number' && evt.content_block) {
          if (evt.content_block.type === 'tool_use') {
            blocks.set(evt.index, {
              kind: 'tool',
              toolId: evt.content_block.id ?? '',
              toolName: evt.content_block.name ?? '',
              argsBuf: '',
            });
          } else {
            blocks.set(evt.index, { kind: 'text', argsBuf: '' });
          }
        } else if (evt.type === 'content_block_delta' && typeof evt.index === 'number') {
          const slot = blocks.get(evt.index);
          if (!slot) continue;
          if (evt.delta?.type === 'text_delta' && evt.delta.text) {
            yield { type: 'text', delta: evt.delta.text };
          } else if (evt.delta?.type === 'input_json_delta' && evt.delta.partial_json) {
            slot.argsBuf += evt.delta.partial_json;
          }
        } else if (evt.type === 'content_block_stop' && typeof evt.index === 'number') {
          const slot = blocks.get(evt.index);
          if (slot && slot.kind === 'tool' && slot.toolName) {
            const call: ToolCall = {
              id: slot.toolId || `${slot.toolName}-${Math.random().toString(36).slice(2, 8)}`,
              name: slot.toolName,
              arguments: safeJsonObject(slot.argsBuf),
            };
            yield { type: 'tool_call', call };
          }
          blocks.delete(evt.index);
        } else if (evt.type === 'message_delta' && evt.delta?.stop_reason) {
          const sr = evt.delta.stop_reason;
          finishReason = sr === 'max_tokens' ? 'length'
            : sr === 'tool_use' ? 'tool_use'
            : 'stop';
        } else if (evt.type === 'message_stop') {
          break;
        }
      }
    } catch (err) {
      if (signal.aborted) { yield { type: 'done', finishReason: 'cancelled' }; return; }
      yield { type: 'done', finishReason: 'error', error: (err as Error).message };
      return;
    }

    yield { type: 'done', finishReason: finishReason ?? 'stop' };
  }
}

function toAnthropicTool(t: ToolDef): { name: string; description: string; input_schema: unknown } {
  return { name: t.name, description: t.description, input_schema: t.parameters };
}

/**
 * Anthropic doesn't accept a `system` role inside `messages` (it lives on
 * the top-level `system` field) and tool results piggy-back on a `user`
 * message with structured content blocks. This translator merges adjacent
 * tool-result messages into a single `user` message per Anthropic's
 * convention, returns any system-role text so the caller can hoist it,
 * and keeps assistant tool_use blocks correctly shaped.
 */
function buildAnthropicMessages(input: LlmMessage[]): {
  messages: Array<{ role: 'user' | 'assistant'; content: unknown }>;
  leftoverSystem: string;
} {
  const out: Array<{ role: 'user' | 'assistant'; content: unknown }> = [];
  const systemTexts: string[] = [];

  for (const m of input) {
    if (m.role === 'system') {
      if (m.content) systemTexts.push(m.content);
      continue;
    }

    if (m.role === 'tool') {
      const block = {
        type: 'tool_result' as const,
        tool_use_id: m.toolCallId ?? '',
        content: m.content,
      };
      const last = out[out.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        (last.content as unknown[]).push(block);
      } else {
        out.push({ role: 'user', content: [block] });
      }
      continue;
    }

    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      const blocks: unknown[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const tc of m.toolCalls) {
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments ?? {} });
      }
      out.push({ role: 'assistant', content: blocks });
      continue;
    }

    if (m.role === 'user' && m.images && m.images.length > 0) {
      const blocks: unknown[] = [];
      for (const img of m.images) {
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: img.mime, data: img.base64 },
        });
      }
      if (m.content) blocks.push({ type: 'text', text: m.content });
      out.push({ role: 'user', content: blocks });
      continue;
    }

    out.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
  }

  return { messages: out, leftoverSystem: systemTexts.join('\n\n') };
}

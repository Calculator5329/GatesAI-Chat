import type { LlmChunk, LlmMessage, LlmProvider, LlmRequest, ToolCall, ToolDef } from '../../core/llm';
import { ensureOk, parseSse } from './sse';

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}
interface GeminiCandidate {
  content?: { parts?: GeminiPart[]; role?: string };
  finishReason?: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | 'OTHER' | 'TOOL_USE';
}
interface GeminiChunk {
  candidates?: GeminiCandidate[];
}

/**
 * Google AI (Gemini) using the streamGenerateContent endpoint with SSE.
 *
 * Tool calls: Gemini emits `parts[].functionCall = { name, args }` (already
 * a parsed object — Google does the JSON assembly server-side, unlike
 * OpenAI/Anthropic). We surface each one as a single `tool_call` chunk.
 *
 * Tool results are sent back on the next request as a part with
 * `functionResponse = { name, response: { result: <string> } }`. Gemini's
 * convention is to wrap the result in a JSON object — we put the raw tool
 * output under `result`.
 */
export class GeminiProvider implements LlmProvider {
  readonly id = 'gemini' as const;
  private readonly apiKey?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }

  ready(): boolean { return Boolean(this.apiKey); }

  async *stream(req: LlmRequest, signal: AbortSignal): AsyncIterable<LlmChunk> {
    if (!this.apiKey) {
      yield { type: 'done', finishReason: 'error', error: 'Gemini key missing' };
      return;
    }

    const contents = buildGeminiContents(req.messages);

    const body: Record<string, unknown> = {
      contents,
      ...(req.systemPrompt
        ? { systemInstruction: { role: 'user', parts: [{ text: req.systemPrompt }] } }
        : {}),
      ...(req.tools && req.tools.length > 0
        ? { tools: [{ functionDeclarations: req.tools.map(toGeminiTool) }] }
        : {}),
    };
    const generationConfig: Record<string, unknown> = {};
    if (req.temperature !== undefined) generationConfig.temperature = req.temperature;
    if (req.maxTokens !== undefined) generationConfig.maxOutputTokens = req.maxTokens;
    if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.modelId)}` +
      `:streamGenerateContent?alt=sse&key=${encodeURIComponent(this.apiKey)}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      if (signal.aborted) { yield { type: 'done', finishReason: 'cancelled' }; return; }
      yield { type: 'done', finishReason: 'error', error: (err as Error).message };
      return;
    }

    try { await ensureOk(response, 'Gemini'); }
    catch (err) { yield { type: 'done', finishReason: 'error', error: (err as Error).message }; return; }

    let finishReason: 'stop' | 'length' | 'tool_use' | undefined;
    try {
      for await (const data of parseSse(response, signal)) {
        let chunk: GeminiChunk;
        try { chunk = JSON.parse(data) as GeminiChunk; } catch { continue; }
        const candidate = chunk.candidates?.[0];
        const parts = candidate?.content?.parts ?? [];
        for (const p of parts) {
          if (p.text) yield { type: 'text', delta: p.text };
          if (p.functionCall?.name) {
            const call: ToolCall = {
              id: `${p.functionCall.name}-${Math.random().toString(36).slice(2, 8)}`,
              name: p.functionCall.name,
              arguments: p.functionCall.args ?? {},
            };
            yield { type: 'tool_call', call };
          }
        }
        const fr = candidate?.finishReason;
        if (fr === 'STOP') finishReason = 'stop';
        else if (fr === 'MAX_TOKENS') finishReason = 'length';
        else if (fr === 'TOOL_USE') finishReason = 'tool_use';
      }
    } catch (err) {
      if (signal.aborted) { yield { type: 'done', finishReason: 'cancelled' }; return; }
      yield { type: 'done', finishReason: 'error', error: (err as Error).message };
      return;
    }

    yield { type: 'done', finishReason: finishReason ?? 'stop' };
  }
}

function toGeminiTool(t: ToolDef): { name: string; description: string; parameters: unknown } {
  return { name: t.name, description: t.description, parameters: t.parameters };
}

/**
 * Translate `LlmMessage[]` into Gemini's `contents` array. Assistant messages
 * with tool calls become `model` parts containing `functionCall`; tool
 * results become `user` parts containing `functionResponse`.
 */
function buildGeminiContents(input: LlmMessage[]): Array<{ role: 'user' | 'model'; parts: GeminiPart[] }> {
  const out: Array<{ role: 'user' | 'model'; parts: GeminiPart[] }> = [];
  for (const m of input) {
    if (m.role === 'system') continue;       // hoisted to systemInstruction by caller
    if (m.role === 'tool') {
      out.push({
        role: 'user',
        parts: [{
          functionResponse: {
            name: m.toolName ?? '',
            response: { result: m.content },
          },
        }],
      });
      continue;
    }
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      const parts: GeminiPart[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const tc of m.toolCalls) {
        parts.push({ functionCall: { name: tc.name, args: tc.arguments ?? {} } });
      }
      out.push({ role: 'model', parts });
      continue;
    }
    out.push({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    });
  }
  return out;
}

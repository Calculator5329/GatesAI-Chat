import type { LlmChunk, LlmMessage, LlmProvider, LlmRequest, ToolCall, ToolDef } from '../../core/llm';
import { logEvent } from '../diagnostics/chatLog';
import { ensureOk, parseSse } from './sse';

interface GeminiPart {
  text?: string;
  thought?: boolean;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  inlineData?: { mimeType: string; data: string };
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
    // Gemini 3.x reserves output-token budget for an internal "thinking" pass.
    // With dynamic thinking (the default) the model can spend the entire
    // maxOutputTokens budget on thoughts and return zero visible text — which
    // is exactly the "Gemini 3 Flash is broken" symptom. Constrain to a low
    // budget for chat so first-token latency stays snappy and replies actually
    // arrive. Callers that want deeper reasoning can opt back in later.
    if (/^gemini-3/.test(req.modelId)) {
      generationConfig.thinkingConfig = { thinkingLevel: 'low' };
    }
    if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.modelId)}` +
      `:streamGenerateContent?alt=sse&key=${encodeURIComponent(this.apiKey)}`;

    logEvent(req.threadId, 'gemini.request', { modelId: req.modelId, body });

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
      logEvent(req.threadId, 'gemini.fetchError', { error: (err as Error).message });
      yield { type: 'done', finishReason: 'error', error: (err as Error).message };
      return;
    }

    logEvent(req.threadId, 'gemini.response', {
      status: response.status,
      contentType: response.headers.get('content-type'),
    });

    try { await ensureOk(response, 'Gemini'); }
    catch (err) {
      logEvent(req.threadId, 'gemini.non2xx', { error: (err as Error).message });
      yield { type: 'done', finishReason: 'error', error: (err as Error).message };
      return;
    }

    let finishReason: 'stop' | 'length' | 'tool_use' | undefined;
    let chunkCount = 0;
    let textChars = 0;
    let lastFinishRaw: string | undefined;
    try {
      for await (const data of parseSse(response, signal)) {
        chunkCount++;
        let chunk: GeminiChunk;
        try { chunk = JSON.parse(data) as GeminiChunk; }
        catch (parseErr) {
          logEvent(req.threadId, 'gemini.badJson', { data: data.slice(0, 500), error: (parseErr as Error).message });
          continue;
        }
        if (chunkCount <= 5) logEvent(req.threadId, 'gemini.chunk', { n: chunkCount, chunk });
        const candidate = chunk.candidates?.[0];
        if (candidate?.finishReason) lastFinishRaw = candidate.finishReason;
        const parts = candidate?.content?.parts ?? [];
        for (const p of parts) {
          // Gemini 3 surfaces reasoning as parts with `thought: true`; skip
          // them so the user sees only the final reply, not internal thoughts.
          if (p.text && !p.thought) { textChars += p.text.length; yield { type: 'text', delta: p.text }; }
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

    logEvent(req.threadId, 'gemini.summary', { chunks: chunkCount, visibleChars: textChars, finishReason: lastFinishRaw });
    if (chunkCount > 0 && textChars === 0) {
      const reason = lastFinishRaw === 'MAX_TOKENS'
        ? 'Gemini returned no visible text (finishReason=MAX_TOKENS — thinking budget likely consumed the entire output budget). Try raising maxTokens or lowering thinkingLevel.'
        : `Gemini returned no visible text (finishReason=${lastFinishRaw ?? 'unset'}). See console [gemini] logs for the raw stream.`;
      yield { type: 'done', finishReason: 'error', error: reason };
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
    if (m.role === 'user' && m.images && m.images.length > 0) {
      const parts: GeminiPart[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const img of m.images) {
        parts.push({ inlineData: { mimeType: img.mime, data: img.base64 } });
      }
      out.push({ role: 'user', parts });
      continue;
    }

    out.push({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    });
  }
  return out;
}

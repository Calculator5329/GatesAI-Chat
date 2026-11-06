/**
 * Live local-model harness (QW-1). Drives a real chat turn through RootStore
 * -> ChatStore -> TurnRunner -> OllamaProvider.stream against the Ollama on
 * 127.0.0.1:11434, with the system prompt and tool set the app assembles for
 * a normal desktop chat. Only Ollama traffic reaches the network; every other
 * fetch (bridge, OpenRouter, ComfyUI) is refused so the run stays local.
 *
 * Skipped unless models are named. It loads multi-GB models onto the GPU, so
 * it is never part of `npm run ci` and is not the paid `npm run test:models`:
 *
 *   GATESAI_OLLAMA_LIVE_MODELS=gemma4-abliterated:26b \
 *     npx vitest run --config vitest.live.config.ts tests/integration/ollamaLocal.live.test.ts
 *
 * The bridge stays offline (its fetches are refused), so the request carries
 * the bridge-offline tool set; bridge-online sizes are estimated offline.
 * Every /api/chat is checked against the model under test before it is
 * sent, so a stray default can never load a different model onto the GPU.
 * The JSON report lands in .tmp/ollama-live/<model>.json (gitignored).
 *
 * Check free VRAM first (`nvidia-smi --query-gpu=memory.free --format=csv`) and run one
 * model at a time; the harness unloads it at the end. A model that needs the whole GPU
 * (qwen3.8-abliterated:27b) goes inside local-ai-lab's `gpu_room.py 14 -- <command>`.
 * Delete .tmp/ollama-live/config.json after a run so the next live-suite run skips this.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { RootStore } from '../../src/stores/RootStore';
import { messageText, messageToolCalls, messageToolResults } from '../../src/core/messageParts';
import { estimateLlmPayloadTokens } from '../../src/core/tokens';
import type { AssistantMessage } from '../../src/core/types';
import type { LlmMessage, ToolDef } from '../../src/core/llm';
import { clearAppStorage } from '../helpers/storage';

const OLLAMA = 'http://127.0.0.1:11434';
const CONFIG_FILE = '.tmp/ollama-live/config.json';

/** Env wins; a gitignored `.tmp/ollama-live/config.json` ({"models": [...]}) is the fallback. */
function liveModels(): string[] {
  const fromEnv = (process.env.GATESAI_OLLAMA_LIVE_MODELS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (fromEnv.length) return fromEnv;
  if (!existsSync(CONFIG_FILE)) return [];
  const parsed = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) as { models?: string[] };
  return parsed.models ?? [];
}

const MODELS = liveModels();
const realFetch = globalThis.fetch.bind(globalThis);
/** The only model a /api/chat may name; anything else is refused before it reaches Ollama. */
let allowedModel: string | null = null;

interface ChatCapture {
  startedAt: number;
  requestBody: Record<string, unknown>;
  status?: number;
  firstThinkingMs?: number;
  firstContentMs?: number;
  firstToolCallMs?: number;
  doneMs?: number;
  thinkingChars: number;
  contentChars: number;
  rawLines: string[];
  doneFrame?: Record<string, unknown>;
}

const captures: ChatCapture[] = [];

function recordLine(capture: ChatCapture, line: string): void {
  capture.rawLines.push(line);
  let frame: Record<string, unknown>;
  try { frame = JSON.parse(line) as Record<string, unknown>; } catch { return; }
  const now = Date.now() - capture.startedAt;
  const message = (frame.message ?? {}) as Record<string, unknown>;
  if (typeof message.thinking === 'string' && message.thinking) {
    capture.thinkingChars += message.thinking.length;
    capture.firstThinkingMs ??= now;
  }
  if (typeof message.content === 'string' && message.content) {
    capture.contentChars += message.content.length;
    capture.firstContentMs ??= now;
  }
  if (Array.isArray(message.tool_calls) && message.tool_calls.length) capture.firstToolCallMs ??= now;
  if (frame.done === true) {
    capture.doneMs = now;
    capture.doneFrame = { ...frame, message: undefined };
  }
}

/** Tees an NDJSON body so the provider still reads it while we time each frame. */
function teeBody(body: ReadableStream<Uint8Array>, capture: ChatCapture): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let buffer = '';
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line) recordLine(capture, line);
      }
      controller.enqueue(chunk);
    },
    flush() { if (buffer.trim()) recordLine(capture, buffer.trim()); },
  }));
}

/**
 * jsdom's AbortSignal is not the class Node's fetch accepts, so the native
 * call goes out without it; an abort rejects the pending call or cancels the
 * body, which closes the connection.
 */
async function nativeFetch(url: string, init: RequestInit | undefined): Promise<Response> {
  const { signal, ...rest } = init ?? {};
  const abortError = () => new DOMException('The operation was aborted.', 'AbortError');
  if (signal?.aborted) throw abortError();
  const pending = realFetch(url, rest);
  if (!signal) return pending;
  const response = await new Promise<Response>((resolve, reject) => {
    signal.addEventListener('abort', () => reject(abortError()), { once: true });
    pending.then(resolve, reject);
  });
  signal.addEventListener('abort', () => { void response.body?.cancel().catch(() => {}); }, { once: true });
  return response;
}

async function harnessFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith(OLLAMA)) throw new Error(`harness: network refused for ${url}`);
  if (!url.endsWith('/api/chat')) {
    // /api/embed would load the embedding model next to the chat model (semantic memory).
    if (/\/api\/(generate|pull|delete|embed|embeddings)$/.test(url)) {
      throw new Error(`harness: refused ${url}`);
    }
    return nativeFetch(url, init);
  }
  const requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
  if (!allowedModel || requestBody.model !== allowedModel) {
    throw new Error(`harness: refused /api/chat for ${String(requestBody.model)} (testing ${String(allowedModel)})`);
  }
  const capture: ChatCapture = {
    startedAt: Date.now(),
    requestBody,
    thinkingChars: 0,
    contentChars: 0,
    rawLines: [],
  };
  captures.push(capture);
  const response = await nativeFetch(url, init);
  capture.status = response.status;
  if (!response.body) return response;
  return new Response(teeBody(response.body, capture), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function ollamaPost(path: string, body: unknown): Promise<unknown> {
  const res = await realFetch(`${OLLAMA}${path}`, { method: 'POST', body: JSON.stringify(body) });
  return res.json();
}

async function unload(model: string): Promise<void> {
  await ollamaPost('/api/generate', { model, keep_alive: 0 });
  for (let i = 0; i < 60; i++) {
    const ps = await (await realFetch(`${OLLAMA}/api/ps`)).json() as { models?: unknown[] };
    if (!ps.models?.length) return;
    await new Promise(r => setTimeout(r, 1000));
  }
}

function summarizeCapture(c: ChatCapture) {
  const body = c.requestBody;
  const messages = (body.messages ?? []) as Array<{ role: string; content: string }>;
  const tools = (body.tools ?? []) as Array<{ function: { name: string; description: string; parameters: ToolDef['parameters'] } }>;
  const system = messages.find(m => m.role === 'system')?.content ?? '';
  const appEstimate = estimateLlmPayloadTokens({
    systemPrompt: system,
    messages: messages.filter(m => m.role !== 'system') as LlmMessage[],
    tools: tools.map(t => ({ name: t.function.name, description: t.function.description, parameters: t.function.parameters })),
    reservedOutputTokens: 0,
  });
  return {
    status: c.status,
    think: body.think,
    options: body.options,
    systemPromptChars: system.length,
    toolNames: tools.map(t => t.function.name),
    toolSchemaChars: JSON.stringify(tools).length,
    messageCount: messages.length,
    appEstimatedPromptTokens: appEstimate,
    promptEvalCount: c.doneFrame?.prompt_eval_count,
    evalCount: c.doneFrame?.eval_count,
    doneReason: c.doneFrame?.done_reason,
    loadDurationMs: typeof c.doneFrame?.load_duration === 'number' ? Math.round(c.doneFrame.load_duration / 1e6) : undefined,
    firstThinkingMs: c.firstThinkingMs,
    firstContentMs: c.firstContentMs,
    firstToolCallMs: c.firstToolCallMs,
    doneMs: c.doneMs,
    thinkingChars: c.thinkingChars,
    contentChars: c.contentChars,
    errorLine: c.rawLines.find(line => line.includes('"error"')),
  };
}

async function runTurn(root: RootStore, threadId: string, modelId: string, text: string) {
  const startedAt = Date.now();
  const before = captures.length;
  let firstVisibleMs: number | undefined;
  let thinkingVisibleMs: number | undefined;
  let thinkingSample: string | undefined;
  // Select through the router like the sidebar does; RootStore syncs the
  // route and the active chat, and a bare selectThread loses to that sync.
  root.router.goThread(threadId);
  await vi.waitFor(() => expect(root.chat.activeThreadId).toBe(threadId), { timeout: 5_000 });
  expect(root.chat.activeThread?.modelId).toBe(modelId);
  const localContext = root.chat.activeLocalContext;
  root.chat.sendMessage(text);
  const assistant = () => {
    const thread = root.chat.threads.find(t => t.id === threadId);
    const last = thread?.messages.at(-1);
    return last?.role === 'assistant' ? last as AssistantMessage : undefined;
  };
  await vi.waitFor(() => {
    const message = assistant();
    if (message && firstVisibleMs === undefined && messageText(message).trim()) firstVisibleMs = Date.now() - startedAt;
    if (message && thinkingVisibleMs === undefined) {
      const live = root.chat.activitiesForMessage(message, { streaming: true });
      const row = live.find(item => item.id.endsWith(':provider-stream') && item.detail?.type === 'markdown' && item.detail.content);
      if (row && row.detail?.type === 'markdown') {
        thinkingVisibleMs = Date.now() - startedAt;
        thinkingSample = `${row.verb}: ${(row.detail.content ?? '').slice(0, 120)}`;
      }
    }
    expect(root.chat.isThreadStreaming(threadId)).toBe(false);
    expect(message).toBeDefined();
  }, { timeout: 600_000, interval: 50 });
  const message = assistant()!;
  return {
    prompt: text,
    localContext,
    wallMs: Date.now() - startedAt,
    thinkingSample,
    appFirstVisibleTextMs: firstVisibleMs,
    appThinkingVisibleMs: thinkingVisibleMs,
    finalText: messageText(message).slice(0, 600),
    finishReason: message.finishReason,
    toolCalls: messageToolCalls(message).map(c => ({ name: c.name, arguments: c.arguments })),
    toolResults: messageToolResults(message).map(r => ({ name: r.toolName, ok: r.ok, content: r.content.slice(0, 200) })),
    workNotes: message.workNotes,
    activities: root.chat.activitiesForMessage(message).map(a => ({ kind: a.kind, verb: a.verb, state: a.state, detailChars: a.detail?.content?.length })),
    usage: message.usage,
    lastError: root.chat.lastError,
    rounds: captures.slice(before).map(summarizeCapture),
  };
}

describe.skipIf(MODELS.length === 0)('live Ollama turn through the GatesAI code path', () => {
  afterAll(() => { vi.unstubAllGlobals(); });

  for (const model of MODELS) {
    it(`${model}: plain answer and one tool round-trip`, async () => {
      clearAppStorage();
      vi.stubGlobal('fetch', vi.fn(harnessFetch));
      allowedModel = model;
      const modelId = `ollama-${model}`;
      const root = new RootStore({ runtime: 'desktop' });
      root.boot();
      // The catalog, then the /api/show window lookup, both arrive asynchronously.
      await vi.waitFor(() => expect(root.ollama.catalog.some(m => m.providerModelId === model)).toBe(true), { timeout: 15_000 });
      await vi.waitFor(() => expect(root.ollama.catalog.find(m => m.providerModelId === model)?.contextLength).toBeDefined(), { timeout: 15_000 })
        .catch(() => { /* no Modelfile num_ctx: the 4096 default applies */ });
      const catalogEntry = root.ollama.catalog.find(m => m.providerModelId === model);
      // Boot applies the stored snapshot asynchronously and can move the
      // active chat afterwards; let it settle before picking threads.
      await new Promise(resolve => setTimeout(resolve, 3_000));

      const report: Record<string, unknown> = { model, catalogEntry, turns: [] };
      const turns = report.turns as unknown[];
      try {
        const chatThread = root.chat.createThread();
        root.chat.setThreadModel(chatThread, modelId);
        turns.push(await runTurn(root, chatThread, modelId, 'In two short sentences: why is the sky blue?'));
        turns.push(await runTurn(root, chatThread, modelId, 'And in one sentence: why are sunsets red?'));

        const toolThread = root.chat.createThread();
        root.chat.setThreadModel(toolThread, modelId);
        turns.push(await runTurn(root, toolThread, modelId, 'Use the thread tool with action "list" to look up my recent chats, then tell me how many there are.'));
      } finally {
        allowedModel = null;
        mkdirSync('.tmp/ollama-live', { recursive: true });
        const file = `.tmp/ollama-live/${model.replace(/[^\w.-]+/g, '_')}.json`;
        writeFileSync(file, JSON.stringify({ ...report, raw: captures.map(c => ({ request: c.requestBody, lines: c.rawLines.slice(0, 4).concat(c.rawLines.slice(-2)) })) }, null, 2));
        process.stdout.write(`\n[ollama-live] ${model}\n${JSON.stringify({ ...report, catalogEntry: undefined }, null, 2)}\n`);
        captures.length = 0;
        root.dispose();
        await unload(model);
      }
    }, 900_000);
  }
});

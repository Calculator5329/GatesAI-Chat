# Ollama Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** First-class local LLMs in the model picker via Ollama — install Ollama, pull a model, see it in the picker, chat with it (tool calls + vision included).

**Architecture:** New dedicated `OllamaProvider` (speaks Ollama's native `/api/chat` NDJSON, not the OpenAI-compat shim) parallel to the existing `local` provider. `OllamaStore` owns base URL, optional auth, status polling, and the `/api/tags` catalog feed into `ModelRegistry`. New `OllamaCard` UI sits in `Settings → API` next to the existing provider cards. The existing "Local endpoint" provider stays untouched for LM Studio / vLLM / llama.cpp.

**Tech Stack:** TypeScript, MobX (`OllamaStore`), Vitest (mock fetch + NDJSON streams), React 19 + `mobx-react-lite` (UI). No new runtime dependencies.

**Reference:** Design doc at `docs/plans/2026-04-26-ollama-integration-design.md`.

---

## Task ordering principle

Bottom-up so each task is independently testable: types → catalog mapping → provider wire format → store → router wiring → UI. Each task ends with a green test run and a commit.

---

## Task 1: Add 'ollama' to ProviderId

**Files:**
- Modify: `src/core/llm.ts:12-18` (ProviderId union)
- Modify: `src/core/llm.ts:114-120` (ProviderConfig — no shape change needed; baseUrl already covers it)
- Modify: `src/stores/ModelRegistry.ts:52-57` (`byProvider()` initializer must list every ProviderId)
- Modify: `src/services/llm/router.ts:26-35` (`buildProviders` will eventually return an OllamaProvider — for this task, stub with the existing `LocalProvider` to keep the type happy; replaced in Task 6)

**Step 1: Extend the type**

```typescript
// src/core/llm.ts
export type ProviderId =
  | 'openrouter'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'groq'
  | 'local'        // OpenAI-compatible local endpoint (LM Studio, vLLM, llama.cpp)
  | 'ollama';      // Native Ollama server (/api/chat, /api/tags)
```

**Step 2: Update `ModelRegistry.byProvider`**

```typescript
// src/stores/ModelRegistry.ts
byProvider(): Record<ProviderId, Model[]> {
  const out: Record<ProviderId, Model[]> = {
    openrouter: [], openai: [], anthropic: [], gemini: [], groq: [], local: [], ollama: [],
  };
  for (const m of this.all) out[m.providerId].push(m);
  return out;
}
```

**Step 3: Stub Ollama provider in `buildProviders`**

```typescript
// src/services/llm/router.ts — temporary stub, replaced in Task 6
export function buildProviders(configs: ProviderConfigs): Record<ProviderId, LlmProvider> {
  return {
    openrouter: new OpenRouterProvider(configs.openrouter?.apiKey),
    openai:     new OpenAiProvider(configs.openai?.apiKey),
    anthropic:  new AnthropicProvider(configs.anthropic?.apiKey),
    gemini:     new GeminiProvider(configs.gemini?.apiKey),
    groq:       new GroqProvider(configs.groq?.apiKey),
    local:      new LocalProvider(configs.local?.baseUrl, configs.local?.apiKey),
    ollama:     new LocalProvider(configs.ollama?.baseUrl, configs.ollama?.apiKey), // Task 6 replaces
  };
}
```

Also update the `canRoute` exclusion at `router.ts:99` and `resolve` path at `router.ts:99` and `resolveOpenRouterFallback` at `router.ts:145` to treat `'ollama'` like `'local'` (no OpenRouter fallback for local models).

```typescript
// router.ts canRoute()
if (id === 'local' || id === 'ollama') {
  if (this.configs[id]?.baseUrl) return true;
  continue;
}

// router.ts resolve()
if (model.providerId !== 'openrouter' && model.providerId !== 'local' && model.providerId !== 'ollama') {

// router.ts resolveOpenRouterFallback()
if (model.providerId === 'openrouter' || model.providerId === 'local' || model.providerId === 'ollama') return null;
```

**Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: clean. The `Record<ProviderId, ...>` exhaustiveness pushes us to update every place a ProviderId map appears — fix any remaining ones the compiler flags.

**Step 5: Run tests**

Run: `npm test`
Expected: all pass (no behavior change yet — `'ollama'` is just routed to a `LocalProvider` stub).

**Step 6: Commit**

```bash
git add src/core/llm.ts src/stores/ModelRegistry.ts src/services/llm/router.ts
git commit -m "feat(ollama): add 'ollama' provider id with stub"
```

---

## Task 2: Catalog mapper — `/api/tags` JSON → Model[]

**Files:**
- Create: `src/services/llm/ollamaCatalog.ts`
- Test: `tests/services/llm/ollamaCatalog.test.ts`
- Modify: `src/core/modelCapabilities.ts` (extend the vision heuristic)

**Step 1: Write the failing test**

```typescript
// tests/services/llm/ollamaCatalog.test.ts
import { describe, expect, it } from 'vitest';
import { mapOllamaTagsToModels } from '../../../src/services/llm/ollamaCatalog';

const TAGS_RESPONSE = {
  models: [
    { name: 'llama3.1:8b-instruct-q4_K_M', model: 'llama3.1:8b-instruct-q4_K_M', size: 4_700_000_000, modified_at: '2026-04-20T00:00:00Z' },
    { name: 'gemma2:9b', model: 'gemma2:9b', size: 5_400_000_000, modified_at: '2026-04-20T00:00:00Z' },
    { name: 'llama3.2-vision:11b', model: 'llama3.2-vision:11b', size: 7_900_000_000, modified_at: '2026-04-20T00:00:00Z' },
    { name: 'qwen2.5:7b', model: 'qwen2.5:7b', size: 4_400_000_000, modified_at: '2026-04-20T00:00:00Z' },
  ],
};

describe('mapOllamaTagsToModels', () => {
  it('maps each tag into a Model with stable id and providerId', () => {
    const out = mapOllamaTagsToModels(TAGS_RESPONSE);
    expect(out).toHaveLength(4);
    const llama = out.find(m => m.providerModelId === 'llama3.1:8b-instruct-q4_K_M');
    expect(llama).toMatchObject({
      id: 'ollama-llama3.1:8b-instruct-q4_K_M',
      providerId: 'ollama',
      providerModelId: 'llama3.1:8b-instruct-q4_K_M',
      name: 'llama3.1:8b-instruct-q4_K_M',
      vendor: 'Ollama',
      dynamic: true,
    });
  });

  it('marks vision models with supportsVision: true', () => {
    const out = mapOllamaTagsToModels(TAGS_RESPONSE);
    expect(out.find(m => m.providerModelId === 'llama3.2-vision:11b')?.supportsVision).toBe(true);
    expect(out.find(m => m.providerModelId === 'llama3.1:8b-instruct-q4_K_M')?.supportsVision).toBe(false);
  });

  it('marks known-bad tool families with supportsTools: false', () => {
    const out = mapOllamaTagsToModels(TAGS_RESPONSE);
    expect(out.find(m => m.providerModelId === 'gemma2:9b')?.supportsTools).toBe(false);
    expect(out.find(m => m.providerModelId === 'qwen2.5:7b')?.supportsTools).toBe(true);
  });

  it('returns [] when the response is malformed', () => {
    expect(mapOllamaTagsToModels(null)).toEqual([]);
    expect(mapOllamaTagsToModels({})).toEqual([]);
    expect(mapOllamaTagsToModels({ models: 'not-an-array' })).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/services/llm/ollamaCatalog.test.ts`
Expected: FAIL — module not found.

**Step 3: Add `supportsTools` to the Model interface**

```typescript
// src/core/types.ts — alongside supportsVision near line 167
/**
 * Whether this model is known to handle tool calls reliably. When unset,
 * callers should default to "yes" — false means the catalog flagged it as
 * known-bad. Used today for Ollama models where tool support varies wildly
 * between families.
 */
supportsTools?: boolean;
```

**Step 4: Extend the vision heuristic**

```typescript
// src/core/modelCapabilities.ts — extend the existing pattern list
// Add Ollama-specific vision tags:
//   llava, *-vision, llama3.2-vision, bakllava, moondream, minicpm-v
```

(Read the existing file first — append to the matchers it already has rather than duplicating logic.)

**Step 5: Implement the mapper**

```typescript
// src/services/llm/ollamaCatalog.ts
import type { Model } from '../../core/types';
import { modelSupportsVision } from '../../core/modelCapabilities';

interface OllamaTag {
  name: string;
  model?: string;
  size?: number;
  modified_at?: string;
}

interface OllamaTagsResponse {
  models: OllamaTag[];
}

/**
 * Tag families we know don't handle tool calls well in Ollama as of
 * Ollama 0.3+. Conservative — false positives just mean a working tool
 * model is briefly mis-flagged, which the user can override globally.
 */
const TOOL_BLOCKLIST = [/^gemma/i, /^phi[0-9]?:/i, /^codellama/i];

function isOllamaTagsResponse(v: unknown): v is OllamaTagsResponse {
  if (!v || typeof v !== 'object') return false;
  const arr = (v as { models?: unknown }).models;
  return Array.isArray(arr);
}

export function mapOllamaTagsToModels(raw: unknown): Model[] {
  if (!isOllamaTagsResponse(raw)) return [];
  const out: Model[] = [];
  for (const tag of raw.models) {
    if (!tag || typeof tag.name !== 'string' || !tag.name) continue;
    const providerModelId = tag.name;
    out.push({
      id: `ollama-${providerModelId}`,
      providerId: 'ollama',
      providerModelId,
      name: providerModelId,
      vendor: 'Ollama',
      dynamic: true,
      supportsVision: modelSupportsVision({ providerModelId } as Model),
      supportsTools: !TOOL_BLOCKLIST.some(re => re.test(providerModelId)),
    });
  }
  return out;
}
```

**Step 6: Run tests**

Run: `npm test -- tests/services/llm/ollamaCatalog.test.ts`
Expected: PASS (4 tests).

**Step 7: Run full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass.

**Step 8: Commit**

```bash
git add src/services/llm/ollamaCatalog.ts tests/services/llm/ollamaCatalog.test.ts src/core/types.ts src/core/modelCapabilities.ts
git commit -m "feat(ollama): catalog mapper for /api/tags"
```

---

## Task 3: OllamaProvider — request shape

**Files:**
- Create: `src/services/llm/ollama.ts`
- Test: `tests/services/llm/ollama.test.ts`

This task covers the request side only — building the body and headers. Streaming response parsing comes in Task 4.

**Step 1: Write the failing test**

```typescript
// tests/services/llm/ollama.test.ts
import { describe, expect, it, vi } from 'vitest';
import { OllamaProvider } from '../../../src/services/llm/ollama';

function captureRequest(): { fetchMock: ReturnType<typeof vi.fn>; getBody: () => any } {
  let lastBody: any = null;
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    lastBody = init.body ? JSON.parse(init.body as string) : null;
    return {
      ok: true,
      headers: new Headers({ 'content-type': 'application/x-ndjson' }),
      body: emptyStream(),
    } as unknown as Response;
  });
  return { fetchMock, getBody: () => lastBody };
}

function emptyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(c) { c.close(); } });
}

describe('OllamaProvider — request shape', () => {
  it('POSTs to <baseUrl>/api/chat with stream:true', async () => {
    const { fetchMock, getBody } = captureRequest();
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OllamaProvider({ baseUrl: 'http://127.0.0.1:11434' });

    const iter = provider.stream(
      { modelId: 'llama3.1:8b', messages: [{ role: 'user', content: 'hi' }] },
      new AbortController().signal,
    );
    for await (const _ of iter) { /* drain */ }

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/chat',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = getBody();
    expect(body.model).toBe('llama3.1:8b');
    expect(body.stream).toBe(true);
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    vi.unstubAllGlobals();
  });

  it('passes Authorization header only when apiKey is set', async () => {
    const { fetchMock } = captureRequest();
    vi.stubGlobal('fetch', fetchMock);

    const noKey = new OllamaProvider({ baseUrl: 'http://h:1' });
    for await (const _ of noKey.stream({ modelId: 'm', messages: [] }, new AbortController().signal)) { /* */ }
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).not.toHaveProperty('Authorization');

    fetchMock.mockClear();
    const withKey = new OllamaProvider({ baseUrl: 'http://h:1', apiKey: 'k' });
    for await (const _ of withKey.stream({ modelId: 'm', messages: [] }, new AbortController().signal)) { /* */ }
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer k');
    vi.unstubAllGlobals();
  });

  it('rewrites user images into the messages[].images base64 array', async () => {
    const { fetchMock, getBody } = captureRequest();
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OllamaProvider({ baseUrl: 'http://h:1' });

    const iter = provider.stream(
      { modelId: 'llava', messages: [{
        role: 'user',
        content: 'what is this',
        images: [{ mime: 'image/png', base64: 'ABCD' }],
      }] },
      new AbortController().signal,
    );
    for await (const _ of iter) { /* */ }

    const body = getBody();
    expect(body.messages[0].images).toEqual(['ABCD']);
    expect(body.messages[0].content).toBe('what is this');
    vi.unstubAllGlobals();
  });

  it('forwards tools when provided', async () => {
    const { fetchMock, getBody } = captureRequest();
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OllamaProvider({ baseUrl: 'http://h:1' });

    const tools = [{
      name: 'get_time',
      description: 'Returns the current time',
      parameters: { type: 'object' as const, properties: {}, required: [] },
    }];
    const iter = provider.stream(
      { modelId: 'qwen2.5', messages: [{ role: 'user', content: 'x' }], tools },
      new AbortController().signal,
    );
    for await (const _ of iter) { /* */ }

    const body = getBody();
    expect(body.tools).toEqual([{
      type: 'function',
      function: { name: 'get_time', description: 'Returns the current time', parameters: { type: 'object', properties: {}, required: [] } },
    }]);
    vi.unstubAllGlobals();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/services/llm/ollama.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement the request side**

```typescript
// src/services/llm/ollama.ts
import type { LlmChunk, LlmMessage, LlmProvider, LlmRequest, ToolDef } from '../../core/llm';

export interface OllamaProviderOptions {
  baseUrl: string;
  apiKey?: string;
}

interface OllamaWireMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  images?: string[];
  tool_calls?: Array<{
    function: { name: string; arguments: Record<string, unknown> };
  }>;
}

/**
 * Ollama provider. Speaks Ollama's native NDJSON `/api/chat` rather than the
 * OpenAI-compatible `/v1/chat/completions` shim because we want:
 *   - the proper streaming tool-call format
 *   - native `keep_alive` so the model isn't reloaded between turns
 *   - native `images` field on user messages (different shape than OpenAI parts)
 */
export class OllamaProvider implements LlmProvider {
  readonly id = 'ollama' as const;
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(opts: OllamaProviderOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
  }

  ready(): boolean {
    return Boolean(this.baseUrl);
  }

  async *stream(req: LlmRequest, signal: AbortSignal): AsyncIterable<LlmChunk> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const body = {
      model: req.modelId,
      messages: this.buildMessages(req.messages, req.systemPrompt),
      stream: true,
      keep_alive: '5m',
      ...(req.tools && req.tools.length ? { tools: req.tools.map(toOllamaTool) } : {}),
      ...(typeof req.temperature === 'number' ? { options: { temperature: req.temperature } } : {}),
    };

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      yield { type: 'done', finishReason: 'error', error: `Ollama ${response.status}` };
      return;
    }
    if (!response.body) {
      yield { type: 'done', finishReason: 'error', error: 'Ollama: empty response body' };
      return;
    }

    yield* this.parseNdjson(response.body, signal);
  }

  private buildMessages(messages: LlmMessage[], systemPrompt: string | undefined): OllamaWireMessage[] {
    const out: OllamaWireMessage[] = [];
    if (systemPrompt && systemPrompt.trim()) out.push({ role: 'system', content: systemPrompt });
    for (const m of messages) {
      const wire: OllamaWireMessage = { role: m.role, content: m.content };
      if (m.role === 'user' && m.images && m.images.length) {
        wire.images = m.images.map(img => img.base64);
      }
      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length) {
        wire.tool_calls = m.toolCalls.map(c => ({
          function: { name: c.name, arguments: c.arguments },
        }));
      }
      out.push(wire);
    }
    return out;
  }

  // Stub — replaced in Task 4.
  private async *parseNdjson(_body: ReadableStream<Uint8Array>, _signal: AbortSignal): AsyncIterable<LlmChunk> {
    yield { type: 'done', finishReason: 'stop' };
  }
}

function toOllamaTool(t: ToolDef): unknown {
  return {
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  };
}
```

**Step 4: Run tests**

Run: `npm test -- tests/services/llm/ollama.test.ts`
Expected: all 4 PASS.

**Step 5: Commit**

```bash
git add src/services/llm/ollama.ts tests/services/llm/ollama.test.ts
git commit -m "feat(ollama): provider request shape (no streaming yet)"
```

---

## Task 4: OllamaProvider — NDJSON streaming response

**Files:**
- Modify: `src/services/llm/ollama.ts` (replace `parseNdjson` stub)
- Modify: `tests/services/llm/ollama.test.ts` (add streaming tests)

**Ollama wire format reference:**

Each line of the response is a JSON object. Text streams arrive as:
```
{"model":"llama","created_at":"...","message":{"role":"assistant","content":"Hello"},"done":false}
{"model":"llama","created_at":"...","message":{"role":"assistant","content":" world"},"done":false}
{"model":"llama","created_at":"...","message":{"role":"assistant","content":""},"done":true,"done_reason":"stop"}
```

Tool calls arrive in the final non-done frame as a fully-buffered list:
```
{"model":"qwen","message":{"role":"assistant","content":"","tool_calls":[{"function":{"name":"get_time","arguments":{}}}]},"done":false}
{"model":"qwen","done":true,"done_reason":"stop"}
```

**Step 1: Write the failing tests**

```typescript
// Append to tests/services/llm/ollama.test.ts

function ndjsonResponse(lines: string[]): Response {
  const enc = new TextEncoder();
  return {
    ok: true,
    headers: new Headers({ 'content-type': 'application/x-ndjson' }),
    body: new ReadableStream<Uint8Array>({
      start(c) {
        for (const line of lines) c.enqueue(enc.encode(line + '\n'));
        c.close();
      },
    }),
  } as unknown as Response;
}

describe('OllamaProvider — streaming response', () => {
  it('emits text chunks as message.content arrives', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ndjsonResponse([
      JSON.stringify({ message: { role: 'assistant', content: 'Hello' }, done: false }),
      JSON.stringify({ message: { role: 'assistant', content: ' world' }, done: false }),
      JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' }),
    ])));
    const p = new OllamaProvider({ baseUrl: 'http://h:1' });
    const chunks = [];
    for await (const c of p.stream({ modelId: 'm', messages: [] }, new AbortController().signal)) chunks.push(c);
    expect(chunks).toEqual([
      { type: 'text', delta: 'Hello' },
      { type: 'text', delta: ' world' },
      { type: 'done', finishReason: 'stop' },
    ]);
    vi.unstubAllGlobals();
  });

  it('emits tool_call chunks with synthesized ids', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ndjsonResponse([
      JSON.stringify({ message: { role: 'assistant', content: '', tool_calls: [
        { function: { name: 'get_time', arguments: {} } },
        { function: { name: 'note', arguments: { text: 'hi' } } },
      ] }, done: false }),
      JSON.stringify({ done: true, done_reason: 'stop' }),
    ])));
    const p = new OllamaProvider({ baseUrl: 'http://h:1' });
    const chunks = [];
    for await (const c of p.stream({ modelId: 'm', messages: [] }, new AbortController().signal)) chunks.push(c);
    expect(chunks).toContainEqual({ type: 'tool_call', call: { id: 'ollama-tool-0', name: 'get_time', arguments: {} } });
    expect(chunks).toContainEqual({ type: 'tool_call', call: { id: 'ollama-tool-1', name: 'note', arguments: { text: 'hi' } } });
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done', finishReason: 'tool_use' });
    vi.unstubAllGlobals();
  });

  it('surfaces Ollama JSON error frames', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ndjsonResponse([
      JSON.stringify({ error: "model 'foo' not found, try pulling it first" }),
    ])));
    const p = new OllamaProvider({ baseUrl: 'http://h:1' });
    const chunks = [];
    for await (const c of p.stream({ modelId: 'foo', messages: [] }, new AbortController().signal)) chunks.push(c);
    expect(chunks[chunks.length - 1]).toEqual({
      type: 'done',
      finishReason: 'error',
      error: "model 'foo' not found, try pulling it first",
    });
    vi.unstubAllGlobals();
  });

  it('handles split lines across reads', async () => {
    const enc = new TextEncoder();
    const part1 = JSON.stringify({ message: { role: 'assistant', content: 'Hel' }, done: false }) + '\n' + JSON.stringify({ message: { role: 'assistant', content: 'lo' }, done: false }).slice(0, 10);
    const part2 = JSON.stringify({ message: { role: 'assistant', content: 'lo' }, done: false }).slice(10) + '\n' + JSON.stringify({ done: true, done_reason: 'stop' }) + '\n';

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: new Headers(),
      body: new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(enc.encode(part1));
          c.enqueue(enc.encode(part2));
          c.close();
        },
      }),
    } as unknown as Response)));
    const p = new OllamaProvider({ baseUrl: 'http://h:1' });
    const chunks = [];
    for await (const c of p.stream({ modelId: 'm', messages: [] }, new AbortController().signal)) chunks.push(c);
    const text = chunks.filter(c => c.type === 'text').map(c => c.delta).join('');
    expect(text).toBe('Hello');
    vi.unstubAllGlobals();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/services/llm/ollama.test.ts`
Expected: 4 new tests FAIL (parseNdjson stub returns done:'stop' immediately).

**Step 3: Implement NDJSON parsing**

```typescript
// src/services/llm/ollama.ts — replace the parseNdjson stub

private async *parseNdjson(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncIterable<LlmChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let toolUseSeen = false;

  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;

        let frame: OllamaStreamFrame;
        try {
          frame = JSON.parse(line);
        } catch {
          continue; // skip malformed line
        }

        if (frame.error) {
          yield { type: 'done', finishReason: 'error', error: frame.error };
          return;
        }

        const message = frame.message;
        if (message?.content) {
          yield { type: 'text', delta: message.content };
        }

        if (message?.tool_calls && message.tool_calls.length) {
          for (let i = 0; i < message.tool_calls.length; i++) {
            const tc = message.tool_calls[i];
            const args = tc.function?.arguments && typeof tc.function.arguments === 'object'
              ? tc.function.arguments
              : {};
            yield {
              type: 'tool_call',
              call: {
                id: `ollama-tool-${i}`,
                name: tc.function?.name ?? 'unknown',
                arguments: args as Record<string, unknown>,
              },
            };
          }
          toolUseSeen = true;
        }

        if (frame.done) {
          yield { type: 'done', finishReason: toolUseSeen ? 'tool_use' : 'stop' };
          return;
        }
      }
    }
    if (signal.aborted) {
      yield { type: 'done', finishReason: 'cancelled' };
    }
  } finally {
    reader.releaseLock();
  }
}
```

Add the supporting type alongside the wire-message type:

```typescript
interface OllamaStreamFrame {
  message?: {
    role?: string;
    content?: string;
    tool_calls?: Array<{
      function?: { name?: string; arguments?: Record<string, unknown> };
    }>;
  };
  done?: boolean;
  done_reason?: string;
  error?: string;
}
```

**Step 4: Run tests**

Run: `npm test -- tests/services/llm/ollama.test.ts`
Expected: all PASS.

**Step 5: Commit**

```bash
git add src/services/llm/ollama.ts tests/services/llm/ollama.test.ts
git commit -m "feat(ollama): NDJSON streaming with tool calls and errors"
```

---

## Task 5: OllamaStore — config, status, catalog

**Files:**
- Create: `src/services/ollamaStorage.ts` (localStorage adapter)
- Create: `src/stores/OllamaStore.ts`
- Test: `tests/stores/OllamaStore.test.ts`
- Modify: `src/stores/context.tsx` (add `useOllamaStore` hook)
- Modify: `src/stores/RootStore.ts` (instantiate)

**Step 1: Storage adapter**

```typescript
// src/services/ollamaStorage.ts
import type { Model } from '../core/types';

const KEY = 'gatesai.ollama.v1';

export interface OllamaPersistedConfig {
  baseUrl: string;
  apiKey?: string;
  toolsEnabled: boolean;
  catalog: Model[];
  lastRefreshAt: number | null;
}

export const OLLAMA_DEFAULTS: OllamaPersistedConfig = {
  baseUrl: 'http://127.0.0.1:11434',
  apiKey: undefined,
  toolsEnabled: true,
  catalog: [],
  lastRefreshAt: null,
};

export function loadOllamaConfig(): OllamaPersistedConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...OLLAMA_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<OllamaPersistedConfig>;
    return { ...OLLAMA_DEFAULTS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch {
    return { ...OLLAMA_DEFAULTS };
  }
}

export function saveOllamaConfig(c: OllamaPersistedConfig): void {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* ignore */ }
}

export function clearOllamaConfig(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
```

**Step 2: Write the failing store test**

```typescript
// tests/stores/OllamaStore.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OllamaStore } from '../../src/stores/OllamaStore';
import { ModelRegistry } from '../../src/stores/ModelRegistry';
import { clearAppStorage } from '../helpers/storage';

const TAGS_OK = {
  models: [{ name: 'llama3.1:8b', model: 'llama3.1:8b', size: 4.7e9, modified_at: '2026-04-20T00:00:00Z' }],
};

describe('OllamaStore', () => {
  beforeEach(() => clearAppStorage());
  afterEach(() => { clearAppStorage(); vi.unstubAllGlobals(); });

  it('starts with default base URL and empty catalog', () => {
    const store = new OllamaStore(new ModelRegistry());
    expect(store.config.baseUrl).toBe('http://127.0.0.1:11434');
    expect(store.catalog).toEqual([]);
    expect(store.state).toBe('unknown');
  });

  it('refresh() hits /api/tags and pushes models into the registry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => TAGS_OK }) as Response));
    const reg = new ModelRegistry();
    const store = new OllamaStore(reg);
    await store.refresh();
    expect(store.catalog).toHaveLength(1);
    expect(store.state).toBe('online');
    expect(store.lastError).toBeUndefined();
    expect(reg.all.some(m => m.providerId === 'ollama' && m.providerModelId === 'llama3.1:8b')).toBe(true);
  });

  it('refresh() captures network errors and flips state to offline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const store = new OllamaStore(new ModelRegistry());
    await store.refresh();
    expect(store.state).toBe('offline');
    expect(store.lastError).toMatch(/ECONNREFUSED/);
    // Catalog stays at last cached value (empty here, but the principle is tested via Task-5 second store hydration below).
  });

  it('persists config and catalog; new store rehydrates without a fetch', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => TAGS_OK }) as Response));
    const reg = new ModelRegistry();
    const store = new OllamaStore(reg);
    await store.refresh();

    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('should not be called'); }));
    const reg2 = new ModelRegistry();
    const store2 = new OllamaStore(reg2);
    expect(store2.catalog).toHaveLength(1);
    expect(reg2.all.some(m => m.providerId === 'ollama')).toBe(true);
  });

  it('setBaseUrl / setKey / setToolsEnabled mutate config', () => {
    const store = new OllamaStore(new ModelRegistry());
    store.setBaseUrl('http://10.0.0.5:11434/');
    expect(store.config.baseUrl).toBe('http://10.0.0.5:11434');
    store.setKey('hunter2');
    expect(store.config.apiKey).toBe('hunter2');
    store.setKey('');
    expect(store.config.apiKey).toBeUndefined();
    store.setToolsEnabled(false);
    expect(store.config.toolsEnabled).toBe(false);
  });

  it('clearCatalog() empties the registry slice and storage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => TAGS_OK }) as Response));
    const reg = new ModelRegistry();
    const store = new OllamaStore(reg);
    await store.refresh();
    store.clearCatalog();
    expect(store.catalog).toEqual([]);
    expect(reg.all.some(m => m.providerId === 'ollama')).toBe(false);
  });
});
```

**Step 3: Run test to verify it fails**

Run: `npm test -- tests/stores/OllamaStore.test.ts`
Expected: FAIL — module not found.

**Step 4: Implement the store**

```typescript
// src/stores/OllamaStore.ts
import { autorun, makeAutoObservable, runInAction, toJS } from 'mobx';
import type { Model } from '../core/types';
import { mapOllamaTagsToModels } from '../services/llm/ollamaCatalog';
import {
  loadOllamaConfig,
  saveOllamaConfig,
  type OllamaPersistedConfig,
} from '../services/ollamaStorage';
import type { ModelRegistry } from './ModelRegistry';

export type OllamaState = 'unknown' | 'online' | 'offline';

/**
 * Owns the Ollama base URL, optional auth, status state, and the locally-
 * pulled model catalog (fed into ModelRegistry under providerId 'ollama').
 *
 * Status polling is driven externally — the OllamaCard mounts a hook that
 * calls startStatusPoll on mount and stopStatusPoll on unmount. We don't
 * poll from the constructor because the user might not be on the API
 * panel and we don't want to spam a (possibly off) local server.
 */
export class OllamaStore {
  config: { baseUrl: string; apiKey: string | undefined; toolsEnabled: boolean };
  catalog: Model[] = [];
  lastRefreshAt: number | null = null;
  fetching = false;
  state: OllamaState = 'unknown';
  lastError: string | undefined;

  private readonly registry: ModelRegistry;
  private inflight: AbortController | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private subscribers = 0;

  constructor(registry: ModelRegistry) {
    this.registry = registry;
    const persisted = loadOllamaConfig();
    this.config = {
      baseUrl: persisted.baseUrl,
      apiKey: persisted.apiKey,
      toolsEnabled: persisted.toolsEnabled,
    };
    this.catalog = persisted.catalog;
    this.lastRefreshAt = persisted.lastRefreshAt;
    if (this.catalog.length) registry.setDynamicForProvider('ollama', this.catalog);

    makeAutoObservable<this, 'registry' | 'inflight' | 'pollTimer' | 'subscribers'>(this, {
      registry: false, inflight: false, pollTimer: false, subscribers: false,
    });

    autorun(() => {
      const snap: OllamaPersistedConfig = {
        baseUrl: this.config.baseUrl,
        apiKey: this.config.apiKey,
        toolsEnabled: this.config.toolsEnabled,
        catalog: toJS(this.catalog),
        lastRefreshAt: this.lastRefreshAt,
      };
      saveOllamaConfig(snap);
    });
  }

  get count(): number { return this.catalog.length; }

  setBaseUrl(url: string): void {
    const trimmed = url.trim().replace(/\/+$/, '');
    this.config = { ...this.config, baseUrl: trimmed || 'http://127.0.0.1:11434' };
  }

  setKey(key: string): void {
    const trimmed = key.trim();
    this.config = { ...this.config, apiKey: trimmed || undefined };
  }

  setToolsEnabled(v: boolean): void {
    this.config = { ...this.config, toolsEnabled: v };
  }

  async refresh(): Promise<void> {
    if (this.inflight) this.inflight.abort();
    const ctrl = new AbortController();
    this.inflight = ctrl;
    runInAction(() => { this.fetching = true; this.lastError = undefined; });

    try {
      const headers: Record<string, string> = {};
      if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;
      const resp = await fetch(`${this.config.baseUrl}/api/tags`, { headers, signal: ctrl.signal });
      if (!resp.ok) throw new Error(`Ollama ${resp.status}`);
      const json = await resp.json() as unknown;
      if (ctrl.signal.aborted) return;
      const models = mapOllamaTagsToModels(json);
      runInAction(() => {
        this.catalog = models;
        this.lastRefreshAt = Date.now();
        this.state = 'online';
        this.fetching = false;
        this.registry.setDynamicForProvider('ollama', models);
      });
    } catch (err) {
      if (ctrl.signal.aborted) return;
      runInAction(() => {
        this.state = 'offline';
        this.lastError = err instanceof Error ? err.message : String(err);
        this.fetching = false;
      });
    } finally {
      if (this.inflight === ctrl) this.inflight = null;
    }
  }

  clearCatalog(): void {
    if (this.inflight) { this.inflight.abort(); this.inflight = null; }
    this.catalog = [];
    this.lastRefreshAt = null;
    this.lastError = undefined;
    this.fetching = false;
    this.registry.clearDynamicForProvider('ollama');
  }

  /** Ref-counted status poll. Caller pairs each start with one stop. */
  startStatusPoll(intervalMs = 30_000): void {
    this.subscribers++;
    if (this.pollTimer) return;
    void this.refresh();
    this.pollTimer = setInterval(() => { void this.refresh(); }, intervalMs);
  }

  stopStatusPoll(): void {
    if (this.subscribers > 0) this.subscribers--;
    if (this.subscribers === 0 && this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
```

**Step 5: Wire context + RootStore**

```typescript
// src/stores/context.tsx
import type { OllamaStore } from './OllamaStore';
// …
export function useOllamaStore(): OllamaStore {
  return useRootStore().ollama;
}
```

```typescript
// src/stores/RootStore.ts — add field, instantiate after openrouter
readonly ollama: OllamaStore;
// …
this.ollama = new OllamaStore(this.registry);
```

**Step 6: Run tests**

Run: `npm test -- tests/stores/OllamaStore.test.ts`
Expected: all PASS.

Run: `npm test`
Expected: full suite green.

**Step 7: Commit**

```bash
git add src/services/ollamaStorage.ts src/stores/OllamaStore.ts src/stores/RootStore.ts src/stores/context.tsx tests/stores/OllamaStore.test.ts
git commit -m "feat(ollama): OllamaStore with status, catalog, persistence"
```

---

## Task 6: Wire OllamaProvider into the router

**Files:**
- Modify: `src/services/llm/router.ts:26-35` (replace stub with real `OllamaProvider`)
- Modify: `src/services/llm/index.ts` (re-export `OllamaProvider` if anything else references named exports — check first)
- Modify: `src/stores/ProviderStore.ts` (no change expected, but the autorun must still run when ollama config changes — verify)
- Test: existing `tests/services/llm/ollama.test.ts` already covers the provider; `tests/stores/ProviderStore.test.ts` covers the wiring.

The catch: today `LlmRouter` reads provider config from `ProviderConfigs`. Ollama's base URL / key live in `OllamaStore`, not in `gatesai.providers.v1`. We have two options:

**Option A (chosen):** mirror `OllamaStore.config` into `ProviderConfigs.ollama` via an autorun in RootStore. The existing `ProviderStore.router.updateConfigs` autorun then naturally rebuilds providers when the user changes the Ollama URL. Keeps `LlmRouter` ignorant of `OllamaStore`.

**Option B:** pass `OllamaStore` into `LlmRouter`. Tighter coupling, more invasive.

Implementing A:

**Step 1: Mirror Ollama config into ProviderConfigs**

```typescript
// src/stores/RootStore.ts — after `this.ollama = new OllamaStore(this.registry);`
// Mirror Ollama config into ProviderConfigs so LlmRouter sees baseUrl/apiKey
// updates without knowing about OllamaStore directly.
autorun(() => {
  this.providers.setBaseUrl('ollama', this.ollama.config.baseUrl);
  this.providers.setKey('ollama', this.ollama.config.apiKey ?? '');
});
```

**Step 2: Replace the stub in `buildProviders`**

```typescript
// src/services/llm/router.ts
import { OllamaProvider } from './ollama';
// …
ollama: new OllamaProvider({
  baseUrl: configs.ollama?.baseUrl ?? 'http://127.0.0.1:11434',
  apiKey: configs.ollama?.apiKey,
}),
```

**Step 3: Drop tools when toolsEnabled is false**

The Ollama "tools off" toggle and the per-model `supportsTools: false` need to suppress `LlmRequest.tools` for Ollama turns. The cleanest seam is in `ChatStore.runTurn` where the request is composed — but that file is large. Instead, gate it at the provider:

```typescript
// src/services/llm/ollama.ts — inside stream(), before building the body:
const tools = req.tools ?? [];
const honored = this.toolsAllowed(req.modelId) ? tools : [];
// then use `honored` instead of `req.tools` when building body.
```

Where does `toolsAllowed` get the global toggle? Pass it in via constructor opts:

```typescript
// src/services/llm/ollama.ts
export interface OllamaProviderOptions {
  baseUrl: string;
  apiKey?: string;
  /** When false, drop tools from every request. Per-model overrides via supportsTools live elsewhere. */
  toolsEnabled?: boolean;
}
```

And the per-model flag is read by `ChatStore` via the registry — but to keep this task small and avoid touching ChatStore, **scope the per-model `supportsTools: false` enforcement to a follow-up** (Task 8). For Task 6, only the global toggle ships.

To pipe `toolsEnabled` through the router:

```typescript
// src/core/llm.ts — extend ProviderConfig
export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  /** Ollama-specific: drop tools from every request when false. */
  toolsEnabled?: boolean;
}
```

```typescript
// src/stores/RootStore.ts — extend the mirror autorun
autorun(() => {
  this.providers.configs.ollama = {
    baseUrl: this.ollama.config.baseUrl,
    apiKey: this.ollama.config.apiKey,
    toolsEnabled: this.ollama.config.toolsEnabled,
  };
});
```

(Assigning the whole config object directly; `ProviderStore.setBaseUrl` / `setKey` don't have a `setToolsEnabled` and we don't need one outside Ollama.)

```typescript
// src/services/llm/router.ts
ollama: new OllamaProvider({
  baseUrl: configs.ollama?.baseUrl ?? 'http://127.0.0.1:11434',
  apiKey: configs.ollama?.apiKey,
  toolsEnabled: configs.ollama?.toolsEnabled !== false,
}),
```

**Step 4: Add a test for the toolsEnabled override**

```typescript
// tests/services/llm/ollama.test.ts — append
it('drops tools from the request when toolsEnabled is false', async () => {
  const { fetchMock, getBody } = captureRequest();
  vi.stubGlobal('fetch', fetchMock);
  const provider = new OllamaProvider({ baseUrl: 'http://h:1', toolsEnabled: false });

  const tools = [{ name: 't', description: 'd', parameters: { type: 'object' as const, properties: {}, required: [] } }];
  for await (const _ of provider.stream({ modelId: 'm', messages: [], tools }, new AbortController().signal)) { /* */ }

  const body = getBody();
  expect(body).not.toHaveProperty('tools');
  vi.unstubAllGlobals();
});
```

**Step 5: Update the provider to honor it**

```typescript
// src/services/llm/ollama.ts
private toolsEnabled: boolean;
constructor(opts: OllamaProviderOptions) {
  this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
  this.apiKey = opts.apiKey;
  this.toolsEnabled = opts.toolsEnabled !== false;
}
// in stream():
const useTools = this.toolsEnabled && req.tools && req.tools.length > 0;
const body = {
  model: req.modelId,
  messages: this.buildMessages(req.messages, req.systemPrompt),
  stream: true,
  keep_alive: '5m',
  ...(useTools ? { tools: req.tools!.map(toOllamaTool) } : {}),
  ...(typeof req.temperature === 'number' ? { options: { temperature: req.temperature } } : {}),
};
```

**Step 6: Run tests**

Run: `npm test && npm run typecheck`
Expected: all PASS, types clean.

**Step 7: Commit**

```bash
git add src/services/llm/router.ts src/services/llm/ollama.ts src/core/llm.ts src/stores/RootStore.ts tests/services/llm/ollama.test.ts
git commit -m "feat(ollama): wire OllamaProvider into LlmRouter with global tools toggle"
```

---

## Task 7: OllamaCard UI

**Files:**
- Create: `src/components/menu/sections/api/OllamaCard.tsx`
- Modify: `src/components/menu/sections/api/ApiSection.tsx` (mount OllamaCard between the provider list and `ImageGenCard`)

**Step 1: Build the card**

```tsx
// src/components/menu/sections/api/OllamaCard.tsx
import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { tokens } from '../../../../core/styleTokens';
import { useOllamaStore } from '../../../../stores/context';
import { Card, Pill, SettingsRow, Input, Button, SecretKeyField, Toggle } from '../../../ui';
import { ProviderAvatar } from './ProviderAvatar';

export const OllamaCard = observer(function OllamaCard() {
  const store = useOllamaStore();

  // Drive the status poll while this card is mounted.
  useEffect(() => {
    store.startStatusPoll();
    return () => store.stopStatusPoll();
  }, [store]);

  const status = store.state;
  const pill = status === 'online'
    ? <Pill>● Connected</Pill>
    : status === 'offline'
      ? <Pill tone="muted">○ Not running</Pill>
      : <Pill tone="muted">○ Unknown</Pill>;

  return (
    <Card style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
        <ProviderAvatar name="Ollama" />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>Ollama</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 1 }}>
            Local LLMs via the Ollama runtime.
          </div>
        </div>
        {pill}
      </div>

      <div style={{ paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <SettingsRow label="Base URL">
          <Input
            placeholder="http://127.0.0.1:11434"
            value={store.config.baseUrl}
            onChange={e => store.setBaseUrl(e.currentTarget.value)}
            style={{ ...tokens.mono, fontSize: 12, flex: 1 }}
          />
        </SettingsRow>

        <SettingsRow label="API key (optional)">
          <SecretKeyField
            value={store.config.apiKey ?? ''}
            onSet={(k) => store.setKey(k)}
            onClear={() => store.setKey('')}
            placeholder="Only if a reverse proxy is fronting Ollama with auth"
            connectLabel="Set"
          />
        </SettingsRow>

        <SettingsRow label="Tool calls">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Toggle
              checked={store.config.toolsEnabled}
              onChange={(v) => store.setToolsEnabled(v)}
            />
            <span style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>
              Off if your models behave badly with tools.
            </span>
          </div>
        </SettingsRow>

        <CatalogRow />

        {store.lastError && (
          <div style={{ fontSize: 11.5, color: '#e57373' }}>{store.lastError}</div>
        )}

        <div style={{ fontSize: 11.5, color: 'var(--text-faint)', paddingLeft: 8 }}>
          Run <code style={tokens.mono}>ollama pull llama3.1</code> to add a model. Status refreshes every 30s while this panel is open.
        </div>
      </div>
    </Card>
  );
});

const CatalogRow = observer(function CatalogRow() {
  const store = useOllamaStore();
  const { count, lastRefreshAt, fetching } = store;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flex: 1, fontSize: 11.5, color: 'var(--text-faint)' }}>
        {count > 0
          ? <>{count} model{count === 1 ? '' : 's'} · last refreshed {formatTs(lastRefreshAt)}</>
          : <>No models pulled yet</>
        }
      </div>
      <Button onClick={() => { void store.refresh(); }} disabled={fetching}>
        {fetching ? 'Refreshing…' : (count > 0 ? 'Refresh' : 'Load models')}
      </Button>
      {count > 0 && !fetching && (
        <Button variant="danger" onClick={() => store.clearCatalog()}>Clear</Button>
      )}
    </div>
  );
});

function formatTs(ts: number | null): string {
  if (!ts) return 'never';
  const d = new Date(ts);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
```

**Step 2: Mount in ApiSection**

```tsx
// src/components/menu/sections/api/ApiSection.tsx
// Add import
import { OllamaCard } from './OllamaCard';

// Insert after the PROVIDERS.map(...) block, before the Image generation section:
<div style={{ ...tokens.section, marginTop: 32 }}>
  <div style={tokens.sectionTitle}>Local models</div>
  <OllamaCard />
</div>
```

**Step 3: Verify Toggle exists**

Quick check: `npm run typecheck` will flag a missing import if `Toggle` isn't exported from `components/ui`. It is — see `src/components/ui/index.ts:1`.

**Step 4: Run tests + typecheck + lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: tests green, typecheck clean. Lint may emit pre-existing warnings; no new errors.

**Step 5: Commit**

```bash
git add src/components/menu/sections/api/OllamaCard.tsx src/components/menu/sections/api/ApiSection.tsx
git commit -m "feat(ollama): OllamaCard in Settings → API"
```

---

## Task 8: Per-model `supportsTools` enforcement

**Files:**
- Modify: `src/stores/ChatStore.ts` (drop `tools` when the active model has `supportsTools === false`)
- Test: `tests/stores/ChatStore.test.ts` (or a new focused test file)

The catalog mapper already flags `gemma*` / `phi*` / `codellama` as `supportsTools: false`. ChatStore needs to honor that flag at request-build time.

**Step 1: Find the request-build site**

Run: `grep -n "tools:" src/stores/ChatStore.ts | head`
Expected: one site that assigns `tools` on the `LlmRequest` (search for `toolDefsForTurn` or `request.tools`).

**Step 2: Write the failing test**

```typescript
// tests/stores/ChatStore.test.ts — add to existing describe
it('omits tools from the request when the active model has supportsTools: false', async () => {
  // Build a registry with a no-tools model, send a turn, assert the captured
  // LlmRequest had `tools: undefined` or `[]`. Use the existing fake provider
  // pattern in this file as a template.
});
```

(The exact assertion shape mirrors the `respond` capture pattern already used elsewhere in this file. Read it before writing the test.)

**Step 3: Implement**

```typescript
// src/stores/ChatStore.ts — at the request-build site:
const model = this.registry.findById(thread.modelId);
const toolsAllowed = model?.supportsTools !== false;
const request: LlmRequest = {
  modelId: providerModelId,
  messages: wire,
  systemPrompt,
  tools: toolsAllowed ? toolDefs : undefined,
  threadId: thread.id,
};
```

**Step 4: Run tests**

Run: `npm test -- tests/stores/ChatStore.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/stores/ChatStore.ts tests/stores/ChatStore.test.ts
git commit -m "feat(ollama): honor model.supportsTools=false at request build"
```

---

## Task 9: Manual smoke + docs

**Files:**
- Modify: `docs/changelog.md` (new dated entry)
- Modify: `docs/roadmap.md` (mark Ollama integration done under Near-term)
- Modify: `docs/architecture.md` (Tools section — add Ollama provider line; Persistence table — add `gatesai.ollama.v1`)
- Modify: `docs/tech_spec.md` (Storage table — add `gatesai.ollama.v1`)

**Step 1: Manual smoke checklist**

Don't run yet — record what to test:

1. `ollama serve` is running on `127.0.0.1:11434`.
2. `ollama pull llama3.1:8b`.
3. App boots → Settings → API → Ollama card shows `● Connected` after refresh, `1 model`.
4. Composer model picker has `llama3.1:8b` listed under "Ollama" vendor.
5. Send "what's 2+2" → streamed text response.
6. Send "list the files in /workspace via the workspace tool" → tool call fires, result renders.
7. Pull `gemma2:9b`, click Refresh. Send a tool-requiring prompt — request goes out without tools (no error, model responds in text).
8. `ollama stop` (or kill the server). Within ~30s the pill flips to `○ Not running`. Sending a turn surfaces a clear error.
9. Restart Ollama → pill flips back to `● Connected` on the next poll tick.

**Step 2: Update changelog**

```markdown
## 2026-04-26 — Feature: Ollama provider

Local LLMs via Ollama are now first-class in the model picker. New
**Ollama** card under Settings → API takes the base URL (default
`http://127.0.0.1:11434`), an optional bearer key, and a global tool-
calls toggle; clicking Refresh hits `/api/tags` and populates the
picker with whatever models you've pulled.

The `OllamaProvider` speaks Ollama's native NDJSON `/api/chat`, so
streaming text, tool calls, and image inputs all work for capable
models. The catalog flags known-bad tool families (`gemma*`, `phi*`,
`codellama`) with `supportsTools: false`; ChatStore drops `tools` from
the request for those models. The existing **Local endpoint** provider
(LM Studio / vLLM / llama.cpp) is untouched.

Status polls every 30s while the Settings → API panel is open;
otherwise the pill is fixed at last-known state. Persistence under
`gatesai.ollama.v1`, separate from the LLM-provider config.
```

**Step 3: Update roadmap**

```markdown
# under Near-term, mark done:
- [x] Ollama provider — local LLMs in the model picker via the Ollama runtime
```

**Step 4: Update architecture.md persistence table**

Add a row:

| `gatesai.ollama.v1` | Ollama config + catalog cache | `OllamaStore` |

**Step 5: Update tech_spec.md storage table**

Add the same row.

Add a one-paragraph blurb in the Tools / providers section noting that the Ollama provider speaks the native API and that the global `toolsEnabled` flag plus per-model `supportsTools` together gate tool calling.

**Step 6: Run final verification**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all clean (lint warnings ok; new errors are not).

**Step 7: Commit**

```bash
git add docs/changelog.md docs/roadmap.md docs/architecture.md docs/tech_spec.md
git commit -m "docs: ollama integration"
```

**Step 8: Manual smoke**

Walk the checklist above. Note any deviations and either fix forward (new task) or add to an out-of-scope follow-up list.

---

## Verification (full plan)

- `npm run typecheck` — clean
- `npm run lint` — no new errors
- `npm test` — all green; new files: `tests/services/llm/ollamaCatalog.test.ts`, `tests/services/llm/ollama.test.ts`, `tests/stores/OllamaStore.test.ts`
- Manual smoke per Task 9.

## Out of scope (deferred)

- In-app `ollama pull` / model management.
- GPU/VRAM telemetry.
- Per-model parameter sliders (temperature/top_p/repeat_penalty).
- `/api/embeddings`.
- Lazy `/api/show` for context length.
- Onboarding flow ("install Ollama, pull `llama3.1`, you're done").
- Single recommended vision model — TBD when vision matters more.
- Auto-detect Ollama under the existing "Local endpoint" provider — explicitly rejected during design.

## Forward-compat hooks

- `Model.supportsTools` is now part of the model interface, so any provider can opt in/out.
- `OllamaStore.startStatusPoll` is ref-counted so a future "Ollama status pill in the composer footer" can subscribe alongside the API panel without doubling the poll rate.
- Catalog persistence stores the full `Model[]`, not just tags, so a future `/api/show` lazy enrich can mutate entries in place without breaking the boot rehydrate path.

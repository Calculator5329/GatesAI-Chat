// The vertical slice under test: one chat turn from `send()` through
// transport, domain and persistence adapter, with nothing mocked except the
// network socket itself.
//
// Every assertion here is on observable output — persisted bytes, emitted
// events, the request that went out — not on internal calls.

import { describe, expect, it } from 'vitest';
import {
  conversationId,
  createChatRuntime,
  KeyValueConversationRepository,
  MapKeyValueStore,
  OpenAiCompatTransport,
  type CompletionRequest,
  type TurnEvent,
  type TurnPlugin,
} from '../src/index';
import {
  contentFrame,
  DONE_FRAME,
  finishFrame,
  fixedClock,
  sequentialIds,
  sseResponse,
  usageFrame,
} from './support/sseResponse';

interface Harness {
  runtime: ReturnType<typeof createChatRuntime>;
  store: MapKeyValueStore;
  events: TurnEvent[];
  requests: { url: string; body: Record<string, unknown> }[];
}

function harness(
  respond: (request: { url: string; init: RequestInit }) => Promise<Response> | Response,
  plugins: readonly TurnPlugin[] = [],
): Harness {
  const store = new MapKeyValueStore();
  const requests: Harness['requests'] = [];
  const events: TurnEvent[] = [];

  const transport = new OpenAiCompatTransport({
    id: 'openrouter',
    baseUrl: 'https://openrouter.test/api/v1/',
    apiKey: () => 'test-key',
    extraHeaders: { 'X-Title': 'spike-v5' },
    fetch: async (url, init) => {
      requests.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return respond({ url, init });
    },
  });

  const runtime = createChatRuntime({
    transport,
    repository: new KeyValueConversationRepository({ store }),
    clock: fixedClock(),
    ids: sequentialIds(),
    defaultModelId: 'anthropic/claude-sonnet-5',
    defaultSystemPrompt: 'You are terse.',
    plugins,
  });
  runtime.subscribe(event => events.push(event));

  return { runtime, store, events, requests };
}

function storedConversation(store: MapKeyValueStore, id: string): {
  schemaVersion: number;
  conversation: { messages: { kind: string; text: string; stopReason?: string }[]; title: string };
} {
  const raw = store.snapshot()[`spike-v5.conversation.${id}`];
  expect(raw, 'conversation should be persisted').toBeDefined();
  return JSON.parse(raw as string);
}

describe('one chat turn round-trip', () => {
  it('streams a reply, emits the turn lifecycle, and persists both messages', async () => {
    const h = harness(() =>
      sseResponse([
        contentFrame('Hello'),
        contentFrame(', '),
        contentFrame('world.'),
        finishFrame('stop'),
        usageFrame(42, 7),
        DONE_FRAME,
      ]),
    );

    const conversation = await h.runtime.startConversation();
    const result = await h.runtime.send(conversation.id, '  Say hi  ');

    expect(result.text).toBe('Hello, world.');
    expect(result.stopReason).toBe('complete');
    expect(result.usage).toEqual({ promptTokens: 42, completionTokens: 7 });

    // Transport: one request, correct URL, auth header, and the domain's
    // message list including the system prompt.
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0]?.url).toBe('https://openrouter.test/api/v1/chat/completions');
    expect(h.requests[0]?.body.model).toBe('anthropic/claude-sonnet-5');
    expect(h.requests[0]?.body.messages).toEqual([
      { role: 'system', content: 'You are terse.' },
      { role: 'user', content: 'Say hi' },
    ]);

    // Domain: the lifecycle is one ordered event stream.
    expect(h.events.map(event => event.type)).toEqual([
      'turn.started',
      'conversation.saved',
      'assistant.started',
      'assistant.delta',
      'assistant.delta',
      'assistant.delta',
      'assistant.stopped',
      'conversation.saved',
    ]);
    const deltas = h.events.flatMap(event => (event.type === 'assistant.delta' ? [event.delta] : []));
    expect(deltas).toEqual(['Hello', ', ', 'world.']);

    // Persistence: the durable record, read back as bytes.
    const record = storedConversation(h.store, conversation.id);
    expect(record.schemaVersion).toBe(2);
    expect(record.conversation.title).toBe('Say hi');
    expect(record.conversation.messages).toHaveLength(2);
    expect(record.conversation.messages[0]).toMatchObject({ kind: 'user', text: 'Say hi' });
    expect(record.conversation.messages[1]).toMatchObject({
      kind: 'assistant',
      text: 'Hello, world.',
      stopReason: 'complete',
    });

    // The user message is durable before the provider is called: three
    // writes total (create, user turn, completed turn).
    expect(h.store.writeCount).toBe(3);
  });

  it('reassembles deltas split across byte boundaries', async () => {
    const full = `${contentFrame('split ')}${contentFrame('across ')}${contentFrame('chunks')}${finishFrame('stop')}${DONE_FRAME}`;
    const cut = Math.floor(full.length / 3);
    const h = harness(() => sseResponse([full.slice(0, cut), full.slice(cut, cut * 2), full.slice(cut * 2)]));

    const conversation = await h.runtime.startConversation();
    const result = await h.runtime.send(conversation.id, 'go');

    expect(result.text).toBe('split across chunks');
    expect(result.stopReason).toBe('complete');
  });

  it('records an HTTP failure on the assistant message instead of throwing', async () => {
    const h = harness(() => new Response('rate limited', { status: 429, statusText: 'Too Many Requests' }));

    const conversation = await h.runtime.startConversation();
    const result = await h.runtime.send(conversation.id, 'go');

    expect(result.stopReason).toBe('error');
    expect(result.error).toContain('429');
    expect(result.text).toBe('');

    const record = storedConversation(h.store, conversation.id);
    expect(record.conversation.messages).toHaveLength(2);
    expect(record.conversation.messages[1]).toMatchObject({ kind: 'assistant', stopReason: 'error' });

    const stopped = h.events.find(event => event.type === 'assistant.stopped');
    expect(stopped?.type === 'assistant.stopped' && stopped.reason).toBe('error');
  });

  it('keeps the partial reply when the caller aborts mid-stream', async () => {
    const controller = new AbortController();
    // Two frames, enqueued separately so the reader sees two reads. Abort
    // fires on the first delta, so the second frame is never consumed.
    const h = harness(() => sseResponse([contentFrame('partial'), contentFrame(' more')]));
    h.runtime.subscribe(event => {
      if (event.type === 'assistant.delta') controller.abort();
    });

    const conversation = await h.runtime.startConversation();
    const result = await h.runtime.send(conversation.id, 'go', { signal: controller.signal });

    expect(result.stopReason).toBe('cancelled');
    expect(result.text).toBe('partial');

    const record = storedConversation(h.store, conversation.id);
    expect(record.conversation.messages[1]).toMatchObject({
      kind: 'assistant',
      text: 'partial',
      stopReason: 'cancelled',
    });
  });

  it('lets an extension decorate the outgoing request and observe the turn', async () => {
    const seen: string[] = [];
    const plugin: TurnPlugin = {
      name: 'prefix-system',
      decorateRequest: (request: CompletionRequest) => ({
        ...request,
        messages: [{ role: 'system', content: 'From an extension.' }, ...request.messages],
        temperature: 0.2,
      }),
      onEvent: event => seen.push(event.type),
    };
    const h = harness(() => sseResponse([contentFrame('ok'), finishFrame('stop'), DONE_FRAME]), [plugin]);

    const conversation = await h.runtime.startConversation();
    await h.runtime.send(conversation.id, 'go');

    const body = h.requests[0]?.body as { messages: { content: string }[]; temperature: number };
    expect(body.messages[0]?.content).toBe('From an extension.');
    expect(body.temperature).toBe(0.2);
    expect(seen).toContain('assistant.stopped');
  });

  it('reads a v1 record through the adapter and continues the conversation', async () => {
    const legacy = {
      schemaVersion: 1,
      conversation: {
        id: 'conv-legacy',
        title: 'Older chat',
        modelId: 'anthropic/claude-sonnet-5',
        systemPrompt: '',
        updatedAt: 1,
        messages: [
          { id: 'm1', role: 'user', content: 'first question', createdAt: 1 },
          { id: 'm2', role: 'assistant', content: 'first answer', createdAt: 2 },
        ],
      },
    };
    const h = harness(() => sseResponse([contentFrame('second answer'), finishFrame('stop'), DONE_FRAME]));
    await h.store.set('spike-v5.conversation.conv-legacy', JSON.stringify(legacy));

    const result = await h.runtime.send(conversationId('conv-legacy'), 'second question');

    expect(result.text).toBe('second answer');
    expect(h.requests[0]?.body.messages).toEqual([
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'second question' },
    ]);

    const record = storedConversation(h.store, 'conv-legacy');
    expect(record.schemaVersion).toBe(2);
    expect(record.conversation.messages.map(message => message.kind)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
  });

  it('refuses a real overlapping send before persistence or transport, while another conversation works', async () => {
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    let calls = 0;
    const h = harness(async () => {
      if (++calls === 1) { entered(); await gate; }
      return sseResponse([contentFrame('reply'), DONE_FRAME]);
    });
    const one = await h.runtime.startConversation();
    const two = await h.runtime.startConversation();
    const pending = h.runtime.send(one.id, 'first');
    await started;
    const writes = h.store.writeCount;
    await expect(h.runtime.send(one.id, 'duplicate')).rejects.toThrow(/has not stopped/);
    expect(h.store.writeCount).toBe(writes);
    expect(calls).toBe(1);
    expect((await h.runtime.send(two.id, 'independent')).stopReason).toBe('complete');
    release(); await pending;
    expect((await h.runtime.send(one.id, 'next')).stopReason).toBe('complete');
    expect(storedConversation(h.store, one.id).conversation.messages.map(m => m.text)).toEqual(['first', 'reply', 'next', 'reply']);
  });
});

import { readSseData } from '../src/transport/sse';

for (const newline of ['\n', '\r\n', '\r']) it(`accepts split ${JSON.stringify(newline)} SSE frames`, async () => {
  const wire = (contentFrame('café') + finishFrame('stop') + usageFrame(4, 2) + DONE_FRAME).replaceAll('\n', newline);
  const h = harness(() => sseResponse([...wire]));
  const c = await h.runtime.startConversation();
  const result = await h.runtime.send(c.id, 'go');
  expect(result.text).toBe('café'); expect(result.stopReason).toBe('complete');
  expect(result.usage).toEqual({ promptTokens: 4, completionTokens: 2 });
});

for (const tail of ['data: broken\n\n', 'data: {"error":{"message":"private detail"}}\n\n', 'data: {"choices":[{"finish_reason":"tool_calls"}]}\n\n', '']) {
  it(`preserves partial text and fails invalid/premature stream ${JSON.stringify(tail)}`, async () => {
    const h = harness(() => sseResponse([contentFrame('partial'), tail]));
    const c = await h.runtime.startConversation(); const result = await h.runtime.send(c.id, 'go');
    expect(result.text).toBe('partial'); expect(result.stopReason).toBe('error');
    expect(result.error).not.toContain('private detail');
    expect(storedConversation(h.store, c.id).conversation.messages[1]?.stopReason).toBe('error');
    expect((await h.runtime.send(c.id, 'retry')).stopReason).toBe('error');
  });
}

it('accepts known finish plus EOF and DONE without a finish frame', async () => {
  for (const ending of [finishFrame('stop'), DONE_FRAME]) {
    const h = harness(() => sseResponse([contentFrame('ok'), ending]));
    const c = await h.runtime.startConversation(); expect((await h.runtime.send(c.id, 'go')).stopReason).toBe('complete');
  }
});

it('SSE preserves data spacing and multiline fields, ignores comments and discards unfinished event', async () => {
  const wire = ':comment\r\nevent: ignored\r\ndata:  leading\r\ndata:second\r\ndata\r\n\r\ndata:unfinished';
  const response = sseResponse([...wire]); const payloads: string[] = [];
  for await (const payload of readSseData(response.body!, new AbortController().signal)) payloads.push(payload);
  expect(payloads).toEqual([' leading\nsecond\n']);
});

it('abort settles a stalled read even when cancellation never resolves', async () => {
  const controller = new AbortController(); let cancelled = false;
  const h = harness(() => new Response(new ReadableStream<Uint8Array>({
    start(stream) { stream.enqueue(new TextEncoder().encode(contentFrame('partial'))); },
    cancel() { cancelled = true; return new Promise<void>(() => {}); },
  })));
  h.runtime.subscribe(event => { if (event.type === 'assistant.delta') setTimeout(() => controller.abort(), 0); });
  const c = await h.runtime.startConversation(); const result = await h.runtime.send(c.id, 'go', { signal: controller.signal });
  expect(result.stopReason).toBe('cancelled'); expect(result.text).toBe('partial'); expect(cancelled).toBe(true);
});

it('an arbitrary transport EOF cannot declare successful completion', async () => {
  const runtime = createChatRuntime({ defaultModelId: 'fixture', repository: new KeyValueConversationRepository({ store: new MapKeyValueStore() }), transport: { id: 'fixture', async *stream() { yield { type: 'text', delta: 'partial' }; } } });
  const c = await runtime.startConversation(); const result = await runtime.send(c.id, 'go');
  expect(result.text).toBe('partial'); expect(result.stopReason).toBe('error');
});

for (const failure of ['load', 'save', 'plugin', 'listener']) it(`releases runtime admission after ${failure} failure`, async () => {
  let fail = false;
  const base = new KeyValueConversationRepository({ store: new MapKeyValueStore() });
  const runtime = createChatRuntime({
    defaultModelId: 'fixture',
    repository: {
      async load(id) { if (fail && failure === 'load') throw new Error('synthetic'); return base.load(id); },
      async save(c) { if (fail && failure === 'save') throw new Error('synthetic'); return base.save(c); },
    },
    plugins: [{ name: 'fixture', decorateRequest(request) { if (fail && failure === 'plugin') throw new Error('synthetic'); return request; } }],
    transport: { id: 'fixture', async *stream() { yield { type: 'done', finishReason: 'stop' }; } },
  });
  runtime.subscribe(() => { if (fail && failure === 'listener') throw new Error('synthetic'); });
  const c = await runtime.startConversation(); fail = true;
  await expect(runtime.send(c.id, 'failure')).rejects.toThrow('synthetic');
  fail = false; expect((await runtime.send(c.id, 'retry')).stopReason).toBe('complete');
});

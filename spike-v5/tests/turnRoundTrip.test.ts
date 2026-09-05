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
    const encoder = new TextEncoder();
    const h = harness(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(streamController) {
              streamController.enqueue(encoder.encode(contentFrame('partial')));
              // Abort once the first frame is in flight, then keep sending.
              controller.abort();
              streamController.enqueue(encoder.encode(contentFrame(' more')));
              streamController.close();
            },
          }),
          { status: 200 },
        ),
    );

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

  it('refuses a second turn while one is in flight', async () => {
    const h = harness(() => sseResponse([contentFrame('ok'), finishFrame('stop'), DONE_FRAME]));
    const conversation = await h.runtime.startConversation();

    // Persist a conversation whose last message is a streaming assistant reply.
    await h.store.set(
      `spike-v5.conversation.${conversation.id}`,
      JSON.stringify({
        schemaVersion: 2,
        conversation: {
          ...conversation,
          messages: [
            { kind: 'user', id: 'm1', role: 'user', text: 'hi', createdAt: 1 },
            { kind: 'assistant', id: 'm2', role: 'assistant', text: '', createdAt: 2, modelId: 'x' },
          ],
        },
      }),
    );

    await expect(h.runtime.send(conversation.id, 'again')).rejects.toThrow(/has not stopped/);
    expect(h.requests).toHaveLength(0);
  });
});

import { describe, expect, it } from 'vitest';
import { findScenario, installDevScenario, readScenarioName, routesFor, SCENARIOS, seedStorage } from '../../src/dev/scenarios';
import { BridgeFileTable, createWebSocketPatch, handleBridgeOp, ScenarioBridgeSocket } from '../../src/dev/scenarios/mocks/bridge';
import { createFetchMock } from '../../src/dev/scenarios/mocks/http';
import { STORAGE_KEYS } from '../../src/dev/scenarios/seeds';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: key => map.get(key) ?? null,
    key: index => [...map.keys()][index] ?? null,
    removeItem: key => { map.delete(key); },
    setItem: (key, value) => { map.set(key, String(value)); },
  };
}

async function readSse(response: Response): Promise<string[]> {
  const text = await response.text();
  return text.split('\n\n').filter(Boolean).map(line => line.replace(/^data: /, ''));
}


describe('scenario catalog', () => {
  it('has unique names and a seed for every entry', () => {
    const names = SCENARIOS.map(scenario => scenario.name);
    expect(new Set(names).size).toBe(names.length);
    for (const scenario of SCENARIOS) {
      const seed = scenario.seed();
      expect(seed[STORAGE_KEYS.uiPrefs]).toBeDefined();
      expect(scenario.description.length).toBeGreaterThan(20);
    }
  });

  it('reads the scenario name from the query string only', () => {
    expect(readScenarioName('?scenario=desktop-ready')).toBe('desktop-ready');
    expect(readScenarioName('?other=1')).toBeNull();
    expect(readScenarioName('')).toBeNull();
  });

  it('seeds storage from scratch, encoding objects as JSON', () => {
    const storage = memoryStorage();
    storage.setItem('stale', '1');
    seedStorage(storage, findScenario('desktop-ready')!.seed());
    expect(storage.getItem('stale')).toBeNull();
    expect(JSON.parse(storage.getItem(STORAGE_KEYS.providers)!)).toEqual({ openrouter: { apiKey: 'test-key' } });
    expect(storage.getItem(STORAGE_KEYS.userGuideOpened)).toBe('1');
    const state = JSON.parse(storage.getItem(STORAGE_KEYS.state)!) as { threads: Array<{ id: string }>; activeThreadId: string };
    expect(state.activeThreadId).toBe('active');
    expect(state.threads.map(thread => thread.id)).toEqual(['active', 'tool', 'agent-task', 'usage']);
  });

  it('first-run leaves the provider unset and onboarding visible', () => {
    const seed = findScenario('first-run')!.seed();
    expect(seed[STORAGE_KEYS.providers]).toBeUndefined();
    expect(seed[STORAGE_KEYS.uiPrefs]).toEqual({ onboardingDismissed: false });
  });
});

describe('installDevScenario', () => {
  it('does nothing without a scenario parameter', () => {
    const storage = memoryStorage();
    storage.setItem('keep', '1');
    const realFetch = (() => Promise.resolve(new Response('real'))) as unknown as typeof fetch;
    const win = { location: { search: '' }, localStorage: storage, fetch: realFetch, WebSocket: ScenarioBridgeSocket as unknown as typeof WebSocket };
    expect(installDevScenario(win)).toBeNull();
    expect(win.fetch).toBe(realFetch);
    expect(storage.getItem('keep')).toBe('1');
  });

  it('reports unknown scenarios with the available names', () => {
    const win = { location: { search: '?scenario=nope' }, localStorage: memoryStorage(), fetch: fetch, WebSocket: ScenarioBridgeSocket as unknown as typeof WebSocket };
    const result = installDevScenario(win);
    expect(result).toMatchObject({ error: 'Unknown scenario "nope"' });
    expect((result as { available: string[] }).available).toContain('desktop-ready');
  });

  it('seeds, patches fetch and WebSocket, and records calls', async () => {
    const storage = memoryStorage();
    const realFetch = ((input: RequestInfo | URL) => Promise.resolve(new Response(`real:${String(input)}`))) as unknown as typeof fetch;
    const win = { location: { search: '?scenario=desktop-ready' }, localStorage: storage, fetch: realFetch, WebSocket: ScenarioBridgeSocket as unknown as typeof WebSocket };
    const handle = installDevScenario(win);
    expect(handle).toMatchObject({ name: 'desktop-ready', seeded: true });
    expect(storage.getItem(STORAGE_KEYS.state)).not.toBeNull();
    expect(win.fetch).not.toBe(realFetch);

    const health = await win.fetch('http://127.0.0.1:7331/health');
    expect((await health.json()).status).toBe('ok');
    const passthrough = await win.fetch('/__agent-handles/session');
    expect(await passthrough.text()).toBe('real:/__agent-handles/session');
    expect((handle as { calls: Array<{ route: string }> }).calls.map(call => call.route)).toEqual(['bridge.health']);
  });

  it('keeps storage when persist=1 is present', () => {
    const storage = memoryStorage();
    storage.setItem('keep', '1');
    const win = { location: { search: '?scenario=desktop-ready&persist=1' }, localStorage: storage, fetch: fetch, WebSocket: ScenarioBridgeSocket as unknown as typeof WebSocket };
    expect(installDevScenario(win)).toMatchObject({ seeded: false });
    expect(storage.getItem('keep')).toBe('1');
  });
});

describe('OpenRouter mock', () => {
  it('streams a text reply as content deltas with usage and [DONE]', async () => {
    const routes = routesFor(findScenario('desktop-ready')!);
    const mock = createFetchMock(routes, fetch);
    const response = await mock.fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'x', stream: true }) });
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    const frames = await readSse(response);
    expect(frames.at(-1)).toBe('[DONE]');
    const parsed = frames.slice(0, -1).map(frame => JSON.parse(frame) as { choices: Array<{ delta: { content?: string }; finish_reason?: string }>; usage?: unknown });
    const text = parsed.map(frame => frame.choices[0]?.delta?.content ?? '').join('');
    expect(text).toContain('The mocked OpenRouter stream answered this turn');
    expect(parsed.at(-1)?.choices[0]?.finish_reason).toBe('stop');
    expect(parsed.at(-1)?.usage).toMatchObject({ prompt_tokens: 512 });
  });

  it('consumes turns in order and repeats the last text turn', async () => {
    const routes = routesFor(findScenario('tool-turn')!);
    const mock = createFetchMock(routes, fetch);
    const post = () => mock.fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: '{}' });
    const first = await readSse(await post());
    const firstFrames = first.slice(0, -1).map(frame => JSON.parse(frame) as { choices: Array<{ delta: { tool_calls?: Array<{ id?: string; function: { name?: string; arguments: string } }> }; finish_reason?: string }> });
    const args = firstFrames.flatMap(frame => frame.choices[0]?.delta?.tool_calls ?? []).map(call => call.function.arguments).join('');
    expect(firstFrames[0].choices[0].delta.tool_calls?.[0]).toMatchObject({ id: 'call_time_1', function: { name: 'time' } });
    expect(JSON.parse(args)).toEqual({});
    expect(firstFrames.at(-1)?.choices[0]?.finish_reason).toBe('tool_calls');

    const second = (await readSse(await post())).slice(0, -1).map(frame => JSON.parse(frame) as { choices: Array<{ delta: { content?: string } }> });
    expect(second.map(frame => frame.choices[0]?.delta?.content ?? '').join('')).toContain('checked the clock');
    const third = (await readSse(await post())).slice(0, -1).map(frame => JSON.parse(frame) as { choices: Array<{ delta: { content?: string } }> });
    expect(third.map(frame => frame.choices[0]?.delta?.content ?? '').join('')).toContain('checked the clock');
  });

  it('answers image requests on the shared URL with a data URL', async () => {
    const routes = routesFor(findScenario('image-job')!);
    const mock = createFetchMock(routes, fetch);
    const response = await mock.fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'openai/gpt-5.4-image-2', modalities: ['image', 'text'], stream: false }),
    });
    const payload = await response.json() as { choices: Array<{ message: { images: Array<{ image_url: { url: string } }> } }> };
    expect(payload.choices[0].message.images[0].image_url.url.startsWith('data:image/png;base64,')).toBe(true);
    expect(mock.calls.map(call => call.route)).toEqual(['openrouter.image']);
  });

  it('returns the configured error status', async () => {
    const routes = routesFor(findScenario('provider-error')!);
    const mock = createFetchMock(routes, fetch);
    const response = await mock.fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: '{}' });
    expect(response.status).toBe(500);
  });

  it('fails like a network error when offline', async () => {
    const routes = routesFor(findScenario('local-ollama')!);
    const mock = createFetchMock(routes, fetch);
    await expect(mock.fetch('https://openrouter.ai/api/v1/models')).rejects.toThrow(/Failed to fetch/);
  });
});

describe('Ollama and Brave mocks', () => {
  it('lists models and streams an NDJSON chat reply', async () => {
    const routes = routesFor(findScenario('local-ollama')!);
    const mock = createFetchMock(routes, fetch);
    const tags = await (await mock.fetch('http://127.0.0.1:11434/api/tags')).json() as { models: Array<{ name: string }> };
    expect(tags.models.map(model => model.name)).toEqual(['qwen2.5:7b', 'llama3.2:3b', 'nomic-embed-text']);
    const chat = await (await mock.fetch('http://127.0.0.1:11434/api/chat', { method: 'POST', body: '{}' })).text();
    const frames = chat.trim().split('\n').map(line => JSON.parse(line) as { message?: { content: string }; done: boolean });
    expect(frames[0].message?.content).toContain('Mock local reply');
    expect(frames.at(-1)?.done).toBe(true);
  });

  it('returns Brave grounding results for the query', async () => {
    const routes = routesFor(findScenario('web-search')!);
    const mock = createFetchMock(routes, fetch);
    const payload = await (await mock.fetch('https://api.search.brave.com/res/v1/llm/context?q=agent+handles')).json() as { grounding: { generic: Array<{ url: string }> } };
    expect(payload.grounding.generic).toHaveLength(2);
    expect(payload.grounding.generic[0].url).toContain('example.test');
  });

  it('refuses Brave when the scenario has no plan', async () => {
    const routes = routesFor(findScenario('desktop-ready')!);
    const mock = createFetchMock(routes, fetch);
    await expect(mock.fetch('https://api.search.brave.com/res/v1/llm/context?q=x')).rejects.toThrow(/offline/);
  });
});

describe('bridge mock', () => {
  it('lists, writes and reads files through the envelope ops', () => {
    const table = new BridgeFileTable([{ path: '/workspace/notes', name: 'notes', kind: 'dir' }, { path: '/workspace/notes/a.md', name: 'a.md', kind: 'file', content: 'hello' }]);
    const listing = handleBridgeOp('fs.list', { path: '/workspace' }, table) as { entries: Array<{ name: string }> };
    expect(listing.entries.map(entry => entry.name)).toEqual(['notes']);
    handleBridgeOp('fs.write', { path: '/workspace/notes/b.md', content: 'new' }, table);
    const read = handleBridgeOp('fs.read', { path: '/workspace/notes/b.md' }, table) as { content: string };
    expect(read.content).toBe('new');
    const nested = handleBridgeOp('fs.list', { path: '/workspace/notes' }, table) as { entries: Array<{ name: string }> };
    expect(nested.entries.map(entry => entry.name).sort()).toEqual(['a.md', 'b.md']);
    const image = handleBridgeOp('fs.read', { path: '/workspace/x.png', encoding: 'base64' }, table) as { mime: string };
    expect(image.mime).toBe('image/svg+xml');
  });

  it('opens, answers hello with protocol 2 and results requests', async () => {
    const Patched = createWebSocketPatch(ScenarioBridgeSocket as unknown as typeof WebSocket, new BridgeFileTable([]), true);
    expect(Patched.OPEN).toBe(1);
    const socket = new Patched('ws://127.0.0.1:7331/ws') as unknown as ScenarioBridgeSocket;
    await new Promise<void>(resolve => { socket.onopen = () => resolve(); });
    expect(socket.readyState).toBe(1);
    const messages: string[] = [];
    socket.onmessage = ev => { messages.push(ev.data); };
    socket.send(JSON.stringify({ type: 'hello', protocolVersion: 2 }));
    socket.send(JSON.stringify({ id: 'r1', type: 'request', op: 'exec.run', data: { cmd: 'npm' } }));
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(JSON.parse(messages[0])).toEqual({ type: 'hello', protocolVersion: 2 });
    expect(JSON.parse(messages[1])).toMatchObject({ id: 'r1', type: 'result', op: 'exec.run', data: { exit_code: 0 } });
  });

  it('errors and closes when offline', async () => {
    const socket = new ScenarioBridgeSocket('ws://127.0.0.1:7331/ws', new BridgeFileTable([]), false);
    const events: string[] = [];
    socket.onerror = () => events.push('error');
    socket.onclose = () => events.push('close');
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(events).toEqual(['error', 'close']);
    expect(socket.readyState).toBe(3);
  });

  it('hands non-bridge URLs to the real constructor', () => {
    class Real { constructor(public url: string | URL) {} }
    const Patched = createWebSocketPatch(Real as unknown as typeof WebSocket, new BridgeFileTable([]), true);
    const other = new Patched('ws://localhost:5173/');
    expect(other).toBeInstanceOf(Real);
  });
});

describe('main entry', () => {
  it('only reaches the dev layer through a DEV-or-showcase-guarded dynamic import', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const path = await import('node:path');
    const here = fileURLToPath(new URL(import.meta.url.replace(/^\/@fs/, 'file://')));
    const source = await readFile(path.resolve(path.dirname(here), '../../src/main.tsx'), 'utf8');
    expect(source).toMatch(/if \(import\.meta\.env\.DEV \|\| import\.meta\.env\.VITE_GATESAI_SHOWCASE === '1'\) \{\s*const \{ installDevScenario \} = await import\('\.\/dev\/scenarios'\);/);
    expect(source.match(/dev\/scenarios/g)).toHaveLength(1);
    expect(source).not.toMatch(/^import .*dev\/scenarios/m);
  });
});

describe('scenario layer follow-ups', () => {
  async function postChat(routes: ReturnType<typeof routesFor>, body: Record<string, unknown>) {
    const mock = createFetchMock(routes, fetch);
    return mock.fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: JSON.stringify(body) });
  }

  it('keeps failing once an error script is used up, because the app retries', async () => {
    const routes = routesFor(findScenario('provider-error')!);
    const mock = createFetchMock(routes, fetch);
    const body = JSON.stringify({ model: 'x', messages: [{ role: 'user', content: 'hi' }] });
    const first = await mock.fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body });
    const second = await mock.fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body });
    expect([first.status, second.status]).toEqual([500, 500]);
  });

  it('answers conversation-naming requests without consuming a scripted turn', async () => {
    const routes = routesFor(findScenario('tool-turn')!);
    const mock = createFetchMock(routes, fetch);
    const title = await mock.fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'x', messages: [{ role: 'system', content: 'You name conversations. Given the first user question...' }] }),
    });
    const deltas = [...(await title.text()).matchAll(/"content":"([^"]*)"/g)].map(match => match[1]).join('');
    expect(deltas).toBe('Mocked conversation title');
    const turn = await mock.fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'x', messages: [{ role: 'user', content: 'what time is it' }] }),
    });
    expect(await turn.text()).toContain('"tool_calls"');
    expect(mock.calls.map(call => call.route)).toEqual(['openrouter.title', 'openrouter.chat']);
  });

  it('rejects a text read of a file the workspace does not hold, like the real bridge', () => {
    const table = new BridgeFileTable([]);
    const result = handleBridgeOp('fs.read', { path: '/workspace/.gatesai/chat/snapshot.json' }, table) as { __bridgeError?: { code: string } };
    expect(result.__bridgeError?.code).toBe('fs_not_found');
    const image = handleBridgeOp('fs.read', { path: '/workspace/artifacts/images/missing.png', encoding: 'base64' }, table) as { encoding: string };
    expect(image.encoding).toBe('base64');
  });

  it('delivers an error envelope through the fake socket for a missing file', async () => {
    const socket = new ScenarioBridgeSocket('ws://127.0.0.1:7331/ws', new BridgeFileTable([]), true);
    await new Promise<void>(resolve => { socket.onopen = () => resolve(); });
    const reply = new Promise<{ type: string; data: { code: string } }>(resolve => {
      socket.onmessage = event => resolve(JSON.parse(event.data) as { type: string; data: { code: string } });
    });
    socket.send(JSON.stringify({ id: 'r1', type: 'request', op: 'fs.read', data: { path: '/nowhere.txt' } }));
    const envelope = await reply;
    expect(envelope.type).toBe('error');
    expect(envelope.data.code).toBe('fs_not_found');
  });

  it('seeds the acknowledged version so only the whats-new scenario opens the panel', () => {
    const ready = findScenario('desktop-ready')!.seed() as Record<string, { lastSeenVersion?: string }>;
    const upgraded = findScenario('whats-new')!.seed() as Record<string, { lastSeenVersion?: string }>;
    expect(ready[STORAGE_KEYS.whatsNew].lastSeenVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(upgraded[STORAGE_KEYS.whatsNew].lastSeenVersion).toBe('4.6.1');
  });

  it('uses a PNG for generated images because the image client rejects other data URLs', async () => {
    const response = await postChat(routesFor(findScenario('image-job')!), { modalities: ['image', 'text'] });
    const payload = await response.json() as { choices: Array<{ message: { images: Array<{ image_url: { url: string } }> } }> };
    expect(payload.choices[0].message.images[0].image_url.url).toMatch(/^data:image\/png;base64,iVBOR/);
  });
});

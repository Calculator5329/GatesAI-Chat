import { describe, expect, it } from 'vitest';
import { ComfyClient, stripWorkflowMetadata, substituteWorkflow } from '../../../src/services/image/comfyClient';

function pngBytes(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function makeFakeFetch(handlers: Array<{ match: (url: string) => boolean; respond: (url: string) => Response | Promise<Response> }>) {
  const calls: Array<{ url: string }> = [];
  const impl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url });
    const h = handlers.find((x) => x.match(url));
    if (!h) throw new Error(`no handler for ${url}`);
    return h.respond(url);
  };
  return { fetch: impl as typeof fetch, calls };
}

describe('substituteWorkflow', () => {
  it('replaces whole-string token values and keeps their native type', () => {
    const out = substituteWorkflow({
      a: '{{PROMPT}}',
      b: { seed: '{{SEED}}', width: '{{WIDTH}}' },
    }, { '{{PROMPT}}': 'a cat', '{{SEED}}': 42, '{{WIDTH}}': 1024 }) as Record<string, { seed: unknown; width: unknown } & Record<string, unknown>>;
    expect(out.a).toBe('a cat');
    expect(out.b.seed).toBe(42);
    expect(out.b.width).toBe(1024);
  });

  it('replaces substring tokens within larger strings as strings', () => {
    const out = substituteWorkflow('prefix {{PROMPT}} suffix', { '{{PROMPT}}': 'x' });
    expect(out).toBe('prefix x suffix');
  });

  it('leaves unknown tokens and arrays untouched', () => {
    const out = substituteWorkflow(['unchanged', '{{MISSING}}', 5], {});
    expect(out).toEqual(['unchanged', '{{MISSING}}', 5]);
  });
});

describe('stripWorkflowMetadata', () => {
  it('removes top-level underscore metadata before submitting to ComfyUI', () => {
    expect(stripWorkflowMetadata({
      _comment: 'human docs only',
      '1': { class_type: 'SaveImage', inputs: {} },
    })).toEqual({
      '1': { class_type: 'SaveImage', inputs: {} },
    });
  });
});

describe('ComfyClient', () => {
  it('submits a prompt, polls /history, and fetches the image bytes', async () => {
    let pollCount = 0;
    const { fetch: fakeFetch, calls } = makeFakeFetch([
      {
        match: (u) => u.endsWith('/prompt'),
        respond: () => new Response(JSON.stringify({ prompt_id: 'abc123' }),
          { status: 200, headers: { 'content-type': 'application/json' } }),
      },
      {
        match: (u) => u.includes('/history/abc123'),
        respond: () => {
          pollCount++;
          if (pollCount < 2) {
            return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
          }
          return new Response(JSON.stringify({
            abc123: {
              outputs: {
                '9': { images: [{ filename: 'gatesai_00001_.png', subfolder: '', type: 'output' }] },
              },
            },
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        },
      },
      {
        match: (u) => u.includes('/view'),
        respond: () => new Response(pngBytes(), { status: 200, headers: { 'content-type': 'image/png' } }),
      },
    ]);

    const client = new ComfyClient({
      baseUrl: 'http://127.0.0.1:8188',
      fetch: fakeFetch,
      sleep: async () => undefined,
      maxPollAttempts: 5,
      pollIntervalMs: 1,
    });

    const result = await client.generate({ prompt: 'a robot', aspectRatio: '1:1', seed: 999 });

    expect(result.backend).toBe('local-comfy');
    expect(result.mime).toBe('image/png');
    expect(result.seed).toBe(999);
    expect(result.base64.length).toBeGreaterThan(0);

    const promptCall = calls.find((c) => c.url.endsWith('/prompt'))!;
    expect(promptCall).toBeTruthy();
    // Poll happened at least once before success.
    expect(calls.filter((c) => c.url.includes('/history/')).length).toBeGreaterThanOrEqual(1);
    expect(calls.some((c) => c.url.includes('/view'))).toBe(true);
  });

  it('substitutes PROMPT/WIDTH/HEIGHT/SEED into the submitted workflow', async () => {
    const submitted: unknown[] = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/prompt')) {
        submitted.push(JSON.parse(init!.body as string));
        return new Response(JSON.stringify({ prompt_id: 'p' }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/history/')) {
        return new Response(JSON.stringify({ p: { outputs: { '9': { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] } } } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(pngBytes(), { status: 200 });
    };
    const client = new ComfyClient({
      baseUrl: 'http://h',
      fetch: fetchImpl as typeof fetch,
      sleep: async () => undefined,
      maxPollAttempts: 3,
      pollIntervalMs: 1,
      workflowTemplate: {
        _comment: 'not a ComfyUI node',
        node: { inputs: { prompt: '{{PROMPT}}', seed: '{{SEED}}', width: '{{WIDTH}}', height: '{{HEIGHT}}' } },
      },
    });
    await client.generate({ prompt: 'blue moon', aspectRatio: '16:9', seed: 7 });
    const submittedFirst = submitted[0] as { prompt: { node: { inputs: Record<string, unknown> } } };
    expect(submittedFirst.prompt.node.inputs.prompt).toBe('blue moon');
    expect(submittedFirst.prompt.node.inputs.seed).toBe(7);
    expect(submittedFirst.prompt.node.inputs.width).toBe(1344);
    expect(submittedFirst.prompt.node.inputs.height).toBe(768);
    expect('_comment' in submittedFirst.prompt).toBe(false);
  });

  it('times out with a clear error if history never reports outputs', async () => {
    const { fetch: fakeFetch } = makeFakeFetch([
      { match: (u) => u.endsWith('/prompt'), respond: () => new Response(JSON.stringify({ prompt_id: 'never' }), { status: 200, headers: { 'content-type': 'application/json' } }) },
      { match: (u) => u.includes('/history/'), respond: () => new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } }) },
    ]);
    const client = new ComfyClient({ baseUrl: 'http://h', fetch: fakeFetch, sleep: async () => undefined, maxPollAttempts: 2, pollIntervalMs: 1 });
    await expect(client.generate({ prompt: 'x' })).rejects.toThrow(/timed out/);
  });

  it('surfaces /prompt rejection', async () => {
    const { fetch: fakeFetch } = makeFakeFetch([
      { match: () => true, respond: () => new Response('bad workflow', { status: 400, statusText: 'Bad Request' }) },
    ]);
    const client = new ComfyClient({ baseUrl: 'http://h', fetch: fakeFetch, sleep: async () => undefined });
    await expect(client.generate({ prompt: 'x' })).rejects.toThrow(/comfy 400.*bad workflow/);
  });
});

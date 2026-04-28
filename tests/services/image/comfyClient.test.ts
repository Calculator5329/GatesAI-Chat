import { describe, expect, it } from 'vitest';
import { applyFilenamePrefix, ComfyClient, stripWorkflowMetadata, substituteWorkflow } from '../../../src/services/image/comfyClient';

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

describe('applyFilenamePrefix', () => {
  it('overrides filename_prefix on every SaveImage node', () => {
    const out = applyFilenamePrefix({
      '1': { class_type: 'KSampler', inputs: { steps: 4 } },
      '2': { class_type: 'SaveImage', inputs: { filename_prefix: 'old_default', images: ['1', 0] } },
      '3': { class_type: 'SaveImage', inputs: { filename_prefix: 'also_old' } },
    }, 'gatesai/sunset-mountain') as Record<string, { class_type: string; inputs?: Record<string, unknown> }>;
    expect(out['1'].inputs?.steps).toBe(4); // non-SaveImage untouched
    expect(out['2'].inputs?.filename_prefix).toBe('gatesai/sunset-mountain');
    expect(out['2'].inputs?.images).toEqual(['1', 0]);
    expect(out['3'].inputs?.filename_prefix).toBe('gatesai/sunset-mountain');
  });

  it('returns workflow unchanged if no SaveImage node exists', () => {
    const wf = { '1': { class_type: 'KSampler', inputs: {} } };
    const out = applyFilenamePrefix(wf, 'whatever');
    expect(out).toEqual(wf);
  });
});

describe('ComfyClient', () => {
  it('submits a prompt, polls /history, and returns a /view URL pointing at the saved file', async () => {
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
                '9': { images: [{ filename: 'gatesai_00001_.png', subfolder: 'gatesai', type: 'output' }] },
              },
            },
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        },
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
    // Runner now records the hosted URL — no double-write to /workspace.
    expect(result.base64).toBeUndefined();
    expect(result.url).toContain('/view?');
    expect(result.url).toContain('filename=gatesai_00001_.png');
    expect(result.url).toContain('subfolder=gatesai');
    expect(result.url).toContain('type=output');

    const promptCall = calls.find((c) => c.url.endsWith('/prompt'))!;
    expect(promptCall).toBeTruthy();
    // Poll happened at least once before success.
    expect(calls.filter((c) => c.url.includes('/history/')).length).toBeGreaterThanOrEqual(1);
    // No /view fetch — the URL is returned for the UI to load directly.
    expect(calls.some((c) => c.url.includes('/view'))).toBe(false);
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
        return new Response(JSON.stringify({ p: { outputs: { '10': { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] } } } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(new Blob([pngBytes().buffer as ArrayBuffer]), { status: 200 });
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

  it('uses explicit pixel dimensions when provided', async () => {
    const submitted: unknown[] = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/prompt')) {
        submitted.push(JSON.parse(init!.body as string));
        return new Response(JSON.stringify({ prompt_id: 'p' }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/history/')) {
        return new Response(JSON.stringify({ p: { outputs: { '10': { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] } } } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(new Blob([pngBytes().buffer as ArrayBuffer]), { status: 200 });
    };
    const client = new ComfyClient({
      baseUrl: 'http://h',
      fetch: fetchImpl as typeof fetch,
      sleep: async () => undefined,
      maxPollAttempts: 3,
      pollIntervalMs: 1,
      workflowTemplate: {
        node: { inputs: { width: '{{WIDTH}}', height: '{{HEIGHT}}' } },
      },
    });

    const out = await client.generate({ prompt: 'wide lake', aspectRatio: '1:1', width: 1360, height: 768, seed: 7 });

    expect(out.width).toBe(1360);
    expect(out.height).toBe(768);
    const submittedFirst = submitted[0] as { prompt: { node: { inputs: Record<string, unknown> } } };
    expect(submittedFirst.prompt.node.inputs.width).toBe(1360);
    expect(submittedFirst.prompt.node.inputs.height).toBe(768);
  });

  it('uses the SDXL Lightning workflow for quick quality', async () => {
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
      return new Response(new Blob([pngBytes().buffer as ArrayBuffer]), { status: 200 });
    };
    const client = new ComfyClient({
      baseUrl: 'http://h',
      fetch: fetchImpl as typeof fetch,
      sleep: async () => undefined,
      qualityPreset: 'quick',
    });

    await client.generate({ prompt: 'fast background', aspectRatio: '16:9', seed: 9 });

    const submittedFirst = submitted[0] as {
      prompt: Record<string, { class_type?: string; inputs?: Record<string, unknown> }>;
    };
    expect(submittedFirst.prompt['1'].class_type).toBe('CheckpointLoaderSimple');
    expect(submittedFirst.prompt['1'].inputs?.ckpt_name).toBe('sdxl_lightning_4step.safetensors');
    expect(submittedFirst.prompt['2'].class_type).toBe('VAELoader');
    expect(submittedFirst.prompt['2'].inputs?.vae_name).toBe('sdxl_vae_fp16_fix.safetensors');
    expect(submittedFirst.prompt['3'].class_type).toBe('CLIPTextEncode');
    expect(submittedFirst.prompt['4'].class_type).toBe('CLIPTextEncode');
    // Quick is a true single-pass Lightning render (no hi-res second
    // sampler) so users get a quick preview rather than a hi-res render
    // taking the same wall-clock as full.
    expect(submittedFirst.prompt['7'].class_type).toBe('VAEDecode');
    expect(submittedFirst.prompt['8'].class_type).toBe('SaveImage');
    expect(submittedFirst.prompt['6'].inputs?.steps).toBe(4);
    expect(submittedFirst.prompt['6'].inputs?.cfg).toBe(1);
    expect(submittedFirst.prompt['6'].inputs?.sampler_name).toBe('euler');
    expect(submittedFirst.prompt['6'].inputs?.scheduler).toBe('sgm_uniform');
    // Quick must not contain a hi-res upscale or second sampler pass.
    for (const node of Object.values(submittedFirst.prompt)) {
      expect(node.class_type).not.toBe('LatentUpscaleBy');
    }
    const ksamplers = Object.values(submittedFirst.prompt).filter(n => n.class_type === 'KSampler');
    expect(ksamplers).toHaveLength(1);
  });

  it('uses the selected FLUX.2 Klein workflow for full quality by default', async () => {
    const submitted: unknown[] = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/prompt')) {
        submitted.push(JSON.parse(init!.body as string));
        return new Response(JSON.stringify({ prompt_id: 'p' }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/history/')) {
        return new Response(JSON.stringify({ p: { outputs: { '94': { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] } } } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(new Blob([pngBytes().buffer as ArrayBuffer]), { status: 200 });
    };
    const client = new ComfyClient({
      baseUrl: 'http://h',
      fetch: fetchImpl as typeof fetch,
      sleep: async () => undefined,
      qualityPreset: 'full',
    });

    await client.generate({ prompt: 'abstract background', aspectRatio: '16:9', seed: 9 });

    const submittedFirst = submitted[0] as {
      prompt: Record<string, { class_type?: string; inputs?: Record<string, unknown> }>;
    };
    expect(submittedFirst.prompt['1'].class_type).toBe('UNETLoader');
    expect(submittedFirst.prompt['1'].inputs?.unet_name).toBe('flux-2-klein-4b-fp8.safetensors');
    expect(submittedFirst.prompt['2'].class_type).toBe('CLIPLoader');
    expect(submittedFirst.prompt['2'].inputs?.clip_name).toBe('qwen_3_4b.safetensors');
    expect(submittedFirst.prompt['9'].class_type).toBe('Flux2Scheduler');
    expect(submittedFirst.prompt['10'].class_type).toBe('EmptyFlux2LatentImage');
    expect(submittedFirst.prompt['11'].class_type).toBe('SamplerCustomAdvanced');
    expect(submittedFirst.prompt['13'].class_type).toBe('SaveImage');
    expect(submittedFirst.prompt['9'].inputs?.width).toBe(1344);
    expect(submittedFirst.prompt['9'].inputs?.height).toBe(768);
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

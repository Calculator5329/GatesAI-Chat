import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyFilenamePrefix,
  builtInComfyWorkflow,
  ComfyClient,
  stripWorkflowMetadata,
  substituteWorkflow,
} from '../../../src/services/image/comfyClient';
import type { ComfyDiscovery } from '../../../src/services/image/comfyDiscovery';
import { bytesToBase64 } from '../../../src/services/image/types';

const runtime = vi.hoisted(() => ({ tauri: false }));
vi.mock('../../../src/core/runtime', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/core/runtime')>(),
  isTauri: () => runtime.tauri,
}));

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
  afterEach(() => {
    runtime.tauri = false;
  });

  it('submits a prompt, polls /history, and reads the saved file back through the same transport', async () => {
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
      {
        match: (u) => u.includes('/view?'),
        respond: () => new Response(pngBytes().buffer as ArrayBuffer, { status: 200, headers: { 'content-type': 'image/png' } }),
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
    // A webview <img> or fetch of /view carries the app's Origin, which
    // ComfyUI refuses, so the client hands back the bytes instead of a URL.
    expect(result.url).toBeUndefined();
    expect(result.base64).toBe(bytesToBase64(pngBytes()));
    expect(result.endpoint).toBe('http://127.0.0.1:8188/view?filename=gatesai_00001_.png&subfolder=gatesai&type=output');

    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/prompt', '/history/abc123', '/history/abc123', '/view']);
  });

  it('fails with the ComfyUI response when the saved file cannot be read', async () => {
    const { fetch: fakeFetch } = makeFakeFetch([
      { match: (u) => u.endsWith('/prompt'), respond: () => new Response(JSON.stringify({ prompt_id: 'p' }), { status: 200 }) },
      {
        match: (u) => u.includes('/history/'),
        respond: () => new Response(JSON.stringify({ p: { outputs: { '9': { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] } } } }), { status: 200 }),
      },
      { match: (u) => u.includes('/view?'), respond: () => new Response('file not found', { status: 404, statusText: 'Not Found' }) },
    ]);
    const client = new ComfyClient({ baseUrl: 'http://h', fetch: fakeFetch, sleep: async () => undefined });

    await expect(client.generate({ prompt: 'x' })).rejects.toThrow(/comfy 404 Not Found: file not found \[\/view\]/);
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
    expect(submittedFirst.prompt['6'].inputs?.steps).toBe(8);
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
    expect(submittedFirst.prompt['9'].inputs?.steps).toBe(12);
    expect(submittedFirst.prompt['6'].inputs?.cfg).toBe(1);
  });

  it('applies configured steps and CFG to built-in quality and draft workflows', async () => {
    const submitted: Array<{ prompt: Record<string, { inputs?: Record<string, unknown> }> }> = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/prompt')) {
        submitted.push(JSON.parse(init!.body as string));
        return new Response(JSON.stringify({ prompt_id: 'p' }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/history/')) {
        return new Response(JSON.stringify({ p: { outputs: { '13': { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] } } } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(new Blob([pngBytes().buffer as ArrayBuffer]), { status: 200 });
    };
    const quality = new ComfyClient({ baseUrl: 'http://h', fetch: fetchImpl as typeof fetch, sleep: async () => undefined, qualitySteps: 18, cfg: 1.4 });
    const draft = new ComfyClient({ baseUrl: 'http://h', fetch: fetchImpl as typeof fetch, sleep: async () => undefined, qualityPreset: 'quick', draftSteps: 7, cfg: 1.2 });

    await quality.generate({ prompt: 'quality', seed: 1 });
    await draft.generate({ prompt: 'draft', seed: 2 });

    expect(submitted[0].prompt['9'].inputs?.steps).toBe(18);
    expect(submitted[0].prompt['6'].inputs?.cfg).toBe(1.4);
    expect(submitted[1].prompt['6'].inputs?.steps).toBe(7);
    expect(submitted[1].prompt['6'].inputs?.cfg).toBe(1.2);
  });

  it('times out with a clear error if history never reports outputs', async () => {
    const { fetch: fakeFetch } = makeFakeFetch([
      { match: (u) => u.endsWith('/prompt'), respond: () => new Response(JSON.stringify({ prompt_id: 'never' }), { status: 200, headers: { 'content-type': 'application/json' } }) },
      { match: (u) => u.includes('/history/'), respond: () => new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } }) },
    ]);
    const client = new ComfyClient({ baseUrl: 'http://h', fetch: fakeFetch, sleep: async () => undefined, maxPollAttempts: 2, pollIntervalMs: 1 });
    await expect(client.generate({ prompt: 'x' })).rejects.toThrow(/timed out/);
  });

  it('in a browser, explains an opaque network failure with the base URL and the CORS flag', async () => {
    const fakeFetch: typeof fetch = async () => { throw new TypeError('Load failed'); };
    const client = new ComfyClient({ baseUrl: 'http://127.0.0.1:8188', fetch: fakeFetch, sleep: async () => undefined });
    await expect(client.generate({ prompt: 'x' }))
      .rejects.toThrow(/could not reach ComfyUI at http:\/\/127\.0\.0\.1:8188 \(Load failed\).*--enable-cors-header/s);
  });

  it('on desktop, says nothing answered and does not blame the CORS flag', async () => {
    runtime.tauri = true;
    const fakeFetch: typeof fetch = async () => { throw new Error('error sending request: connection refused'); };
    const client = new ComfyClient({ baseUrl: 'http://127.0.0.1:8000', fetch: fakeFetch, sleep: async () => undefined });

    const error = await client.generate({ prompt: 'x' }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/could not reach ComfyUI at http:\/\/127\.0\.0\.1:8000 \(error sending request: connection refused\)\. Start ComfyUI or ComfyUI Desktop/);
    expect((error as Error).message).not.toMatch(/cors/i);
  });

  it('reports a cancelled fetch as cancelled, not a connectivity failure', async () => {
    const ac = new AbortController();
    const fakeFetch: typeof fetch = async () => {
      ac.abort();
      throw new DOMException('The operation was aborted.', 'AbortError');
    };
    const client = new ComfyClient({ baseUrl: 'http://h', fetch: fakeFetch, sleep: async () => undefined });
    await expect(client.generate({ prompt: 'x', signal: ac.signal })).rejects.toThrow(/^cancelled$/);
  });

  it('surfaces /prompt rejection', async () => {
    const { fetch: fakeFetch } = makeFakeFetch([
      { match: () => true, respond: () => new Response('bad workflow', { status: 400, statusText: 'Bad Request' }) },
    ]);
    const client = new ComfyClient({ baseUrl: 'http://h', fetch: fakeFetch, sleep: async () => undefined });
    await expect(client.generate({ prompt: 'x' })).rejects.toThrow(/comfy 400.*bad workflow/);
  });
});

type WorkflowNodes = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

function discovered(overrides: Partial<ComfyDiscovery>): ComfyDiscovery {
  return {
    baseUrl: 'http://127.0.0.1:8188',
    online: true,
    checkpoints: [],
    diffusionModels: [],
    textEncoders: [],
    vaes: [],
    preset: null,
    ...overrides,
  };
}

function nodesOf(workflow: Record<string, unknown>, classType: string) {
  return Object.values(workflow as WorkflowNodes).filter((node) => node.class_type === classType);
}

const KLEIN_IN_SUBFOLDERS = {
  diffusionModels: ['flux2/FLUX-2-Klein-4B-fp8.safetensors'],
  textEncoders: ['qwen\\Qwen_3_4b.safetensors'],
  vaes: ['flux2/flux2-vae.safetensors'],
};

describe('builtInComfyWorkflow', () => {
  it('runs FLUX.2 Klein with the file names ComfyUI reported', () => {
    const { workflow } = builtInComfyWorkflow({
      discovery: discovered({ ...KLEIN_IN_SUBFOLDERS, preset: { kind: 'flux2-klein' } }),
      qualityPreset: 'full',
    });

    expect(nodesOf(workflow, 'UNETLoader')[0].inputs.unet_name).toBe('flux2/FLUX-2-Klein-4B-fp8.safetensors');
    expect(nodesOf(workflow, 'CLIPLoader')[0].inputs.clip_name).toBe('qwen\\Qwen_3_4b.safetensors');
    expect(nodesOf(workflow, 'VAELoader')[0].inputs.vae_name).toBe('flux2/flux2-vae.safetensors');
  });

  it('drafts with SDXL Lightning when it sits next to Klein', () => {
    const { workflow, checkpoint } = builtInComfyWorkflow({
      discovery: discovered({
        ...KLEIN_IN_SUBFOLDERS,
        checkpoints: ['sdxl/SDXL_Lightning_4step.safetensors'],
        vaes: [...KLEIN_IN_SUBFOLDERS.vaes, 'sdxl/sdxl_vae_fp16_fix.safetensors'],
        preset: { kind: 'flux2-klein' },
      }),
      qualityPreset: 'quick',
      draftSteps: 5,
    });

    expect(checkpoint).toBe('sdxl/SDXL_Lightning_4step.safetensors');
    expect(nodesOf(workflow, 'VAELoader')[0].inputs.vae_name).toBe('sdxl/sdxl_vae_fp16_fix.safetensors');
    expect(nodesOf(workflow, 'KSampler')[0].inputs.steps).toBe(5);
  });

  it('drafts with Klein at draft steps and no upscale when Lightning is absent', () => {
    const { workflow } = builtInComfyWorkflow({
      discovery: discovered({ ...KLEIN_IN_SUBFOLDERS, preset: { kind: 'flux2-klein' } }),
      qualityPreset: 'quick',
      upscaleFactor: 2,
      draftSteps: 4,
    });

    expect(nodesOf(workflow, 'Flux2Scheduler')[0].inputs.steps).toBe(4);
    expect(nodesOf(workflow, 'ImageScaleBy')).toEqual([]);
  });

  it('decodes SDXL Lightning with its own VAE when the fp16 fix is not installed', () => {
    const { workflow, checkpoint } = builtInComfyWorkflow({
      discovery: discovered({ checkpoints: ['SDXL_Lightning_4step.safetensors'], preset: { kind: 'sdxl-lightning' } }),
      qualityPreset: 'full',
    });

    expect(checkpoint).toBe('SDXL_Lightning_4step.safetensors');
    expect(nodesOf(workflow, 'VAELoader')).toEqual([]);
    expect(nodesOf(workflow, 'VAEDecode')[0].inputs.vae).toEqual(['1', 2]);
  });

  it('runs any other checkpoint through the generic workflow in both modes', () => {
    const discovery = discovered({
      checkpoints: ['sdxl/juggernautXL_v9.safetensors'],
      preset: { kind: 'checkpoint', checkpoint: 'sdxl/juggernautXL_v9.safetensors' },
    });

    for (const qualityPreset of ['full', 'quick'] as const) {
      const { workflow } = builtInComfyWorkflow({ discovery, qualityPreset });
      expect(nodesOf(workflow, 'CheckpointLoaderSimple')[0].inputs.ckpt_name).toBe('sdxl/juggernautXL_v9.safetensors');
      expect(nodesOf(workflow, 'UNETLoader')).toEqual([]);
    }
  });
});

describe('ComfyClient with discovery', () => {
  it('submits the checkpoint name ComfyUI reported, not the default file name', async () => {
    const submitted: Array<{ prompt: WorkflowNodes }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/prompt')) {
        submitted.push(JSON.parse(init!.body as string));
        return new Response(JSON.stringify({ prompt_id: 'p' }), { status: 200 });
      }
      if (url.includes('/history/')) {
        return new Response(JSON.stringify({ p: { outputs: { '8': { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] } } } }), { status: 200 });
      }
      return new Response(new Blob([pngBytes().buffer as ArrayBuffer]), { status: 200 });
    };
    const client = new ComfyClient({
      baseUrl: 'http://127.0.0.1:8000',
      fetch: fetchImpl,
      sleep: async () => undefined,
      discovery: discovered({
        baseUrl: 'http://127.0.0.1:8000',
        checkpoints: ['fast/SDXL_Lightning_4step.safetensors'],
        vaes: ['sdxl_vae_fp16_fix.safetensors'],
        preset: { kind: 'sdxl-lightning' },
      }),
    });

    await client.generate({ prompt: 'a lighthouse', seed: 3 });

    expect(nodesOf(submitted[0].prompt, 'CheckpointLoaderSimple')[0].inputs.ckpt_name).toBe('fast/SDXL_Lightning_4step.safetensors');
  });
});

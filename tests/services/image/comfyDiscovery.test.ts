import { describe, expect, it } from 'vitest';
import {
  COMFY_CANDIDATE_URLS,
  discoverComfy,
  findComfy,
  findFlux2KleinFiles,
  findSdxlLightningFiles,
  type ComfyFetch,
} from '../../../src/services/image/comfyDiscovery';

interface FakeModels {
  checkpoints?: string[];
  unets?: string[];
  clips?: string[];
  vaes?: string[];
  clipTypes?: string[];
  /** Newer ComfyUI node schemas send ["COMBO", { options }] instead of [[options]]. */
  comboStyle?: boolean;
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

/** Answers /system_stats and /object_info/<node> the way ComfyUI does. */
function fakeComfy(models: FakeModels = {}): { fetch: ComfyFetch; paths: string[] } {
  const paths: string[] = [];
  const combo = (options: string[]) => models.comboStyle ? ['COMBO', { options }] : [options, {}];
  const nodes: Record<string, Record<string, string[]>> = {
    CheckpointLoaderSimple: { ckpt_name: models.checkpoints ?? [] },
    UNETLoader: { unet_name: models.unets ?? [], weight_dtype: ['default', 'fp8_e4m3fn'] },
    CLIPLoader: { clip_name: models.clips ?? [], type: models.clipTypes ?? ['stable_diffusion', 'flux2'] },
    VAELoader: { vae_name: models.vaes ?? [] },
  };
  const fetch: ComfyFetch = async (url) => {
    const path = new URL(url).pathname;
    paths.push(path);
    if (path === '/system_stats') return json({ system: { os: 'posix', comfyui_version: '0.4.0' }, devices: [] });
    const node = path.replace('/object_info/', '');
    const inputs = nodes[node];
    if (!inputs) return json({});
    const required = Object.fromEntries(Object.entries(inputs).map(([name, options]) => [name, combo(options)]));
    return json({ [node]: { input: { required }, output: [] } });
  };
  return { fetch, paths };
}

const KLEIN = {
  unets: ['flux-2-klein-4b-fp8.safetensors'],
  clips: ['qwen_3_4b.safetensors'],
  vaes: ['flux2-vae.safetensors'],
};

describe('discoverComfy', () => {
  it('picks FLUX.2 Klein on a server shaped like Ethan\'s ComfyUI', async () => {
    const { fetch, paths } = fakeComfy({
      checkpoints: ['epicrealismXL_pureFix.safetensors', 'sdxl_lightning_4step.safetensors', 'stable-audio-open-1.0.safetensors'],
      unets: ['flux-2-klein-4b-fp8.safetensors', 'flux1-fill-dev-fp8.safetensors'],
      clips: ['clip_l.safetensors', 'qwen_3_4b.safetensors', 't5xxl_fp8_e4m3fn.safetensors'],
      vaes: ['diffusion_pytorch_model.safetensors', 'flux2-vae.safetensors', 'sdxl_vae_fp16_fix.safetensors', 'taesd', 'pixel_space'],
    });

    const result = await discoverComfy('http://127.0.0.1:8188/', fetch);

    expect(result).toMatchObject({
      baseUrl: 'http://127.0.0.1:8188',
      online: true,
      preset: { kind: 'flux2-klein' },
      diffusionModels: ['flux-2-klein-4b-fp8.safetensors', 'flux1-fill-dev-fp8.safetensors'],
    });
    expect(result.error).toBeUndefined();
    expect(result.checkpoints).toContain('sdxl_lightning_4step.safetensors');
    expect(paths).toEqual(expect.arrayContaining([
      '/system_stats',
      '/object_info/CheckpointLoaderSimple',
      '/object_info/UNETLoader',
      '/object_info/CLIPLoader',
      '/object_info/VAELoader',
    ]));
  });

  it('finds Klein files in subfolders and with other capitalization, keeping the reported names', async () => {
    const { fetch } = fakeComfy({
      unets: ['flux2/FLUX-2-Klein-4B.safetensors'],
      clips: ['qwen\\Qwen_3_4b.safetensors'],
      vaes: ['flux2/flux2-vae.safetensors'],
    });

    const result = await discoverComfy('http://127.0.0.1:8188', fetch);

    expect(result.preset).toEqual({ kind: 'flux2-klein' });
    expect(findFlux2KleinFiles(result)).toEqual({
      unet: 'flux2/FLUX-2-Klein-4B.safetensors',
      textEncoder: 'qwen\\Qwen_3_4b.safetensors',
      vae: 'flux2/flux2-vae.safetensors',
    });
  });

  it('skips Klein when one of its files is missing', async () => {
    const { fetch } = fakeComfy({ ...KLEIN, vaes: [], checkpoints: ['sdxl_lightning_4step.safetensors'] });

    const result = await discoverComfy('http://127.0.0.1:8188', fetch);

    expect(result.preset).toEqual({ kind: 'sdxl-lightning' });
  });

  it('skips Klein when this ComfyUI cannot load a FLUX.2 text encoder', async () => {
    const { fetch } = fakeComfy({ ...KLEIN, clipTypes: ['stable_diffusion', 'sd3', 'flux'], checkpoints: ['dreamshaper_8.safetensors'] });

    const result = await discoverComfy('http://127.0.0.1:8188', fetch);

    expect(result.preset).toEqual({ kind: 'checkpoint', checkpoint: 'dreamshaper_8.safetensors' });
  });

  it('does not take the Klein base model for the distilled workflow', async () => {
    const { fetch } = fakeComfy({ ...KLEIN, unets: ['flux-2-klein-base-4b-fp8.safetensors'] });

    const result = await discoverComfy('http://127.0.0.1:8188', fetch);

    expect(result.preset).toBeNull();
  });

  it('picks SDXL Lightning from a subfolder and decodes with the checkpoint VAE when the fp16 fix is absent', async () => {
    const { fetch } = fakeComfy({ checkpoints: ['dreamshaper_8.safetensors', 'fast/SDXL_Lightning_4step.safetensors'], vaes: [] });

    const result = await discoverComfy('http://127.0.0.1:8188', fetch);

    expect(result.preset).toEqual({ kind: 'sdxl-lightning' });
    expect(findSdxlLightningFiles(result)).toEqual({ checkpoint: 'fast/SDXL_Lightning_4step.safetensors', vae: null });
  });

  it('falls back to the first checkpoint that can make an image', async () => {
    const { fetch } = fakeComfy({
      checkpoints: ['stable-audio-open-1.0.safetensors', 'sd_xl_refiner_1.0.safetensors', 'sdxl/juggernautXL_v9.safetensors'],
    });

    const result = await discoverComfy('http://127.0.0.1:8188', fetch);

    expect(result.preset).toEqual({ kind: 'checkpoint', checkpoint: 'sdxl/juggernautXL_v9.safetensors' });
  });

  it('skips a single-file FLUX checkpoint for the generic workflow', async () => {
    const { fetch } = fakeComfy({ checkpoints: ['flux1-dev-fp8.safetensors', 'juggernautXL_v9.safetensors'] });

    const result = await discoverComfy('http://127.0.0.1:8188', fetch);

    expect(result.preset).toEqual({ kind: 'checkpoint', checkpoint: 'juggernautXL_v9.safetensors' });
  });

  it('prefers an SDXL-family checkpoint over an alphabetically earlier one', async () => {
    const { fetch } = fakeComfy({ checkpoints: ['dreamshaper_8.safetensors', 'realvisxlV40.safetensors'] });

    const result = await discoverComfy('http://127.0.0.1:8188', fetch);

    expect(result.preset).toEqual({ kind: 'checkpoint', checkpoint: 'realvisxlV40.safetensors' });
  });

  it('falls back to the first non-FLUX checkpoint when none is SDXL-family', async () => {
    const { fetch } = fakeComfy({ checkpoints: ['FLUX/schnell.safetensors', 'dreamshaper_8.safetensors', 'v1-5-pruned.safetensors'] });

    const result = await discoverComfy('http://127.0.0.1:8188', fetch);

    expect(result.preset).toEqual({ kind: 'checkpoint', checkpoint: 'dreamshaper_8.safetensors' });
  });

  it('reports no preset when the only checkpoint is FLUX', async () => {
    const { fetch } = fakeComfy({ checkpoints: ['flux1-dev-fp8.safetensors'] });

    const result = await discoverComfy('http://127.0.0.1:8188', fetch);

    expect(result).toMatchObject({ online: true, preset: null });
  });

  it('reports online with no preset when nothing usable is installed', async () => {
    const { fetch } = fakeComfy({ checkpoints: ['stable-audio-open-1.0.safetensors'] });

    const result = await discoverComfy('http://127.0.0.1:8000', fetch);

    expect(result).toMatchObject({ online: true, preset: null, baseUrl: 'http://127.0.0.1:8000' });
  });

  it('reads the newer COMBO input schema', async () => {
    const { fetch } = fakeComfy({ comboStyle: true, ...KLEIN });

    const result = await discoverComfy('http://127.0.0.1:8188', fetch);

    expect(result.preset).toEqual({ kind: 'flux2-klein' });
    expect(result.vaes).toEqual(['flux2-vae.safetensors']);
  });

  it('reports a server that does not answer as offline with the address in the reason', async () => {
    const fetch: ComfyFetch = async () => { throw new TypeError('error sending request: connection refused'); };

    const result = await discoverComfy('http://127.0.0.1:8188', fetch);

    expect(result).toMatchObject({ online: false, preset: null, checkpoints: [], diffusionModels: [] });
    expect(result.error).toMatch(/Nothing is answering at http:\/\/127\.0\.0\.1:8188.*connection refused/);
  });

  it('does not mistake another web server on the port for ComfyUI', async () => {
    const fetch: ComfyFetch = async () => new Response('<!doctype html><title>dev server</title>', { status: 200 });

    const result = await discoverComfy('http://127.0.0.1:8000', fetch);

    expect(result.online).toBe(false);
    expect(result.error).toMatch(/not ComfyUI/);
  });

  it('stays online and says which list failed when one model list cannot be read', async () => {
    const base = fakeComfy({ checkpoints: ['dreamshaper_8.safetensors'] });
    const fetch: ComfyFetch = async (url, init) => url.endsWith('/object_info/UNETLoader')
      ? new Response('boom', { status: 500 })
      : base.fetch(url, init);

    const result = await discoverComfy('http://127.0.0.1:8188', fetch);

    expect(result).toMatchObject({ online: true, preset: { kind: 'checkpoint', checkpoint: 'dreamshaper_8.safetensors' } });
    expect(result.error).toMatch(/UNETLoader/);
  });
});

describe('findComfy', () => {
  /** Only the listed origins answer; everything else is refused. */
  function serversAt(origins: string[]): { fetch: ComfyFetch; probed: string[] } {
    const probed: string[] = [];
    const server = fakeComfy({ checkpoints: ['dreamshaper_8.safetensors'] });
    const fetch: ComfyFetch = async (url, init) => {
      const origin = new URL(url).origin;
      if (url.endsWith('/system_stats')) probed.push(origin);
      if (!origins.includes(origin)) throw new TypeError('connection refused');
      return server.fetch(url, init);
    };
    return { fetch, probed };
  }

  it('finds ComfyUI Desktop on 8000 when the saved address is down', async () => {
    const { fetch, probed } = serversAt(['http://127.0.0.1:8000']);

    const result = await findComfy('http://127.0.0.1:8188', fetch);

    expect(result).toMatchObject({ online: true, baseUrl: 'http://127.0.0.1:8000' });
    expect(probed).toEqual(['http://127.0.0.1:8188', 'http://127.0.0.1:8000']);
  });

  it('uses a remote preferred address without probing the defaults', async () => {
    const { fetch, probed } = serversAt(['http://gpu-box:8188', 'http://127.0.0.1:8188']);

    const result = await findComfy('http://gpu-box:8188', fetch);

    expect(result.baseUrl).toBe('http://gpu-box:8188');
    expect(probed).toEqual(['http://gpu-box:8188']);
  });

  it('returns the preferred address offline result when nothing answers', async () => {
    const { fetch, probed } = serversAt([]);

    const result = await findComfy('http://gpu-box:8188', fetch);

    expect(result).toMatchObject({ online: false, baseUrl: 'http://gpu-box:8188' });
    expect(probed).toEqual(['http://gpu-box:8188', ...COMFY_CANDIDATE_URLS]);
  });

  it('tries the candidates in order when there is no saved address', async () => {
    const { fetch, probed } = serversAt([]);

    const result = await findComfy(undefined, fetch);

    expect(result.baseUrl).toBe(COMFY_CANDIDATE_URLS[0]);
    expect(probed).toEqual([...COMFY_CANDIDATE_URLS]);
  });
});

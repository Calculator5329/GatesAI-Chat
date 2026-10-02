// Finds a running ComfyUI and decides which built-in workflow fits the models installed in it.
// Called by LocalRuntimeStore's probe cycle and by ComfyClient for exact file names; depends on ComfyUI's /system_stats and /object_info APIs.
// Invariant: discovery never throws; an unreachable server is an offline result with a reason.
import { localFetch } from '../local/localHttp';
import { isRecord } from '../../core/guards';
import { FLUX2_KLEIN_DEFAULT_FILES, type Flux2KleinFiles } from './workflows/finalFlux2Klein';
import { SDXL_FP16_FIX_VAE, SDXL_LIGHTNING_CHECKPOINT } from './workflows/sdxlLightning';

/** Transport for every ComfyUI request: the Rust pass-through on desktop, window.fetch in a browser. */
export type ComfyFetch = typeof localFetch;

export type ComfyPresetChoice =
  | { kind: 'flux2-klein' }
  | { kind: 'sdxl-lightning' }
  | { kind: 'checkpoint'; checkpoint: string };

export interface ComfyDiscovery {
  baseUrl: string;
  online: boolean;
  error?: string;
  /** CheckpointLoaderSimple ckpt_name options, exactly as ComfyUI reported them. */
  checkpoints: string[];
  /** UNETLoader unet_name options. */
  diffusionModels: string[];
  /**
   * CLIPLoader clip_name and VAELoader vae_name options. discoverComfy always
   * fills them; they are optional so a discovery built elsewhere stays valid,
   * and the workflows then fall back to the default filenames.
   */
  textEncoders?: string[];
  vaes?: string[];
  /** What the app will use; null = online but no usable model. */
  preset: ComfyPresetChoice | null;
}

/** Manual installs listen on 8188, ComfyUI Desktop on 8000. */
export const COMFY_CANDIDATE_URLS: readonly string[] = ['http://127.0.0.1:8188', 'http://127.0.0.1:8000'];

const DISCOVERY_TIMEOUT_MS = 5_000;

/** Distilled FLUX.2 Klein 4B weights (fp8 from BFL, bf16 from Comfy-Org). The base model needs a different sampler setup. */
const FLUX2_KLEIN_UNETS = [FLUX2_KLEIN_DEFAULT_FILES.unet, 'flux-2-klein-4b.safetensors'];

/** Checkpoints that load in CheckpointLoaderSimple but cannot make a still image from text. */
const NON_IMAGE_CHECKPOINT = /audio|video|svd|inpaint|refiner/i;

/**
 * Single-file FLUX checkpoints are guidance-distilled; the generic workflow's
 * CFG 6 and negative prompt wreck them. Matched on the full reported name so a
 * `flux/` subfolder counts too.
 */
const FLUX_CHECKPOINT = /flux/i;

/** The generic workflow renders at SDXL sizes, so SDXL-family names win. */
const SDXL_FAMILY_CHECKPOINT = /xl/i;

export interface SdxlLightningFiles {
  checkpoint: string;
  /** null = decode with the checkpoint's own VAE. */
  vae: string | null;
}

/**
 * Asks one ComfyUI server whether it is up and which models it has, then
 * picks the preset: FLUX.2 Klein when all its files are present, else SDXL
 * Lightning when its checkpoint is present, else a generic image checkpoint
 * (see {@link chooseGenericCheckpoint}).
 */
export async function discoverComfy(baseUrl: string, fetchImpl: ComfyFetch = localFetch): Promise<ComfyDiscovery> {
  const base = baseUrl.trim().replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  const get = (path: string) => fetchImpl(`${base}${path}`, { signal: controller.signal });
  try {
    let stats: Response;
    try {
      stats = await get('/system_stats');
    } catch (err) {
      return offline(base, controller.signal.aborted
        ? `No answer from ${base} within ${DISCOVERY_TIMEOUT_MS / 1000} s`
        : `Nothing is answering at ${base} (${errorMessage(err)})`);
    }
    if (!stats.ok) return offline(base, `${base}/system_stats answered HTTP ${stats.status}`);
    const body: unknown = await stats.json().catch(() => null);
    if (!isRecord(body) || !isRecord(body.system)) return offline(base, `The server at ${base} is not ComfyUI`);

    const failed: string[] = [];
    const nodeInfo = async (node: string): Promise<unknown> => {
      try {
        const resp = await get(`/object_info/${node}`);
        if (resp.ok) return await resp.json();
      } catch {
        // Recorded below; a missing list only narrows the preset choice.
      }
      failed.push(node);
      return null;
    };
    const [checkpointInfo, unetInfo, clipInfo, vaeInfo] = await Promise.all([
      nodeInfo('CheckpointLoaderSimple'),
      nodeInfo('UNETLoader'),
      nodeInfo('CLIPLoader'),
      nodeInfo('VAELoader'),
    ]);
    const lists = {
      checkpoints: comboOptions(checkpointInfo, 'CheckpointLoaderSimple', 'ckpt_name'),
      diffusionModels: comboOptions(unetInfo, 'UNETLoader', 'unet_name'),
      textEncoders: comboOptions(clipInfo, 'CLIPLoader', 'clip_name'),
      vaes: comboOptions(vaeInfo, 'VAELoader', 'vae_name'),
    };
    // Older ComfyUI builds have the loaders but not the FLUX.2 text encoder type.
    const flux2Supported = comboOptions(clipInfo, 'CLIPLoader', 'type').includes('flux2');
    return {
      baseUrl: base,
      online: true,
      ...(failed.length > 0 ? { error: `Could not read the model list for ${failed.join(', ')}` } : {}),
      ...lists,
      preset: choosePreset(lists, flux2Supported),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tries preferredUrl first, then the candidates; returns the first online one,
 * else the offline result for preferredUrl.
 */
export async function findComfy(preferredUrl: string | undefined, fetchImpl: ComfyFetch = localFetch): Promise<ComfyDiscovery> {
  const [first, ...rest] = candidateUrls(preferredUrl);
  const preferred = await discoverComfy(first, fetchImpl);
  if (preferred.online) return preferred;
  for (const url of rest) {
    const result = await discoverComfy(url, fetchImpl);
    if (result.online) return result;
  }
  return preferred;
}

/** FLUX.2 Klein files as this ComfyUI names them, or null when any is missing. */
export function findFlux2KleinFiles(discovery: Pick<ComfyDiscovery, 'diffusionModels' | 'textEncoders' | 'vaes'>): Flux2KleinFiles | null {
  const unet = findReported(discovery.diffusionModels, FLUX2_KLEIN_UNETS);
  const textEncoder = findReported(discovery.textEncoders ?? [], [FLUX2_KLEIN_DEFAULT_FILES.textEncoder]);
  const vae = findReported(discovery.vaes ?? [], [FLUX2_KLEIN_DEFAULT_FILES.vae]);
  return unet && textEncoder && vae ? { unet, textEncoder, vae } : null;
}

/**
 * SDXL Lightning files as this ComfyUI names them, or null without the
 * checkpoint. The fp16-fix VAE is optional; when the VAE list is unknown the
 * default name is kept.
 */
export function findSdxlLightningFiles(discovery: Pick<ComfyDiscovery, 'checkpoints' | 'vaes'>): SdxlLightningFiles | null {
  const checkpoint = findReported(discovery.checkpoints, [SDXL_LIGHTNING_CHECKPOINT]);
  if (!checkpoint) return null;
  const vae = discovery.vaes ? findReported(discovery.vaes, [SDXL_FP16_FIX_VAE]) ?? null : SDXL_FP16_FIX_VAE;
  return { checkpoint, vae };
}

function choosePreset(
  lists: Required<Pick<ComfyDiscovery, 'checkpoints' | 'diffusionModels' | 'textEncoders' | 'vaes'>>,
  flux2Supported: boolean,
): ComfyPresetChoice | null {
  if (flux2Supported && findFlux2KleinFiles(lists)) return { kind: 'flux2-klein' };
  if (findSdxlLightningFiles(lists)) return { kind: 'sdxl-lightning' };
  const checkpoint = chooseGenericCheckpoint(lists.checkpoints);
  return checkpoint ? { kind: 'checkpoint', checkpoint } : null;
}

/**
 * Checkpoint for the generic workflow: skips non-image and FLUX files, then
 * prefers an SDXL-family name, else the first one left in ComfyUI's order.
 */
function chooseGenericCheckpoint(checkpoints: readonly string[]): string | undefined {
  const usable = checkpoints.filter(name => !NON_IMAGE_CHECKPOINT.test(basename(name)) && !FLUX_CHECKPOINT.test(name));
  return usable.find(name => SDXL_FAMILY_CHECKPOINT.test(name)) ?? usable[0];
}

/**
 * First reported entry whose file name matches a wanted name, ignoring case
 * and any subfolder (`sdxl/SDXL_Lightning_4step.safetensors` matches). Earlier
 * wanted names win.
 */
function findReported(reported: readonly string[], wanted: readonly string[]): string | undefined {
  for (const name of wanted) {
    const match = reported.find(entry => basename(entry).toLowerCase() === name.toLowerCase());
    if (match) return match;
  }
  return undefined;
}

/** ComfyUI reports subfolders with the host's separator. */
function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/**
 * Reads a combo input's options from an /object_info/<node> body. Older
 * ComfyUI sends `[[...options], {...}]`; newer node schemas send
 * `["COMBO", { options: [...] }]`.
 */
function comboOptions(info: unknown, node: string, input: string): string[] {
  if (!isRecord(info)) return [];
  const def = info[node];
  if (!isRecord(def) || !isRecord(def.input) || !isRecord(def.input.required)) return [];
  const spec = def.input.required[input];
  if (!Array.isArray(spec)) return [];
  const [kind, config] = spec as unknown[];
  const options = Array.isArray(kind)
    ? kind
    : kind === 'COMBO' && isRecord(config) && Array.isArray(config.options) ? config.options : [];
  return options.filter((option): option is string => typeof option === 'string');
}

function candidateUrls(preferredUrl: string | undefined): string[] {
  const urls = [preferredUrl, ...COMFY_CANDIDATE_URLS]
    .map(url => url?.trim().replace(/\/+$/, ''))
    .filter((url): url is string => Boolean(url));
  return [...new Set(urls)];
}

function offline(baseUrl: string, error: string): ComfyDiscovery {
  return { baseUrl, online: false, error, checkpoints: [], diffusionModels: [], textEncoders: [], vaes: [], preset: null };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Stable built-in "full" workflow: FLUX.2 Klein 4B FP8, 4-step distilled base,
 * with optional hires-fix pass.
 *
 * The base path is single-pass (Klein samples in 4 steps) and saves directly
 * after VAE decode — fast, reliable, no custom-node dependencies.
 *
 * When `upscaleFactor > 1`, an extra hires-fix chain is appended:
 *   VAEDecode  →  ImageScaleBy (lanczos)  →  VAEEncode  →
 *   KSampler (denoise=0.45, 4 steps)  →  VAEDecode  →  SaveImage
 *
 * Lanczos pixel-space upscale + low-denoise refinement is the standard
 * ComfyUI hires-fix technique: composition is preserved, fine detail comes
 * back, no extra model files required, and we stay clear of UltimateSDUpscale
 * (whose VAE decode path crashed the Python process on some Windows/CUDA
 * stacks).
 */

export interface BuildOptions {
  /** Hires-fix multiplier. `1` (default) skips the second pass entirely. */
  upscaleFactor?: number;
  /** Refinement denoise strength for the hires pass. Default 0.45 — strong
   *  enough to add detail, gentle enough to keep composition. */
  hiresDenoise?: number;
  /** Sampling steps for the hires pass. Default 4 to match base. */
  hiresSteps?: number;
}

const DEFAULT_GUIDANCE = 1.0;

/**
 * Build the FluxKlein workflow. When `upscaleFactor > 1`, the SaveImage
 * input is rerouted to the hires-pass output instead of the base decode.
 *
 * Token placeholders (`{{PROMPT}}`, `{{WIDTH}}`, `{{HEIGHT}}`, `{{SEED}}`)
 * are still substituted by `substituteWorkflow` at submit time — the
 * builder only changes the graph topology, not the substituted values.
 */
export function buildFinalFlux2KleinWorkflow(opts: BuildOptions = {}): Record<string, unknown> {
  const factor = opts.upscaleFactor ?? 1;
  const denoise = opts.hiresDenoise ?? 0.45;
  const steps = opts.hiresSteps ?? 4;

  const base: Record<string, unknown> = {
    '1': {
      class_type: 'UNETLoader',
      inputs: { unet_name: 'flux-2-klein-4b-fp8.safetensors', weight_dtype: 'default' },
    },
    '2': {
      class_type: 'CLIPLoader',
      inputs: { clip_name: 'qwen_3_4b.safetensors', type: 'flux2' },
    },
    '3': {
      class_type: 'VAELoader',
      inputs: { vae_name: 'flux2-vae.safetensors' },
    },
    '4': {
      class_type: 'CLIPTextEncode',
      inputs: { text: '{{PROMPT}}', clip: ['2', 0] },
    },
    '5': {
      class_type: 'CLIPTextEncode',
      inputs: { text: '', clip: ['2', 0] },
    },
    '6': {
      class_type: 'CFGGuider',
      inputs: { model: ['1', 0], positive: ['4', 0], negative: ['5', 0], cfg: DEFAULT_GUIDANCE },
    },
    '7': {
      class_type: 'RandomNoise',
      inputs: { noise_seed: '{{SEED}}' },
    },
    '8': {
      class_type: 'KSamplerSelect',
      inputs: { sampler_name: 'euler' },
    },
    '9': {
      class_type: 'Flux2Scheduler',
      inputs: { steps: 4, width: '{{WIDTH}}', height: '{{HEIGHT}}' },
    },
    '10': {
      class_type: 'EmptyFlux2LatentImage',
      inputs: { width: '{{WIDTH}}', height: '{{HEIGHT}}', batch_size: 1 },
    },
    '11': {
      class_type: 'SamplerCustomAdvanced',
      inputs: { noise: ['7', 0], guider: ['6', 0], sampler: ['8', 0], sigmas: ['9', 0], latent_image: ['10', 0] },
    },
    '12': {
      class_type: 'VAEDecode',
      inputs: { samples: ['11', 0], vae: ['3', 0] },
    },
  };

  if (factor > 1) {
    // Hires-fix chain: pixel-upscale the decoded image, encode back to
    // latent, run a low-denoise refinement pass, decode again.
    base['14'] = {
      class_type: 'ImageScaleBy',
      inputs: { image: ['12', 0], upscale_method: 'lanczos', scale_by: factor },
    };
    base['15'] = {
      class_type: 'VAEEncode',
      inputs: { pixels: ['14', 0], vae: ['3', 0] },
    };
    // Use the standard `KSampler` for the refinement pass — it knows how
    // to compute partial-denoise sigmas from the `denoise` arg, which is
    // simpler than building a `SplitSigmas` chain on Flux2Scheduler. Klein
    // works fine with `simple` scheduler at low denoise.
    base['16'] = {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['4', 0],
        negative: ['5', 0],
        latent_image: ['15', 0],
        // Offset the seed so the refinement noise is independent of the
        // base pass — otherwise the same noise pattern compounds.
        seed: '{{SEED_PLUS_1}}',
        steps,
        cfg: DEFAULT_GUIDANCE,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise,
      },
    };
    base['17'] = {
      class_type: 'VAEDecode',
      inputs: { samples: ['16', 0], vae: ['3', 0] },
    };
    base['13'] = {
      class_type: 'SaveImage',
      inputs: { filename_prefix: 'gatesai_final_flux2_klein_fp8', images: ['17', 0] },
    };
  } else {
    base['13'] = {
      class_type: 'SaveImage',
      inputs: { filename_prefix: 'gatesai_final_flux2_klein_fp8', images: ['12', 0] },
    };
  }

  return base;
}

/**
 * Backwards-compatible default export — equivalent to a 1x build (no hires).
 * Existing call sites that imported the const get the same behavior they
 * had before the rename. New call sites should call
 * {@link buildFinalFlux2KleinWorkflow} with explicit options instead.
 */
export const FINAL_FLUX2_KLEIN_WORKFLOW: Record<string, unknown> = buildFinalFlux2KleinWorkflow();

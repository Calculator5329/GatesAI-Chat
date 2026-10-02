/** Checkpoint filename from ByteDance/SDXL-Lightning that the quick workflow is tuned for. */
export const SDXL_LIGHTNING_CHECKPOINT = 'sdxl_lightning_4step.safetensors';
/** SDXL VAE patched to decode in fp16 without washed-out or black images. */
export const SDXL_FP16_FIX_VAE = 'sdxl_vae_fp16_fix.safetensors';

export interface SdxlLightningOptions {
  steps?: number;
  cfg?: number;
  /**
   * VAELoader file. Defaults to {@link SDXL_FP16_FIX_VAE}; `null` decodes
   * with the checkpoint's own VAE when no separate VAE is installed.
   */
  vae?: string | null;
}

/**
 * Quick-prototype workflow: SDXL Lightning at base resolution with configurable sampling
 * steps, no hi-res fix. Trades polished-image detail
 * polish for speed — typically <10s per image on a mid-range GPU.
 *
 * The previous version added a 1.5x latent upscale plus a second
 * 3-step sampler at 0.35 denoise, which roughly doubled wall-clock
 * time. That defeated the point of the quick lane — users picking quick
 * want a fast preview, not a polished hi-res render.
 *
 * The checkpoint name stays a `{{CHECKPOINT}}` token that ComfyClient fills
 * with the file ComfyUI actually reported.
 */
export function buildSdxlLightningQuickWorkflow(opts: SdxlLightningOptions = {}): Record<string, unknown> {
  const steps = opts.steps ?? 8;
  const cfg = opts.cfg ?? 1;
  const vae = opts.vae === undefined ? SDXL_FP16_FIX_VAE : opts.vae;
  const workflow: Record<string, unknown> = {
  '1': {
    class_type: 'CheckpointLoaderSimple',
    inputs: { ckpt_name: '{{CHECKPOINT}}' },
  },
  '3': {
    class_type: 'CLIPTextEncode',
    inputs: { text: '{{PROMPT}}', clip: ['1', 1] },
  },
  '4': {
    class_type: 'CLIPTextEncode',
    inputs: {
      text: 'text, letters, watermark, logo, blurry, low quality, jpeg artifacts, distorted, deformed',
      clip: ['1', 1],
    },
  },
  '5': {
    class_type: 'EmptyLatentImage',
    inputs: { width: '{{WIDTH}}', height: '{{HEIGHT}}', batch_size: 1 },
  },
  '6': {
    class_type: 'KSampler',
    inputs: {
      seed: '{{SEED}}',
      steps,
      cfg,
      sampler_name: 'euler',
      scheduler: 'sgm_uniform',
      denoise: 1,
      model: ['1', 0],
      positive: ['3', 0],
      negative: ['4', 0],
      latent_image: ['5', 0],
    },
  },
  '7': {
    class_type: 'VAEDecode',
    inputs: { samples: ['6', 0], vae: vae ? ['2', 0] : ['1', 2] },
  },
  '8': {
    class_type: 'SaveImage',
    inputs: { filename_prefix: 'gatesai_quick', images: ['7', 0] },
  },
  };
  if (vae) {
    workflow['2'] = { class_type: 'VAELoader', inputs: { vae_name: vae } };
  }
  return workflow;
}

export const SDXL_LIGHTNING_QUICK_WORKFLOW: Record<string, unknown> = buildSdxlLightningQuickWorkflow();

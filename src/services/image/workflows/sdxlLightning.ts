/**
 * Quick-prototype workflow: SDXL Lightning at base resolution, 4 sampling
 * steps, no hi-res fix. Trades polished-image detail
 * polish for speed — typically <10s per image on a mid-range GPU.
 *
 * The previous version added a 1.5x latent upscale plus a second
 * 3-step sampler at 0.35 denoise, which roughly doubled wall-clock
 * time. That defeated the point of the quick lane — users picking quick
 * want a fast preview, not a polished hi-res render.
 *
 * Includes the fp16-fix VAE so SDXL renders don't come out washed-out.
 */
export const SDXL_LIGHTNING_QUICK_WORKFLOW: Record<string, unknown> = {
  '1': {
    class_type: 'CheckpointLoaderSimple',
    inputs: { ckpt_name: '{{CHECKPOINT}}' },
  },
  '2': {
    class_type: 'VAELoader',
    inputs: { vae_name: 'sdxl_vae_fp16_fix.safetensors' },
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
      steps: 4,
      cfg: 1,
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
    inputs: { samples: ['6', 0], vae: ['2', 0] },
  },
  '8': {
    class_type: 'SaveImage',
    inputs: { filename_prefix: 'gatesai_quick', images: ['7', 0] },
  },
};

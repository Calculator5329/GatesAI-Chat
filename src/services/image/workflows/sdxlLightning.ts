/**
 * Conservative Lightning workflow with:
 * - fp16-fix VAE to prevent washed-out colours on SDXL
 * - hi-res fix via 1.5x latent upscale and low-denoise second sampler pass
 */
export const SDXL_LIGHTNING_HIRES_WORKFLOW: Record<string, unknown> = {
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
    class_type: 'LatentUpscaleBy',
    inputs: { samples: ['6', 0], upscale_method: 'bicubic', scale_by: 1.5 },
  },
  '8': {
    class_type: 'KSampler',
    inputs: {
      seed: '{{SEED}}',
      steps: 3,
      cfg: 1,
      sampler_name: 'euler',
      scheduler: 'sgm_uniform',
      denoise: 0.35,
      model: ['1', 0],
      positive: ['3', 0],
      negative: ['4', 0],
      latent_image: ['7', 0],
    },
  },
  '9': {
    class_type: 'VAEDecode',
    inputs: { samples: ['8', 0], vae: ['2', 0] },
  },
  '10': {
    class_type: 'SaveImage',
    inputs: { filename_prefix: 'gatesai_hires', images: ['9', 0] },
  },
};

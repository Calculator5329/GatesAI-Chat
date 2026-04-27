/**
 * Selected final workflow: FLUX.2 Klein 4B FP8, 4-step distilled base,
 * single-pass 2x Ultimate SD Upscale with wide linear tiles.
 */
export const FINAL_FLUX2_KLEIN_WORKFLOW: Record<string, unknown> = {
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
    inputs: { model: ['1', 0], positive: ['4', 0], negative: ['5', 0], cfg: 1.0 },
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
  '90': {
    class_type: 'UpscaleModelLoader',
    inputs: { model_name: '4x-UltraSharp.pth' },
  },
  '91': {
    class_type: 'UltimateSDUpscale',
    inputs: {
      image: ['12', 0],
      model: ['1', 0],
      positive: ['4', 0],
      negative: ['5', 0],
      vae: ['3', 0],
      upscale_by: 2.0,
      seed: '{{SEED}}',
      steps: 5,
      cfg: 1.0,
      sampler_name: 'euler',
      scheduler: 'simple',
      denoise: 0.2,
      upscale_model: ['90', 0],
      mode_type: 'Linear',
      tile_width: 1536,
      tile_height: 1024,
      mask_blur: 16,
      tile_padding: 64,
      seam_fix_mode: 'Half Tile',
      seam_fix_denoise: 0.4,
      seam_fix_width: 64,
      seam_fix_mask_blur: 16,
      seam_fix_padding: 24,
      force_uniform_tiles: true,
      tiled_decode: false,
      batch_size: 1,
    },
  },
  '93': {
    class_type: 'ImageSharpen',
    inputs: { image: ['91', 0], sharpen_radius: 1, sigma: 0.5, alpha: 0.15 },
  },
  '94': {
    class_type: 'SaveImage',
    inputs: { filename_prefix: 'gatesai_final_flux2_klein_fp8', images: ['93', 0] },
  },
};

/**
 * Generic text-to-image workflow for a single-file SDXL-family checkpoint
 * (SDXL and its fine-tunes). It renders at the SDXL sizes ComfyClient fills
 * in, and its CFG and negative prompt do not suit guidance-distilled FLUX
 * files, which discovery skips:
 *
 *   CheckpointLoaderSimple -> CLIPTextEncode (positive, negative)
 *   -> EmptyLatentImage -> KSampler -> VAEDecode -> SaveImage
 *
 * The app falls back to this when ComfyUI has neither FLUX.2 Klein nor
 * SDXL Lightning installed. Prompt, size and seed stay `{{PROMPT}}`,
 * `{{WIDTH}}`, `{{HEIGHT}}` and `{{SEED}}` tokens that ComfyClient fills at
 * submit time, like the other built-in workflows.
 */

export interface CheckpointWorkflowOptions {
  /** ckpt_name exactly as ComfyUI reported it, subfolder included. */
  checkpoint: string;
}

interface CheckpointSampling {
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
}

const NEGATIVE_PROMPT = 'text, letters, watermark, logo, blurry, low quality, jpeg artifacts, distorted, deformed';

/**
 * Sampling defaults guessed from the checkpoint name. Few-step distilled
 * models (Lightning, Turbo, LCM) fall apart at 25 steps and high CFG, so
 * they get a short schedule with guidance close to off.
 */
function checkpointSampling(checkpoint: string): CheckpointSampling {
  const name = checkpoint.toLowerCase();
  if (name.includes('lcm')) return { steps: 6, cfg: 1.5, sampler: 'lcm', scheduler: 'sgm_uniform' };
  if (name.includes('lightning') || name.includes('turbo')) {
    return { steps: 6, cfg: 1, sampler: 'euler', scheduler: 'sgm_uniform' };
  }
  return { steps: 25, cfg: 6, sampler: 'euler', scheduler: 'normal' };
}

export function buildCheckpointWorkflow(opts: CheckpointWorkflowOptions): Record<string, unknown> {
  const sampling = checkpointSampling(opts.checkpoint);
  return {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: opts.checkpoint },
    },
    '2': {
      class_type: 'CLIPTextEncode',
      inputs: { text: '{{PROMPT}}', clip: ['1', 1] },
    },
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: { text: NEGATIVE_PROMPT, clip: ['1', 1] },
    },
    '4': {
      class_type: 'EmptyLatentImage',
      inputs: { width: '{{WIDTH}}', height: '{{HEIGHT}}', batch_size: 1 },
    },
    '5': {
      class_type: 'KSampler',
      inputs: {
        seed: '{{SEED}}',
        steps: sampling.steps,
        cfg: sampling.cfg,
        sampler_name: sampling.sampler,
        scheduler: sampling.scheduler,
        denoise: 1,
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0],
      },
    },
    '6': {
      class_type: 'VAEDecode',
      inputs: { samples: ['5', 0], vae: ['1', 2] },
    },
    '7': {
      class_type: 'SaveImage',
      inputs: { filename_prefix: 'gatesai_checkpoint', images: ['6', 0] },
    },
  };
}

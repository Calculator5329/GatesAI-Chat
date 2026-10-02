import { describe, expect, it } from 'vitest';
import { buildCheckpointWorkflow } from '../../../../src/services/image/workflows/checkpoint';
import { buildSdxlLightningQuickWorkflow } from '../../../../src/services/image/workflows/sdxlLightning';

interface Node {
  class_type: string;
  inputs: Record<string, unknown>;
}

function nodes(workflow: Record<string, unknown>): Record<string, Node> {
  return workflow as Record<string, Node>;
}

function byClass(workflow: Record<string, unknown>, classType: string): Array<[string, Node]> {
  return Object.entries(nodes(workflow)).filter(([, node]) => node.class_type === classType);
}

describe('buildCheckpointWorkflow', () => {
  it('wires one checkpoint through text encode, sampling, decode and save', () => {
    const workflow = buildCheckpointWorkflow({ checkpoint: 'sdxl/juggernautXL_v9.safetensors' });

    const [[loaderId, loader]] = byClass(workflow, 'CheckpointLoaderSimple');
    expect(loader.inputs.ckpt_name).toBe('sdxl/juggernautXL_v9.safetensors');

    const [[samplerId, sampler]] = byClass(workflow, 'KSampler');
    const graph = nodes(workflow);
    const [positiveId] = sampler.inputs.positive as [string, number];
    const [negativeId] = sampler.inputs.negative as [string, number];
    const [latentId] = sampler.inputs.latent_image as [string, number];
    expect(sampler.inputs.model).toEqual([loaderId, 0]);
    expect(graph[positiveId]).toMatchObject({ class_type: 'CLIPTextEncode', inputs: { text: '{{PROMPT}}', clip: [loaderId, 1] } });
    expect(graph[negativeId]).toMatchObject({ class_type: 'CLIPTextEncode', inputs: { clip: [loaderId, 1] } });
    expect(graph[negativeId].inputs.text).toMatch(/watermark/);
    expect(graph[latentId]).toMatchObject({
      class_type: 'EmptyLatentImage',
      inputs: { width: '{{WIDTH}}', height: '{{HEIGHT}}', batch_size: 1 },
    });
    expect(sampler.inputs.seed).toBe('{{SEED}}');

    const [[decodeId, decode]] = byClass(workflow, 'VAEDecode');
    expect(decode.inputs).toEqual({ samples: [samplerId, 0], vae: [loaderId, 2] });
    const [[, save]] = byClass(workflow, 'SaveImage');
    expect(save.inputs.images).toEqual([decodeId, 0]);
  });

  it('samples a regular checkpoint at about 25 steps and cfg 6', () => {
    const [[, sampler]] = byClass(buildCheckpointWorkflow({ checkpoint: 'dreamshaper_8.safetensors' }), 'KSampler');

    expect(sampler.inputs).toMatchObject({ steps: 25, cfg: 6, sampler_name: 'euler', scheduler: 'normal', denoise: 1 });
  });

  it.each([
    'RealVisXL_V4.0_Lightning.safetensors',
    'sd_xl_turbo_1.0_fp16.safetensors',
    'dreamshaper_8_LCM.safetensors',
  ])('gives the few-step model %s a short schedule with low guidance', (checkpoint) => {
    const [[, sampler]] = byClass(buildCheckpointWorkflow({ checkpoint }), 'KSampler');
    const steps = sampler.inputs.steps as number;
    const cfg = sampler.inputs.cfg as number;

    expect(steps).toBeGreaterThanOrEqual(4);
    expect(steps).toBeLessThanOrEqual(8);
    expect(cfg).toBeGreaterThanOrEqual(1);
    expect(cfg).toBeLessThanOrEqual(2);
  });
});

describe('buildSdxlLightningQuickWorkflow', () => {
  it('loads the fp16-fix VAE by default', () => {
    const workflow = buildSdxlLightningQuickWorkflow();

    const [[vaeId, vae]] = byClass(workflow, 'VAELoader');
    expect(vae.inputs.vae_name).toBe('sdxl_vae_fp16_fix.safetensors');
    expect(byClass(workflow, 'VAEDecode')[0][1].inputs.vae).toEqual([vaeId, 0]);
  });

  it('decodes with the checkpoint VAE when no separate VAE is installed', () => {
    const workflow = buildSdxlLightningQuickWorkflow({ vae: null });

    expect(byClass(workflow, 'VAELoader')).toEqual([]);
    const [[loaderId]] = byClass(workflow, 'CheckpointLoaderSimple');
    expect(byClass(workflow, 'VAEDecode')[0][1].inputs.vae).toEqual([loaderId, 2]);
  });
});

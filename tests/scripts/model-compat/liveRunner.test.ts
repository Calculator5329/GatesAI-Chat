import { describe, expect, it, vi } from 'vitest';
import type { OpenRouterCatalogModel } from '../../../scripts/model-compat/catalog';
import {
  estimateCompatibilityCost,
  runLiveCompatibility,
  type LiveProbeResult,
} from '../../../scripts/model-compat/liveRunner';

function target(id: string, supportsTools = true): OpenRouterCatalogModel {
  return {
    id,
    name: id,
    created: 1,
    supported_parameters: supportsTools ? ['tools'] : [],
    architecture: { output_modalities: ['text'] },
    pricing: { prompt: '0.000001', completion: '0.000002', request: '0' },
  };
}

function result(modelId: string, costUsd: number, ok = true): LiveProbeResult {
  return {
    modelId,
    ok,
    supportsTools: true,
    durationMs: 10,
    costUsd,
    text: { ok, text: 'GATESAI_COMPAT_OK', toolCalls: [], usage: [] },
  };
}

describe('model compatibility live runner', () => {
  it('estimates a conservative bounded request cost', () => {
    expect(estimateCompatibilityCost([target('tool'), target('text', false)]))
      .toBeCloseTo((3 + 1) * (320 * 0.000001 + 160 * 0.000002));
  });

  it('refuses a run whose estimate exceeds the explicit cap', async () => {
    await expect(runLiveCompatibility({
      apiKey: 'test-key',
      targets: [target('expensive')],
      maxCostUsd: 0.0001,
      probeModel: vi.fn(),
    })).rejects.toThrow('exceeds');
  });

  it('runs serially and stops before starting another model after the cap is spent', async () => {
    const probeModel = vi.fn(async (model: OpenRouterCatalogModel) => result(model.id, 0.8));
    const run = await runLiveCompatibility({
      apiKey: 'test-key',
      targets: [target('one'), target('two'), target('three')],
      maxCostUsd: 1,
      probeModel,
    });

    expect(probeModel).toHaveBeenCalledTimes(2);
    expect(run.stoppedForBudget).toBe(true);
    expect(run.actualCostUsd).toBe(1.6);
  });

  it('preserves individual failures in the final summary', async () => {
    const run = await runLiveCompatibility({
      apiKey: 'test-key',
      targets: [target('good'), target('bad')],
      maxCostUsd: 1,
      probeModel: async model => result(model.id, 0, model.id === 'good'),
    });

    expect(run.passed).toBe(1);
    expect(run.failed).toBe(1);
    expect(run.stoppedForBudget).toBe(false);
  });
});

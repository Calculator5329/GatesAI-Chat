import { describe, expect, it } from 'vitest';
import { parseArgs } from '../../../scripts/model-compat/args';

describe('model compatibility CLI', () => {
  it('defaults to the free catalog audit with a finite live budget', () => {
    expect(parseArgs([])).toEqual({
      mode: 'catalog',
      maxCostUsd: 2,
      outputDir: 'artifacts/model-compat',
    });
  });

  it('parses live, family, output, and cost flags', () => {
    expect(parseArgs([
      '--mode', 'live',
      '--family', 'glm-recent',
      '--output', '.cache/reports',
      '--max-cost-usd', '0.75',
    ])).toEqual({
      mode: 'live',
      family: 'glm-recent',
      outputDir: '.cache/reports',
      maxCostUsd: 0.75,
    });
  });

  it('rejects unknown and unsafe budget arguments', () => {
    expect(() => parseArgs(['--wat'])).toThrow('Unknown');
    expect(() => parseArgs(['--max-cost-usd', '0'])).toThrow('positive');
  });
});

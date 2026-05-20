import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDef } from '../../src/core/llm';
import { clearTokenEstimateCaches, estimateWireTokens } from '../../src/core/tokens';

const tools: ToolDef[] = [
  {
    name: 'alpha',
    description: 'Alpha tool',
    parameters: {
      type: 'object',
      properties: {
        value: { type: 'string', description: 'A value' },
      },
      required: ['value'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'beta',
    description: 'Beta tool',
    parameters: {
      type: 'object',
      properties: {
        count: { type: 'number' },
      },
      required: ['count'],
      additionalProperties: false,
    },
  },
];

afterEach(() => {
  vi.restoreAllMocks();
  clearTokenEstimateCaches();
});

describe('token estimation caches', () => {
  it('reuses tool-schema estimates for repeated selected tool names', () => {
    clearTokenEstimateCaches();
    const stringify = vi.spyOn(JSON, 'stringify');

    const first = estimateWireTokens([], tools);
    const second = estimateWireTokens([], tools);

    expect(second).toBe(first);
    expect(stringify).toHaveBeenCalledTimes(1);
  });
});

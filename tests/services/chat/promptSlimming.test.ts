import { describe, expect, it } from 'vitest';
import type { ToolDef } from '../../../src/core/llm';
import { compactToolDefs, compactToolDescription } from '../../../src/services/chat/promptSlimming';
import { estimateToolTokens } from '../../../src/core/tokens';

const TOOL: ToolDef = {
  name: 'demo',
  description: [
    'Read and write demo records. Second sentence here. Third sentence is dropped.',
    '',
    'Layout:',
    '  /workspace/demo/ — where records live',
    '',
    'Actions:',
    '• `read` — read a record. Returns the body and its size.',
    '• `write` — write a record. Overwrites any existing one.',
  ].join('\n'),
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['read', 'write'], description: 'Which action to run. Pick one of the listed actions.' },
      tags: { type: 'array', items: { type: 'string', description: 'One tag. Lowercase only.' } },
    },
    required: ['action'],
  },
};

describe('compactToolDescription', () => {
  it('keeps the opening sentences and one line per action bullet', () => {
    expect(compactToolDescription(TOOL.description)).toBe([
      'Read and write demo records. Second sentence here.',
      '• `read` — read a record.',
      '• `write` — write a record.',
    ].join('\n'));
  });

  it('leaves an already short description as it is', () => {
    expect(compactToolDescription('Look up the weather.')).toBe('Look up the weather.');
  });
});

describe('compactToolDefs', () => {
  it('shortens property prose and keeps every structural field', () => {
    const [compact] = compactToolDefs([TOOL]);
    expect(compact.name).toBe('demo');
    expect(compact.parameters.required).toEqual(['action']);
    expect(compact.parameters.properties?.action).toEqual({ type: 'string', enum: ['read', 'write'], description: 'Which action to run.' });
    expect(compact.parameters.properties?.tags).toEqual({ type: 'array', items: { type: 'string', description: 'One tag.' } });
    // The source def is not mutated.
    expect(TOOL.parameters.properties?.action.description).toBe('Which action to run. Pick one of the listed actions.');
  });

  it('gets its own token estimate even though tool names match the full defs', () => {
    const full = estimateToolTokens([TOOL]);
    const compact = estimateToolTokens(compactToolDefs([TOOL]));
    expect(compact).toBeLessThan(full);
  });
});

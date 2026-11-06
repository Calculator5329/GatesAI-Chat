import { describe, expect, it } from 'vitest';
import type { ToolDef } from '../../../src/core/llm';
import { compactToolDefs, compactToolDescription } from '../../../src/services/chat/promptSlimming';
import { estimateToolTokens } from '../../../src/core/tokens';
import { toolsForContextMode } from '../../../src/services/chat/contextModes';
import { toolRegistry } from '../../../src/services/tools/registry';

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

describe('compact sentence cuts (F2)', () => {
  it('does not end a sentence at e.g., i.e., etc. or vs.', () => {
    expect(compactToolDescription('Pick a tool, e.g. fs, i.e. the file one. Then call it, vs. guessing etc. and more. Dropped sentence here.'))
      .toBe('Pick a tool, e.g. fs, i.e. the file one. Then call it, vs. guessing etc. and more.');
    expect(compactToolDescription('Use one, E.G. this. Or that. Dropped.')).toBe('Use one, E.G. this. Or that.');
  });

  it('keeps the JSON example of the micro fs tool', () => {
    const tools = toolsForContextMode({ mode: 'micro', toolsAllowed: true, userText: 'write a file', bridgeOnline: true });
    const fs = tools?.find(tool => tool.name === 'fs');
    expect(fs).toBeDefined();
    const [compact] = compactToolDefs([fs!]);
    expect(compact.description).toContain('{"action":"write","path":"/workspace/artifacts/reports/out.html","content":"..."}');
  });

  it('keeps the whole terminal `cmd` sentence', () => {
    const terminal = toolRegistry.get('terminal')!.def;
    const [compact] = compactToolDefs([terminal]);
    expect(compact.parameters.properties?.cmd.description).toBe('Binary to run (basename only, e.g. "python").');
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

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

describe('Rule: lines survive compaction (F1)', () => {
  const builtIns = toolRegistry.toolDefs();
  const compactByName = new Map(compactToolDefs(builtIns).map(tool => [tool.name, tool.description]));
  const compactOf = (name: string) => compactByName.get(name) ?? '';
  const ruleLines = (description: string) => description.split('\n').map(line => line.trim()).filter(line => line.startsWith('Rule: '));

  it('keeps every Rule: line of every built-in tool verbatim and in order, after the summary and bullets', () => {
    const tools = builtIns.filter(tool => ruleLines(tool.description).length > 0);
    // The named rules below live in at least these tools; guards against a vacuous pass.
    expect(tools.map(tool => tool.name)).toEqual(expect.arrayContaining(['fs', 'memory', 'thread', 'git', 'image_generate']));
    for (const tool of tools) {
      const compactLines = compactOf(tool.name).split('\n');
      const rules = ruleLines(tool.description);
      expect(compactLines.slice(-rules.length), tool.name).toEqual(rules);
    }
  });

  it('keeps a Rule: line found in the opening paragraph out of the summary sentence cut', () => {
    const description = ['Do a thing. Second sentence. Third.', 'Rule: Never do the bad thing, e.g. this. Or that, ever.', '', '• `go` — go. More.'].join('\n');
    expect(compactToolDescription(description)).toBe([
      'Do a thing. Second sentence.',
      '• `go` — go.',
      'Rule: Never do the bad thing, e.g. this. Or that, ever.',
    ].join('\n'));
  });

  it('fs: /workspace/attachments is read-only', () => {
    expect(compactOf('fs')).toMatch(/Rule: \/workspace\/attachments\/ is read-only.*never write, move or delete there/);
  });

  it('memory: never save what the user asked you to forget', () => {
    expect(compactOf('memory')).toContain('Rule: Do NOT save transient context (today\'s plans, hypotheticals, things they asked you to forget).');
  });

  it('thread: each action\'s required arguments', () => {
    const compact = compactOf('thread');
    expect(compact).toContain('Rule: `switch_to` requires `id`');
    expect(compact).toContain('Rule: `rename` requires `title`.');
    expect(compact).toContain('Rule: `set_context` requires `context` (pass empty string to clear).');
  });

  it('git: the restore confirmation literal', () => {
    expect(compactOf('git')).toContain('Rule: `restore` and `restore_staged` require `paths` and `confirm: "restore local changes"`.');
  });

  it('image_generate: width and height are multiples of 16', () => {
    expect(compactOf('image_generate')).toContain('Rule: `width` and `height` must be supplied together, and each must be a multiple of 16.');
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

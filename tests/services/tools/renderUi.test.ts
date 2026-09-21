import { describe, expect, it } from 'vitest';
import { toolRegistry } from '../../../src/services/tools/registry';
import { describeCatalogForTool, validateUiSpec } from '../../../src/core/uiCatalog';
import type { ToolContext } from '../../../src/services/tools/types';

const VALID_SPEC = {
  root: 'main',
  elements: {
    main: { type: 'Stack', props: { direction: 'vertical' }, children: ['title', 'row', 'table', 'go'] },
    title: { type: 'Heading', props: { text: 'Sprint' }, children: [] },
    row: { type: 'Stack', props: { direction: 'horizontal' }, children: ['a', 'b', 'c'] },
    a: { type: 'Stat', props: { label: 'Open', value: '3' }, children: [] },
    b: { type: 'Stat', props: { label: 'Done', value: '12' }, children: [] },
    c: { type: 'Stat', props: { label: 'Blocked', value: '1', hint: 'needs Ethan' }, children: [] },
    table: { type: 'Table', props: { columns: ['Item', 'State'], rows: [['Auth', 'done'], ['Sync', 'open']] }, children: [] },
    go: {
      type: 'Button',
      props: { label: 'Show open' },
      children: [],
      on: { press: { action: 'send_message', params: { text: 'Show me the open items' } } },
    },
  },
};

describe('render_ui tool', () => {
  it('returns a ui artifact and a content line for a valid spec', async () => {
    const result = await toolRegistry.execute('render_ui', { title: 'Sprint board', spec: JSON.stringify(VALID_SPEC) }, baseContext());

    expect(result.ok).toBe(true);
    expect(result.content).toContain('summary: Rendered "Sprint board" (8 elements: Stat x3, Stack x2, Button, Heading, Table)');
    expect(result.artifacts).toHaveLength(1);
    const artifact = result.artifacts?.[0];
    expect(artifact?.kind).toBe('ui');
    if (artifact?.kind !== 'ui') throw new Error('expected a ui artifact');
    expect(artifact.title).toBe('Sprint board');
    // The button binding must survive validation; the library's own validate strips it.
    expect(artifact.spec.elements.go.on).toEqual({ press: { action: 'send_message', params: { text: 'Show me the open items' } } });
  });

  it('fills in missing children arrays instead of rejecting leaves', () => {
    const validation = validateUiSpec({ root: 'x', elements: { x: { type: 'Text', props: { text: 'hi' } } } });
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    expect(validation.spec.elements.x.children).toEqual([]);
  });

  it('rejects an unknown component type with a helpful summary', async () => {
    const spec = { root: 'r', elements: { r: { type: 'Carousel', props: {}, children: [] } } };
    const result = await toolRegistry.execute('render_ui', { spec: JSON.stringify(spec) }, baseContext());

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('invalid_ui_spec');
    expect(result.retryable).toBe(true);
    expect(result.content).toContain('elements.r.type');
    expect(result.content).toContain('"Stack"');
    expect(result.content).toContain('fix:');
  });

  it('rejects wrong props, dangling children, bad roots, and unknown actions', () => {
    const validation = validateUiSpec({
      root: 'missing',
      elements: {
        p: { type: 'Progress', props: { label: 'x', value: 150 }, children: ['ghost'] },
        s: { type: 'Stack', props: { direction: 'sideways' }, children: [] },
        b: { type: 'Button', props: { label: 'Go' }, children: [], on: { press: { action: 'launch_rockets' } } },
        t: { type: 'Text', props: { text: 'x' }, children: [], on: { press: { action: 'send_message', params: { text: 'x' } } } },
      },
    });
    expect(validation.ok).toBe(false);
    if (validation.ok) return;
    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('root "missing"'),
      expect.stringContaining('elements.p.props.value'),
      expect.stringContaining('elements.p.children: "ghost"'),
      expect.stringContaining('elements.s.props.direction'),
      expect.stringContaining('unknown action "launch_rockets"'),
      expect.stringContaining('elements.t.on.press: this component has no "press" event'),
    ]));
  });

  it('rejects malformed JSON', async () => {
    const result = await toolRegistry.execute('render_ui', { spec: '{ "root": ' }, baseContext());

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('invalid_ui_spec');
    expect(result.content).toContain('spec is not valid JSON');
  });

  it('requires spec at validation time', () => {
    expect(toolRegistry.validateCallDetailed('render_ui', {}).errorCode).toBe('missing_required_argument');
    expect(toolRegistry.validateCallDetailed('render_ui', { spec: '   ' }).errorCode).toBe('missing_required_argument');
    expect(toolRegistry.validateCallDetailed('render_ui', { spec: 'x'.repeat(40_001) }).errorCode).toBe('invalid_ui_spec');
  });

  it('is read-only and has a user-facing verb', () => {
    expect(toolRegistry.isReadOnlyCall('render_ui', { spec: '{}' })).toBe(true);
    expect(toolRegistry.get('render_ui')?.ui?.verb({})).toBe('Rendering');
  });

  it('lists the catalog in the tool description', () => {
    const description = toolRegistry.get('render_ui')?.def.description ?? '';
    expect(description).toContain(describeCatalogForTool());
    expect(description).toContain('Stat(label: string, value: string, hint?: string)');
    expect(description).toContain('send_message(text: string)');
  });

  it('is exposed for UI-shaped turns and not for a plain greeting', () => {
    const uiTurn = toolRegistry.toolDefsForTurn({ userText: 'show me a comparison table', bridgeOnline: false }).map(t => t.name);
    const greeting = toolRegistry.toolDefsForTurn({ userText: 'hello there', bridgeOnline: false }).map(t => t.name);

    expect(uiTurn).toContain('render_ui');
    expect(greeting).not.toContain('render_ui');
  });
});

function baseContext(): ToolContext {
  return {
    threadId: 't-1',
    profile: {
      facts: [],
      addFact: () => false,
      removeFactAt: () => null,
      removeFactMatching: () => null,
      updateFactAt: () => null,
      updateFactMatching: () => null,
    },
    chat: {
      threads: [],
      selectThread: () => false,
      renameThread: () => undefined,
      setThreadContext: () => undefined,
      llmComplete: async () => '',
    },
  };
}

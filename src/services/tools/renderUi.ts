// Defines the renderUi tool contract, validation, execution, or display formatting.
// Called by ChatStore tool rounds via the registry; depends on ToolContext facades and bridge/store services.
// Invariant: tools validate inputs first and return deterministic, user-readable results.
import { describeCatalogForTool, MAX_UI_ELEMENTS, validateUiSpec, type UiSpecValidation } from '../../core/uiCatalog';
import type { Tool, ToolOutcome, ToolValidationIssue } from './types';

const MAX_SPEC_CHARS = 40_000;
const MAX_ISSUES_IN_SUMMARY = 4;

const EXAMPLE_SPEC = JSON.stringify({
  root: 'main',
  elements: {
    main: { type: 'Stack', props: { direction: 'vertical' }, children: ['title', 'row', 'next'] },
    title: { type: 'Heading', props: { text: 'Tonight' }, children: [] },
    row: { type: 'Stack', props: { direction: 'horizontal' }, children: ['open', 'done'] },
    open: { type: 'Stat', props: { label: 'Open', value: '3' }, children: [] },
    done: { type: 'Stat', props: { label: 'Done', value: '12', hint: 'this week' }, children: [] },
    next: {
      type: 'Button',
      props: { label: 'Show the open ones' },
      children: [],
      on: { press: { action: 'send_message', params: { text: 'Show me the three open items' } } },
    },
  },
});

/**
 * render_ui: the model answers with a small live UI (stats, a table, a
 * checklist, buttons that continue the chat) instead of prose alone. The spec
 * is a json-render tree limited to the catalog in core/uiCatalog.ts; the tool
 * validates it and hands it back as a `ui` artifact for GeneratedUi to draw.
 */
export const renderUiTool: Tool = {
  def: {
    name: 'render_ui',
    description: [
      'Render a small structured UI inline in your reply. Use it for numbers worth a glance (stats), comparisons and breakdowns (tables), checklists and status boards (lists, badges, progress), and choices the user can click (buttons that send a follow-up message).',
      'Keep prose for explanation; the UI is a supplement, not a replacement. Do not use it for a single sentence or for long-form text.',
      '',
      'Pass `spec` as a JSON string: { "root": "<element id>", "elements": { "<id>": { "type": "<Component>", "props": {...}, "children": ["<id>", ...], "on": { "press": { "action": "send_message", "params": { "text": "..." } } } } } }.',
      'Every element needs `type` and `props`; `children` lists child element ids (use [] for leaves); `on` is only valid on components with events.',
      `Keep specs under ${MAX_UI_ELEMENTS} elements.`,
      '',
      describeCatalogForTool(),
      '',
      `Example spec: ${EXAMPLE_SPEC}`,
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Optional short caption shown above the rendered UI.' },
        spec: { type: 'string', description: 'The json-render spec as a JSON string (see the description for the shape and catalog).' },
      },
      required: ['spec'],
      additionalProperties: false,
    },
  },
  meta: {
    category: 'thread',
    risk: 'low',
    isReadOnly: () => true,
    hasSideEffects: () => false,
    resultPolicy: { maxChars: 600 },
    validate: validateArgs,
  },
  ui: {
    verb: () => 'Rendering',
    target: args => (typeof args.title === 'string' && args.title.trim() ? args.title.trim() : 'a view'),
  },

  async execute(args): Promise<ToolOutcome> {
    const title = typeof args.title === 'string' && args.title.trim() ? args.title.trim() : undefined;
    const parsed = parseSpecArg(args.spec);
    if (!parsed.ok) return invalidSpec(parsed.issues);
    const validation = validateUiSpec(parsed.value);
    if (!validation.ok) return invalidSpec(validation.issues);
    return {
      ok: true,
      summary: `Rendered ${title ? `"${title}"` : 'a view'} (${describeElements(validation)})`,
      artifacts: [{ kind: 'ui', title, spec: validation.spec }],
    };
  },
};

function validateArgs(args: Record<string, unknown>): ToolValidationIssue | null {
  if (typeof args.spec !== 'string' || !args.spec.trim()) {
    return {
      errorCode: 'invalid_ui_spec',
      summary: '`spec` must be a JSON string describing the UI.',
      fix: 'Retry with `spec` set to a JSON string like the example in the tool description.',
      retryable: true,
    };
  }
  if (args.spec.length > MAX_SPEC_CHARS) {
    return {
      errorCode: 'invalid_ui_spec',
      summary: `\`spec\` is too large (${args.spec.length} chars; limit ${MAX_SPEC_CHARS}).`,
      fix: 'Render less at once: fewer rows, shorter text, or split into two views.',
      retryable: true,
    };
  }
  return null;
}

function parseSpecArg(raw: unknown): { ok: true; value: unknown } | { ok: false; issues: string[] } {
  if (typeof raw !== 'string') return { ok: false, issues: ['`spec` must be a JSON string'] };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, issues: [`spec is not valid JSON: ${(err as Error).message}`] };
  }
}

function invalidSpec(issues: string[]): ToolOutcome {
  const shown = issues.slice(0, MAX_ISSUES_IN_SUMMARY);
  const more = issues.length - shown.length;
  return {
    ok: false,
    errorCode: 'invalid_ui_spec',
    summary: `The UI spec was rejected: ${shown.join('; ')}${more > 0 ? `; and ${more} more` : ''}.`,
    fix: 'Fix the listed issues and call render_ui again with the corrected spec. Only catalog components, their documented props, and the send_message action are allowed.',
    retryable: true,
  };
}

function describeElements(validation: Extract<UiSpecValidation, { ok: true }>): string {
  const parts = Object.entries(validation.typeCounts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([type, count]) => (count > 1 ? `${type} x${count}` : type));
  const noun = validation.elementCount === 1 ? 'element' : 'elements';
  return `${validation.elementCount} ${noun}: ${parts.join(', ')}`;
}

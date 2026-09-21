// The json-render catalog behind the `render_ui` tool: every component the
// model may put in a spec, its props, and the one action a spec can bind.
// Shared by the tool (validation, description) and the GeneratedUi renderer.
// Invariant: framework-free; the React registry lives in components/.
import { defineCatalog, defineSchema, type Spec } from '@json-render/core';
import { z } from 'zod';
import { isRecord } from './guards';

export type UiSpec = Spec;

/**
 * The element-tree schema: the same spec shape `@json-render/react` renders
 * (root plus a flat map of elements), declared here so core stays free of the
 * React package. Components additionally declare `events` for `on` bindings.
 */
const uiSchema = defineSchema(s => ({
  spec: s.object({
    root: s.string(),
    elements: s.record(
      s.object({
        type: s.ref('catalog.components'),
        props: s.propsOf('catalog.components'),
        children: s.array(s.string()),
        slots: { ...s.record(s.array(s.string())), ...s.optional() },
        visible: { ...s.any(), ...s.optional() },
        repeat: { ...s.any(), ...s.optional() },
      }),
    ),
  }),
  catalog: s.object({
    components: s.map({
      props: s.zod(),
      slots: s.array(s.string()),
      description: s.string(),
      example: s.any(),
    }),
    actions: s.map({
      params: s.zod(),
      description: s.string(),
    }),
  }),
}));

export const UI_TONES = ['neutral', 'success', 'warning', 'danger'] as const;
export const CALLOUT_TONES = ['info', 'warning', 'danger'] as const;

export const uiCatalog = defineCatalog(uiSchema, {
  components: {
    Stack: {
      props: z.object({ direction: z.enum(['vertical', 'horizontal']) }),
      description: 'Layout container; put child element ids in `children`. The usual root.',
      slots: ['default'],
    },
    Heading: {
      props: z.object({ text: z.string() }),
      description: 'Section title.',
    },
    Text: {
      props: z.object({ text: z.string() }),
      description: 'A short paragraph of plain text.',
    },
    Stat: {
      props: z.object({ label: z.string(), value: z.string(), hint: z.string().optional() }),
      description: 'One headline number with a label; put several in a horizontal Stack.',
    },
    Table: {
      props: z.object({ columns: z.array(z.string()), rows: z.array(z.array(z.string())) }),
      description: 'Column headers plus rows of cell strings.',
    },
    List: {
      props: z.object({ items: z.array(z.string()) }),
      description: 'Bulleted list of short strings.',
    },
    Badge: {
      props: z.object({ text: z.string(), tone: z.enum(UI_TONES) }),
      description: 'Small status label.',
    },
    Callout: {
      props: z.object({ text: z.string(), tone: z.enum(CALLOUT_TONES) }),
      description: 'Highlighted note the reader should not miss.',
    },
    Progress: {
      props: z.object({ label: z.string(), value: z.number().min(0).max(100) }),
      description: 'Labelled progress bar; value is a percentage from 0 to 100.',
    },
    Button: {
      props: z.object({ label: z.string() }),
      description: 'Clickable choice. Bind `on.press` to the send_message action so the click continues the chat.',
      events: ['press'],
    },
    Divider: {
      props: z.object({}),
      description: 'Thin horizontal rule.',
    },
  },
  actions: {
    send_message: {
      description: 'Send a follow-up user message in this chat.',
      params: z.object({ text: z.string() }),
    },
  },
});

export type UiCatalog = typeof uiCatalog;

export const MAX_UI_ELEMENTS = 60;

export type UiSpecValidation =
  | { ok: true; spec: UiSpec; elementCount: number; typeCounts: Record<string, number> }
  | { ok: false; issues: string[] };

/**
 * Strict validation for a model-authored spec. `catalog.validate` only checks
 * the tree shape (it accepts any props once the catalog has more than one
 * component, and it drops the `on` bindings from its output), so this runs the
 * per-component prop schemas, checks every child and root reference, and
 * checks event bindings against the catalog actions. Missing `children` arrays
 * are filled in rather than rejected.
 */
export function validateUiSpec(input: unknown): UiSpecValidation {
  if (!isRecord(input)) return { ok: false, issues: ['spec must be a JSON object with `root` and `elements`'] };
  const elements = isRecord(input.elements) ? input.elements : null;
  if (!elements) return { ok: false, issues: ['`elements` must be an object keyed by element id'] };
  const normalized: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(elements)) {
    if (!isRecord(value)) return { ok: false, issues: [`elements.${key}: must be an object`] };
    normalized[key] = {
      ...value,
      props: value.props ?? {},
      children: value.children ?? [],
    };
  }
  const candidate = { ...input, elements: normalized };
  const structure = uiCatalog.validate(candidate);
  if (!structure.success) {
    return { ok: false, issues: (structure.error?.issues ?? []).map(issue => `${issue.path.join('.')}: ${issue.message}`) };
  }
  const issues: string[] = [];
  const keys = Object.keys(normalized);
  if (keys.length === 0) issues.push('`elements` must contain at least one element');
  if (keys.length > MAX_UI_ELEMENTS) issues.push(`too many elements (${keys.length}); keep specs under ${MAX_UI_ELEMENTS}`);
  if (typeof input.root !== 'string' || !(input.root in normalized)) {
    issues.push(`root "${String(input.root)}" is not a key in \`elements\``);
  }
  const typeCounts: Record<string, number> = {};
  for (const [key, element] of Object.entries(normalized)) {
    const type = String(element.type);
    typeCounts[type] = (typeCounts[type] ?? 0) + 1;
    const definition = uiCatalog.data.components[type as keyof typeof uiCatalog.data.components];
    if (!definition) continue;
    const parsed = definition.props.safeParse(element.props);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.push(`elements.${key}.props${issue.path.length ? `.${issue.path.join('.')}` : ''}: ${issue.message}`);
      }
    }
    for (const child of element.children as unknown[]) {
      if (typeof child !== 'string' || !(child in normalized)) {
        issues.push(`elements.${key}.children: "${String(child)}" is not a defined element`);
      }
    }
    issues.push(...bindingIssues(key, definition, element.on));
  }
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    spec: candidate as unknown as UiSpec,
    elementCount: keys.length,
    typeCounts,
  };
}

function bindingIssues(key: string, definition: unknown, on: unknown): string[] {
  if (on === undefined) return [];
  if (!isRecord(on)) return [`elements.${key}.on: must be an object keyed by event name`];
  const issues: string[] = [];
  const events: string[] = isRecord(definition) && Array.isArray(definition.events)
    ? definition.events.filter((event): event is string => typeof event === 'string')
    : [];
  for (const [event, binding] of Object.entries(on)) {
    if (!events.includes(event)) {
      issues.push(`elements.${key}.on.${event}: this component has no "${event}" event${events.length ? ` (allowed: ${events.join(', ')})` : ''}`);
      continue;
    }
    const bindings = Array.isArray(binding) ? binding : [binding];
    for (const item of bindings) {
      if (!isRecord(item) || typeof item.action !== 'string') {
        issues.push(`elements.${key}.on.${event}: binding must be { action, params }`);
        continue;
      }
      const action = uiCatalog.data.actions[item.action as keyof typeof uiCatalog.data.actions];
      if (!action) {
        issues.push(`elements.${key}.on.${event}.action: unknown action "${item.action}" (allowed: ${uiCatalog.actionNames.join(', ')})`);
        continue;
      }
      const parsed = action.params.safeParse(item.params ?? {});
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          issues.push(`elements.${key}.on.${event}.params${issue.path.length ? `.${issue.path.join('.')}` : ''}: ${issue.message}`);
        }
      }
    }
  }
  return issues;
}

/** Plain-text listing of the catalog for the tool description; derived from the zod schemas. */
export function describeCatalogForTool(): string {
  const lines: string[] = ['Components (props):'];
  for (const [name, entry] of Object.entries(uiCatalog.data.components)) {
    const signature = describeProps(entry.props);
    const events = 'events' in entry && Array.isArray(entry.events) && entry.events.length > 0
      ? ` events: ${entry.events.join(', ')}.`
      : '';
    lines.push(`  ${name}(${signature}): ${entry.description}${events}`);
  }
  lines.push('Actions:');
  for (const [name, entry] of Object.entries(uiCatalog.data.actions)) {
    lines.push(`  ${name}(${describeProps(entry.params)}): ${entry.description}`);
  }
  return lines.join('\n');
}

function describeProps(props: z.ZodType): string {
  const json = z.toJSONSchema(props) as {
    properties?: Record<string, JsonSchemaLike>;
    required?: string[];
  };
  const required = new Set(json.required ?? []);
  return Object.entries(json.properties ?? {})
    .map(([key, value]) => `${key}${required.has(key) ? '' : '?'}: ${describeType(value)}`)
    .join(', ');
}

interface JsonSchemaLike {
  type?: string;
  enum?: unknown[];
  items?: JsonSchemaLike;
  minimum?: number;
  maximum?: number;
}

function describeType(value: JsonSchemaLike): string {
  if (value.enum) return value.enum.map(item => JSON.stringify(item)).join(' | ');
  if (value.type === 'array') return `${value.items ? describeType(value.items) : 'unknown'}[]`;
  if (value.type === 'number' && value.minimum !== undefined && value.maximum !== undefined) {
    return `number ${value.minimum}..${value.maximum}`;
  }
  return value.type ?? 'unknown';
}

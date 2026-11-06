// SP-2: compact tool schemas for local models with a small loaded window.
// Called by TurnRunner.buildTurnRequest and ChatStore's token meter when
// localModelContextProfile(model) is not 'full' (core/localModelMeta).
// Invariant: only prose shrinks. Names, types, enums, required lists,
// properties and items are kept exactly, so every call the full schema
// accepts is still accepted.
import type { JsonSchema, ToolDef } from '../../core/llm';

const SUMMARY_MAX_CHARS = 240;
const BULLET_MAX_CHARS = 110;
const PROPERTY_MAX_CHARS = 90;
/** An action bullet that names an identifier: "• `read` — read a file. ..." */
const ACTION_BULLET = /^\s*[•\-*]\s*`[^`]+`/;

/** The tool list with compact descriptions; structure is untouched. */
export function compactToolDefs(tools: ToolDef[]): ToolDef[] {
  return tools.map(tool => ({
    ...tool,
    description: compactToolDescription(tool.description),
    parameters: compactSchema(tool.parameters),
  }));
}

/**
 * A description line that starts with `Rule: ` is load-bearing (a safety or
 * argument rule) and is never cut or clipped (F1). Full mode sends the same
 * line, so it reads as plain prose there.
 */
const RULE_LINE = /^Rule: /;

/**
 * Keeps the opening paragraph (cut to two sentences), each action bullet
 * that names an identifier (cut to its first sentence), then every `Rule: `
 * line verbatim in its original order. Path tables, examples and workflow
 * prose are dropped; the action enum still lists every action.
 */
export function compactToolDescription(description: string): string {
  const lines = description.split('\n');
  const rules = lines.map(line => line.trim()).filter(line => RULE_LINE.test(line));
  const prose = lines.filter(line => !RULE_LINE.test(line.trim()));
  const summaryLines: string[] = [];
  for (const line of prose) {
    if (!line.trim()) {
      if (summaryLines.length) break;
      continue;
    }
    if (ACTION_BULLET.test(line)) break;
    summaryLines.push(line.trim());
  }
  const summary = clip(firstSentences(summaryLines.join(' '), 2), SUMMARY_MAX_CHARS);
  const bullets = prose
    .filter(line => ACTION_BULLET.test(line))
    .map(line => clip(firstSentences(line.trim(), 1), BULLET_MAX_CHARS));
  const compact = [summary, ...bullets, ...rules].filter(Boolean).join('\n');
  return compact.length > 0 && compact.length < description.length ? compact : description;
}

function compactSchema(schema: JsonSchema): JsonSchema {
  const out: JsonSchema = { ...schema };
  if (schema.properties) {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [key, compactPropertySchema(value)]),
    );
  }
  return out;
}

function compactPropertySchema(schema: JsonSchema): JsonSchema {
  const out = compactSchema(schema);
  if (typeof schema.description === 'string') {
    out.description = clip(firstSentences(schema.description, 1), PROPERTY_MAX_CHARS);
  }
  if (schema.items) out.items = compactPropertySchema(schema.items);
  return out;
}

/** A period that closes one of these is not a sentence end (F2: "e.g." used to cut examples off). */
const ABBREVIATION_END = /(?:^|[^a-z])(?:e\.g|i\.e|etc|vs)\.$/i;

function firstSentences(text: string, count: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  const boundary = /[.!?](?=\s|$)/g;
  let found = 0;
  for (let match = boundary.exec(collapsed); match; match = boundary.exec(collapsed)) {
    const end = match.index + 1;
    if (ABBREVIATION_END.test(collapsed.slice(0, end))) continue;
    found += 1;
    if (found === count) return collapsed.slice(0, end);
  }
  return collapsed;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

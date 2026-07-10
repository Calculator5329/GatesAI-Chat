import type { JsonSchema, LlmResponseFormat } from '../../core/llm';

export type StructuredOutputResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

/** Parse and validate a completed structured-output response. */
export function parseStructuredOutput(text: string, format: LlmResponseFormat): StructuredOutputResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `Structured output was not valid JSON: ${(err as Error).message}` };
  }

  if (format.type === 'json_object') {
    if (!isObject(value)) {
      return { ok: false, error: 'Structured output must be a JSON object.' };
    }
    return { ok: true, value };
  }

  const errors: string[] = [];
  validateSchema(value, format.schema, '$', errors);
  return errors.length > 0
    ? { ok: false, error: `Structured output did not match schema "${format.name}": ${errors.join('; ')}` }
    : { ok: true, value };
}

function validateSchema(value: unknown, schema: JsonSchema, path: string, errors: string[]): void {
  if (schema.enum && !schema.enum.some(candidate => jsonEqual(candidate, value))) {
    errors.push(`${path} must be one of the allowed values`);
    return;
  }

  const types = typeof schema.type === 'string' ? [schema.type] : schema.type;
  if (types && !types.some(type => matchesType(value, type))) {
    errors.push(`${path} must be ${types.join(' or ')}`);
    return;
  }

  if (isObject(value) && (schema.type === 'object' || schema.properties || schema.required)) {
    for (const name of schema.required ?? []) {
      if (!Object.hasOwn(value, name)) errors.push(`${path}.${name} is required`);
    }
    for (const [name, child] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, name)) validateSchema(value[name], child, `${path}.${name}`, errors);
    }
    if (schema.additionalProperties === false) {
      const known = new Set(Object.keys(schema.properties ?? {}));
      for (const name of Object.keys(value)) {
        if (!known.has(name)) errors.push(`${path}.${name} is not allowed`);
      }
    } else if (isSchema(schema.additionalProperties)) {
      const known = new Set(Object.keys(schema.properties ?? {}));
      for (const [name, child] of Object.entries(value)) {
        if (!known.has(name)) validateSchema(child, schema.additionalProperties, `${path}.${name}`, errors);
      }
    }
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => validateSchema(item, schema.items!, `${path}[${index}]`, errors));
  }
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'object': return isObject(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    default: return true;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSchema(value: JsonSchema['additionalProperties']): value is JsonSchema {
  return isObject(value);
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

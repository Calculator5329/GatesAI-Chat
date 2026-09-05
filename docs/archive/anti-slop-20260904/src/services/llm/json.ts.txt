export function safeJsonObject(raw: string): Record<string, unknown> {
  const parsed = parseJsonObject(raw);
  return parsed.ok ? parsed.value : {};
}

export type JsonObjectParseResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; value: Record<string, unknown>; error: string; rawPreview: string };

export function parseJsonObject(raw: string): JsonObjectParseResult {
  if (!raw.trim()) return { ok: true, value: {} };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return { ok: true, value: parsed as Record<string, unknown> };
    }
    return {
      ok: false,
      value: {},
      error: 'Tool arguments must be a JSON object.',
      rawPreview: raw.slice(0, 500),
    };
  } catch (err) {
    return {
      ok: false,
      value: {},
      error: (err as Error).message,
      rawPreview: raw.slice(0, 500),
    };
  }
}

// Tiny shared runtime type guards. Lives in core/ so every layer can use one
// definition instead of redeclaring it per module.

/** True for plain objects (not null, not arrays). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

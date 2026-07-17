// Shared error helpers for the database plugin layer. A typed error carries a
// distinct `kind` so callers can fail closed and tell the user which state they
// are in (disabled vs incompatible vs corrupt vs blocked). None means "retry
// elsewhere".
import type { DatabasePluginError, DatabasePluginErrorKind, DatabasePluginResult } from './types'

/** Thrown by validators; carries a typed kind for `err()` normalization. */
export class DatabasePluginValidationError extends Error {
  readonly kind: DatabasePluginErrorKind
  constructor(kind: DatabasePluginErrorKind, message: string) {
    super(message)
    this.name = 'DatabasePluginValidationError'
    this.kind = kind
  }
}

export function fail(kind: DatabasePluginErrorKind, message: string): DatabasePluginError {
  return { kind, message }
}

export function err<T>(kind: DatabasePluginErrorKind, message: string): DatabasePluginResult<T> {
  return { ok: false, error: fail(kind, message) }
}

export function ok<T>(data: T): DatabasePluginResult<T> {
  return { ok: true, data }
}

/** Normalize any thrown value into a typed result. */
export function fromThrown<T>(error: unknown, fallback: DatabasePluginErrorKind = 'unknown'): DatabasePluginResult<T> {
  if (error instanceof DatabasePluginValidationError) return err(error.kind, error.message)
  return err(fallback, error instanceof Error ? error.message : String(error))
}

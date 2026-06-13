// Shared bridge guard middleware for tool implementations.
// Called by bridge-dependent tools before issuing bridge requests; depends on ToolContext facades.
// Invariant: guard wording stays stable — tool tests assert on these exact strings.
import { BridgeOfflineError } from '../bridge/client';
import type { BridgeFacade, ToolContext, ToolOutcome } from './types';

export const BRIDGE_UNAVAILABLE_MESSAGE = 'Error: bridge unavailable in this context.';
export const BRIDGE_OFFLINE_MESSAGE = 'Error: bridge offline. Start gatesai-bridge.';

/**
 * Per-tool overrides for the guard wording. Most tools use the shared
 * defaults; a few (describe_image, image_generate) ship their own phrasing
 * and pass it here so their output stays byte-identical.
 */
export interface RequireBridgeMessages {
  unavailable?: string;
  offline?: string;
}

export type RequireBridgeResult =
  | { ok: true; bridge: BridgeFacade }
  | { ok: false; error: string };

/**
 * Standard tool guard: confirms a bridge facade is wired into the context
 * and currently online. Returns the bridge on success, or the
 * model-readable error string the tool should return as-is.
 */
export function requireBridge(ctx: ToolContext, messages?: RequireBridgeMessages): RequireBridgeResult {
  if (!ctx.bridge) return { ok: false, error: messages?.unavailable ?? BRIDGE_UNAVAILABLE_MESSAGE };
  if (!ctx.bridge.isOnline) return { ok: false, error: messages?.offline ?? BRIDGE_OFFLINE_MESSAGE };
  return { ok: true, bridge: ctx.bridge };
}

export type RequireBridgeOutcome =
  | { ok: true; bridge: BridgeFacade }
  | Extract<ToolOutcome, { ok: false }>;

/**
 * Same guard for tools that return structured `ToolOutcome` results
 * (currently the artifact tool) instead of bare error strings.
 */
export function requireBridgeOutcome(ctx: ToolContext): RequireBridgeOutcome {
  if (!ctx.bridge) {
    return {
      ok: false,
      errorCode: 'bridge_unavailable',
      summary: 'Bridge unavailable in this context.',
      fix: 'Retry when workspace tools are available.',
      retryable: true,
    };
  }
  if (!ctx.bridge.isOnline) {
    return {
      ok: false,
      errorCode: 'bridge_offline',
      summary: 'Bridge offline. Start gatesai-bridge.',
      fix: 'Start the bridge, then retry.',
      retryable: true,
    };
  }
  return { ok: true, bridge: ctx.bridge };
}

/**
 * Extract the user/model-readable message from a failed bridge request.
 * BridgeOfflineError (and BridgeError) carry friendly messages already;
 * anything else falls back to the generic Error message.
 */
export function bridgeErrorMessage(err: unknown): string {
  if (err instanceof BridgeOfflineError) return err.message;
  return (err as Error).message;
}

/** Standard `Error: ...` string tools return for failed bridge requests. */
export function describeBridgeError(err: unknown): string {
  return `Error: ${bridgeErrorMessage(err)}`;
}

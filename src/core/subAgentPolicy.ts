// Bounded delegation rails for background sub-agents (agentic platform AP-2).
//
// The agentic design doc keeps V1 at "one level of delegation" and forbids a
// child gaining broader authority than its parent. This module makes that
// boundary explicit and testable: depth/count caps come from an immutable
// delegation policy captured on the root task (the "policy ledger"), and a
// child policy is only ever a *subset* of its parent's route, tools, database
// pins, and budgets. A child can never widen a grant, escalate a local route
// to the cloud, or out-spend the parent snapshot.
//
// Pure and framework-agnostic; the service-layer SubAgentLedger composes these
// decisions into a live tree. Nothing here reads a clock, spawns work, or
// touches a store.

import type { AgentTaskPolicy } from './agentTaskPolicy'

export const DEFAULT_MAX_SUBAGENT_DEPTH = 2
export const DEFAULT_MAX_DIRECT_CHILDREN = 4
export const DEFAULT_MAX_SUBAGENT_DESCENDANTS = 8

/** Ring-0 delegation ceilings; a user policy may tighten but never exceed these. */
export const HARD_MAX_SUBAGENT_DEPTH = 4
export const HARD_MAX_DIRECT_CHILDREN = 16
export const HARD_MAX_SUBAGENT_DESCENDANTS = 64

export interface SubAgentDelegationCaps {
  /** Deepest node level allowed below the root; the root itself is depth 0. */
  max_depth: number
  /** Direct children a single parent may spawn. */
  max_children: number
  /** Total descendants allowed under the whole tree. */
  max_descendants: number
}

export const DEFAULT_SUBAGENT_DELEGATION_CAPS: SubAgentDelegationCaps = Object.freeze({
  max_depth: DEFAULT_MAX_SUBAGENT_DEPTH,
  max_children: DEFAULT_MAX_DIRECT_CHILDREN,
  max_descendants: DEFAULT_MAX_SUBAGENT_DESCENDANTS,
})

export type SubAgentSpawnRejection =
  | 'max_depth'
  | 'max_children'
  | 'max_descendants'

export type SubAgentSpawnDecision =
  | { ok: true; child_depth: number }
  | { ok: false; code: SubAgentSpawnRejection; detail: string }

export type SubAgentDerivationFailureCode =
  | 'tool_not_allowed'
  | 'plugin_not_pinned'
  | 'plugin_version_mismatch'
  | 'data_policy_mismatch'
  | 'route_escalation'
  | 'cost_exceeds_parent'
  | 'rounds_exceed_parent'
  | 'tokens_exceed_parent'
  | 'runtime_exceeds_parent'

export type SubAgentDerivation =
  | { ok: true; policy: AgentTaskPolicy }
  | { ok: false; code: SubAgentDerivationFailureCode; detail: string }

export function parseSubAgentDelegationCaps(value: unknown): SubAgentDelegationCaps {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Sub-agent delegation caps must be an object')
  }
  const input = value as Record<string, unknown>
  const unexpected = Object.keys(input).find(key => !['max_depth', 'max_children', 'max_descendants'].includes(key))
  if (unexpected) throw new Error(`Sub-agent delegation caps ${unexpected} is not allowed`)
  return {
    max_depth: boundedInteger(input.max_depth, 'max_depth', 1, HARD_MAX_SUBAGENT_DEPTH),
    max_children: boundedInteger(input.max_children, 'max_children', 1, HARD_MAX_DIRECT_CHILDREN),
    max_descendants: boundedInteger(input.max_descendants, 'max_descendants', 1, HARD_MAX_SUBAGENT_DESCENDANTS),
  }
}

/**
 * Decide whether a parent at `parentDepth` may spawn another direct child,
 * given how many direct children it already has and how many descendants the
 * whole tree already carries. Fail-closed with a distinct reason code.
 */
export function canSpawnChild(
  caps: SubAgentDelegationCaps,
  parentDepth: number,
  parentDirectChildren: number,
  totalDescendants: number,
): SubAgentSpawnDecision {
  if (!Number.isSafeInteger(parentDepth) || parentDepth < 0) throw new Error('Sub-agent parentDepth must be a non-negative integer')
  if (!Number.isSafeInteger(parentDirectChildren) || parentDirectChildren < 0) throw new Error('Sub-agent parentDirectChildren must be a non-negative integer')
  if (!Number.isSafeInteger(totalDescendants) || totalDescendants < 0) throw new Error('Sub-agent totalDescendants must be a non-negative integer')

  const childDepth = parentDepth + 1
  if (childDepth > caps.max_depth) {
    return { ok: false, code: 'max_depth', detail: `Delegation depth ${childDepth} exceeds cap ${caps.max_depth}` }
  }
  if (parentDirectChildren >= caps.max_children) {
    return { ok: false, code: 'max_children', detail: `Parent already has ${parentDirectChildren} of ${caps.max_children} children` }
  }
  if (totalDescendants >= caps.max_descendants) {
    return { ok: false, code: 'max_descendants', detail: `Tree already has ${totalDescendants} of ${caps.max_descendants} descendants` }
  }
  return { ok: true, child_depth: childDepth }
}

/**
 * Derive a child policy that is strictly bounded by the parent snapshot. Every
 * grant on the child must already exist on the parent; every budget must be
 * less than or equal to the parent's, and a local parent route may never be
 * escalated to a cloud child. Returns a fail-closed reason otherwise.
 */
export function deriveSubAgentPolicy(parent: AgentTaskPolicy, requested: AgentTaskPolicy): SubAgentDerivation {
  const parentTools = new Set(parent.requested_tools)
  const deniedTools = requested.requested_tools.filter(tool => !parentTools.has(tool))
  if (deniedTools.length > 0) {
    return { ok: false, code: 'tool_not_allowed', detail: `Child requests tools the parent lacks: ${deniedTools.join(', ')}` }
  }

  for (const pin of requested.database_pins) {
    const parentPin = parent.database_pins.find(candidate => candidate.plugin_id === pin.plugin_id)
    if (!parentPin) {
      return { ok: false, code: 'plugin_not_pinned', detail: `Child pins ${pin.plugin_id} which the parent does not` }
    }
    if (parentPin.version !== pin.version) {
      return { ok: false, code: 'plugin_version_mismatch', detail: `Child pins ${pin.plugin_id}@${pin.version} but parent holds @${parentPin.version}` }
    }
    if (parentPin.data_policy === 'local_only' && pin.data_policy !== 'local_only') {
      return { ok: false, code: 'data_policy_mismatch', detail: `${pin.plugin_id} cannot be loosened beyond the parent's local_only pin` }
    }
    if (pin.data_policy === 'local_only' && requested.route.locality === 'cloud') {
      return { ok: false, code: 'data_policy_mismatch', detail: `${pin.plugin_id} is local_only and cannot ride a cloud child route` }
    }
  }

  if (parent.route.locality === 'local' && requested.route.locality === 'cloud') {
    return { ok: false, code: 'route_escalation', detail: 'A local parent may not delegate to a cloud child route' }
  }
  if (requested.max_cost_usd > parent.max_cost_usd) {
    return { ok: false, code: 'cost_exceeds_parent', detail: `Child cost cap ${requested.max_cost_usd} exceeds parent ${parent.max_cost_usd}` }
  }
  if (requested.max_rounds > parent.max_rounds) {
    return { ok: false, code: 'rounds_exceed_parent', detail: `Child round cap ${requested.max_rounds} exceeds parent ${parent.max_rounds}` }
  }
  if (requested.max_tokens > parent.max_tokens) {
    return { ok: false, code: 'tokens_exceed_parent', detail: `Child token cap ${requested.max_tokens} exceeds parent ${parent.max_tokens}` }
  }
  if (requested.max_runtime_ms > parent.max_runtime_ms) {
    return { ok: false, code: 'runtime_exceeds_parent', detail: `Child runtime cap ${requested.max_runtime_ms} exceeds parent ${parent.max_runtime_ms}` }
  }

  return {
    ok: true,
    policy: {
      schema_version: requested.schema_version,
      route: { ...requested.route },
      requested_tools: [...requested.requested_tools],
      database_pins: requested.database_pins.map(pin => ({ ...pin })),
      max_rounds: requested.max_rounds,
      max_tokens: requested.max_tokens,
      max_runtime_ms: requested.max_runtime_ms,
      max_cost_usd: requested.max_cost_usd,
      consent_ref: requested.consent_ref,
    },
  }
}

function boundedInteger(value: unknown, name: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`Sub-agent delegation caps ${name} must be an integer from ${min} to ${max}`)
  }
  return value as number
}

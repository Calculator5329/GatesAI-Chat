import { describe, expect, it } from 'vitest'

import type { AgentTaskPolicy } from '../../src/core/agentTaskPolicy'
import {
  canSpawnChild,
  deriveSubAgentPolicy,
  DEFAULT_SUBAGENT_DELEGATION_CAPS,
  HARD_MAX_SUBAGENT_DEPTH,
  parseSubAgentDelegationCaps,
} from '../../src/core/subAgentPolicy'

function policy(over: Partial<AgentTaskPolicy> = {}): AgentTaskPolicy {
  return {
    schema_version: 1,
    route: { model_id: 'local-model', provider_id: 'ollama', locality: 'local' },
    requested_tools: ['read', 'search'],
    database_pins: [],
    max_rounds: 6,
    max_tokens: 1000,
    max_runtime_ms: 60_000,
    max_cost_usd: 1,
    consent_ref: 'consent-1',
    ...over,
  }
}

describe('parseSubAgentDelegationCaps', () => {
  it('accepts bounded caps', () => {
    expect(parseSubAgentDelegationCaps({ max_depth: 2, max_children: 3, max_descendants: 5 })).toEqual({
      max_depth: 2, max_children: 3, max_descendants: 5,
    })
  })

  it('rejects unknown keys, non-integers, and out-of-range values', () => {
    expect(() => parseSubAgentDelegationCaps({ max_depth: 1, max_children: 1, max_descendants: 1, extra: 1 })).toThrow(/not allowed/)
    expect(() => parseSubAgentDelegationCaps({ max_depth: 1.5, max_children: 1, max_descendants: 1 })).toThrow(/max_depth/)
    expect(() => parseSubAgentDelegationCaps({ max_depth: HARD_MAX_SUBAGENT_DEPTH + 1, max_children: 1, max_descendants: 1 })).toThrow(/max_depth/)
    expect(() => parseSubAgentDelegationCaps({ max_depth: 0, max_children: 1, max_descendants: 1 })).toThrow(/max_depth/)
    expect(() => parseSubAgentDelegationCaps(null)).toThrow(/must be an object/)
  })
})

describe('canSpawnChild', () => {
  const caps = { max_depth: 2, max_children: 2, max_descendants: 3 }

  it('allows a child within every cap and reports the child depth', () => {
    expect(canSpawnChild(caps, 0, 0, 0)).toEqual({ ok: true, child_depth: 1 })
    expect(canSpawnChild(caps, 1, 0, 1)).toEqual({ ok: true, child_depth: 2 })
  })

  it('fails closed at the depth, direct-child, and descendant ceilings', () => {
    expect(canSpawnChild(caps, 2, 0, 0)).toMatchObject({ ok: false, code: 'max_depth' })
    expect(canSpawnChild(caps, 0, 2, 0)).toMatchObject({ ok: false, code: 'max_children' })
    expect(canSpawnChild(caps, 0, 0, 3)).toMatchObject({ ok: false, code: 'max_descendants' })
  })

  it('rejects malformed counters', () => {
    expect(() => canSpawnChild(caps, -1, 0, 0)).toThrow(/parentDepth/)
    expect(() => canSpawnChild(caps, 0, -1, 0)).toThrow(/parentDirectChildren/)
    expect(() => canSpawnChild(caps, 0, 0, -1)).toThrow(/totalDescendants/)
  })
})

describe('deriveSubAgentPolicy', () => {
  it('accepts a strict subset of the parent grants and budgets', () => {
    const parent = policy({
      requested_tools: ['read', 'search', 'write'],
      database_pins: [{ plugin_id: 'atlas', version: '1.2.0', data_policy: 'cloud_allowed' }],
    })
    const child = policy({
      requested_tools: ['read'],
      database_pins: [{ plugin_id: 'atlas', version: '1.2.0', data_policy: 'local_only' }],
      max_rounds: 3, max_tokens: 500, max_runtime_ms: 30_000, max_cost_usd: 0.5,
      consent_ref: 'child-consent',
    })
    const result = deriveSubAgentPolicy(parent, child)
    expect(result).toEqual({ ok: true, policy: child })
    if (result.ok) expect(result.policy).not.toBe(child)
  })

  it('rejects a tool the parent never held', () => {
    expect(deriveSubAgentPolicy(policy({ requested_tools: ['read'] }), policy({ requested_tools: ['read', 'write'] })))
      .toMatchObject({ ok: false, code: 'tool_not_allowed' })
  })

  it('rejects a plugin the parent did not pin or a version drift', () => {
    const parent = policy({ database_pins: [{ plugin_id: 'atlas', version: '1.0.0', data_policy: 'local_only' }] })
    expect(deriveSubAgentPolicy(parent, policy({ database_pins: [{ plugin_id: 'other', version: '1.0.0', data_policy: 'local_only' }] })))
      .toMatchObject({ ok: false, code: 'plugin_not_pinned' })
    expect(deriveSubAgentPolicy(parent, policy({ database_pins: [{ plugin_id: 'atlas', version: '2.0.0', data_policy: 'local_only' }] })))
      .toMatchObject({ ok: false, code: 'plugin_version_mismatch' })
  })

  it('never loosens a local_only pin or rides local data on a cloud route', () => {
    const localParent = policy({ database_pins: [{ plugin_id: 'atlas', version: '1.0.0', data_policy: 'local_only' }] })
    expect(deriveSubAgentPolicy(localParent, policy({ database_pins: [{ plugin_id: 'atlas', version: '1.0.0', data_policy: 'cloud_allowed' }] })))
      .toMatchObject({ ok: false, code: 'data_policy_mismatch' })

    const cloudParent = policy({
      route: { model_id: 'gpt', provider_id: 'openrouter', locality: 'cloud' },
      database_pins: [{ plugin_id: 'atlas', version: '1.0.0', data_policy: 'local_only' }],
    })
    expect(deriveSubAgentPolicy(cloudParent, policy({
      route: { model_id: 'gpt', provider_id: 'openrouter', locality: 'cloud' },
      database_pins: [{ plugin_id: 'atlas', version: '1.0.0', data_policy: 'local_only' }],
    }))).toMatchObject({ ok: false, code: 'data_policy_mismatch' })
  })

  it('blocks a local parent escalating to a cloud child route', () => {
    expect(deriveSubAgentPolicy(policy(), policy({ route: { model_id: 'gpt', provider_id: 'openrouter', locality: 'cloud' } })))
      .toMatchObject({ ok: false, code: 'route_escalation' })
  })

  it('blocks any budget that exceeds the parent snapshot', () => {
    expect(deriveSubAgentPolicy(policy({ max_cost_usd: 1 }), policy({ max_cost_usd: 2 }))).toMatchObject({ ok: false, code: 'cost_exceeds_parent' })
    expect(deriveSubAgentPolicy(policy({ max_rounds: 3 }), policy({ max_rounds: 4 }))).toMatchObject({ ok: false, code: 'rounds_exceed_parent' })
    expect(deriveSubAgentPolicy(policy({ max_tokens: 100 }), policy({ max_tokens: 200 }))).toMatchObject({ ok: false, code: 'tokens_exceed_parent' })
    expect(deriveSubAgentPolicy(policy({ max_runtime_ms: 10_000 }), policy({ max_runtime_ms: 20_000 }))).toMatchObject({ ok: false, code: 'runtime_exceeds_parent' })
  })

  it('ships sane defaults', () => {
    expect(DEFAULT_SUBAGENT_DELEGATION_CAPS).toEqual({ max_depth: 2, max_children: 4, max_descendants: 8 })
    expect(Object.isFrozen(DEFAULT_SUBAGENT_DELEGATION_CAPS)).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'

import type { AgentTaskLaunchContext } from '../../src/core/agentTaskPolicy'
import {
  DEFAULT_AGENT_TASK_DAILY_COST_USD,
  DEFAULT_AGENT_TASK_MAX_COST_USD,
  evaluateAgentTaskLaunch,
  parseAgentTaskPolicy,
} from '../../src/core/agentTaskPolicy'

function policy(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    route: { model_id: 'qwen2.5-coder:14b', provider_id: 'ollama', locality: 'local' },
    requested_tools: ['workspace.read', 'database_plugins.search'],
    database_pins: [{ plugin_id: 'org.example.reference', version: '1.2.3', data_policy: 'local_only' }],
    max_rounds: 6,
    max_tokens: 20_000,
    max_runtime_ms: 300_000,
    max_cost_usd: 1,
    consent_ref: 'consent-1',
    ...overrides,
  }
}

function context(overrides: Partial<AgentTaskLaunchContext> = {}): AgentTaskLaunchContext {
  return {
    available_routes: [{ model_id: 'qwen2.5-coder:14b', provider_id: 'ollama', locality: 'local' }],
    parent_allowed_tools: ['workspace.read', 'database_plugins.search'],
    runtime_available_tools: ['workspace.read', 'database_plugins.search'],
    available_plugins: [{ plugin_id: 'org.example.reference', version: '1.2.3', data_policy: 'local_only' }],
    ...overrides,
  }
}

describe('agent task policy core', () => {
  it('parses and launches one exact pinned policy', () => {
    const parsed = parseAgentTaskPolicy(policy())
    expect(evaluateAgentTaskLaunch(parsed, context())).toEqual({
      ok: true,
      route: parsed.route,
      allowed_tools: parsed.requested_tools,
      database_pins: parsed.database_pins,
    })
  })

  it('never falls back when the exact route is unavailable', () => {
    const parsed = parseAgentTaskPolicy(policy())
    const decision = evaluateAgentTaskLaunch(parsed, context({
      available_routes: [{ model_id: 'fallback', provider_id: 'openrouter', locality: 'cloud' }],
    }))
    expect(decision).toMatchObject({ ok: false, code: 'route_unavailable' })
  })

  it('uses the intersection of parent and runtime tool authority', () => {
    const parsed = parseAgentTaskPolicy(policy())
    expect(evaluateAgentTaskLaunch(parsed, context({ runtime_available_tools: ['workspace.read'] }))).toMatchObject({
      ok: false,
      code: 'tool_not_allowed',
    })
    expect(evaluateAgentTaskLaunch(parsed, context({ parent_allowed_tools: ['database_plugins.search'] }))).toMatchObject({
      ok: false,
      code: 'tool_not_allowed',
    })
  })

  it('pins plugin identity/version and blocks local-only data on cloud routes', () => {
    const parsed = parseAgentTaskPolicy(policy())
    expect(evaluateAgentTaskLaunch(parsed, context({ available_plugins: [] }))).toMatchObject({ code: 'plugin_unavailable' })
    expect(evaluateAgentTaskLaunch(parsed, context({
      available_plugins: [{ plugin_id: 'org.example.reference', version: '2.0.0', data_policy: 'local_only' }],
    }))).toMatchObject({ code: 'plugin_version_mismatch' })

    const cloud = parseAgentTaskPolicy(policy({
      route: { model_id: 'claude', provider_id: 'openrouter', locality: 'cloud' },
    }))
    expect(evaluateAgentTaskLaunch(cloud, context({
      available_routes: [{ model_id: 'claude', provider_id: 'openrouter', locality: 'cloud' }],
    }))).toMatchObject({ code: 'data_policy_mismatch' })
  })

  it('never lets a task snapshot loosen the installed plugin data ceiling', () => {
    const loosened = parseAgentTaskPolicy(policy({
      database_pins: [{ plugin_id: 'org.example.reference', version: '1.2.3', data_policy: 'cloud_allowed' }],
    }))
    expect(evaluateAgentTaskLaunch(loosened, context())).toMatchObject({ code: 'data_policy_mismatch' })
  })

  it('exports the V1 soft defaults below the hard ceiling', () => {
    expect(DEFAULT_AGENT_TASK_MAX_COST_USD).toBe(1)
    expect(DEFAULT_AGENT_TASK_DAILY_COST_USD).toBe(5)
  })

  it.each([
    ['unknown schema', { schema_version: 2 }],
    ['unknown authority', { can_spawn: true }],
    ['duplicate tool', { requested_tools: ['workspace.read', 'workspace.read'] }],
    ['duplicate plugin', { database_pins: [
      { plugin_id: 'same', version: '1.0.0', data_policy: 'local_only' },
      { plugin_id: 'same', version: '2.0.0', data_policy: 'local_only' },
    ] }],
    ['too many rounds', { max_rounds: 51 }],
    ['hard-cost overflow', { max_cost_usd: 100.01 }],
  ])('rejects hostile or over-broad policy input: %s', (_name, overrides) => {
    expect(() => parseAgentTaskPolicy(policy(overrides))).toThrow('Agent task')
  })
})

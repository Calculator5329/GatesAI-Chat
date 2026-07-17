import { describe, expect, it } from 'vitest'

import { canonicalPolicySnapshot, createAgentTaskAttempt, createAgentTaskSpec } from '../../../src/services/tasks/agentTaskSpec'

const policy = {
  schema_version: 1, route: { model_id: 'local-model', provider_id: 'ollama', locality: 'local' },
  requested_tools: ['read'], database_pins: [], max_rounds: 3, max_tokens: 1000,
  max_runtime_ms: 60_000, max_cost_usd: 1, consent_ref: 'consent-1',
} as const

describe('agent task spec', () => {
  it('creates a deeply immutable exact policy snapshot', () => {
    const spec = createAgentTaskSpec({ id: 'task-1', title: 'Task', instructions: 'Do it.', origin_thread_id: 'origin', created_at: 1, policy })
    expect(Object.isFrozen(spec)).toBe(true)
    expect(Object.isFrozen(spec.policy.route)).toBe(true)
    expect(spec.policy_snapshot).toBe(canonicalPolicySnapshot(spec.policy))
  })

  it('creates monotonic attempt identities without mutating the spec', () => {
    const spec = createAgentTaskSpec({ id: 'task-1', title: 'Task', instructions: 'Do it.', origin_thread_id: 'origin', created_at: 1, policy })
    expect(createAgentTaskAttempt(spec, 2, 10)).toMatchObject({ id: 'task-1:attempt:2', task_id: 'task-1', number: 2, state: 'running' })
  })
})

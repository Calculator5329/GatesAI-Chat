import { parseAgentTaskPolicy, type AgentTaskPolicy } from '../../core/agentTaskPolicy'

export const AGENT_TASK_SPEC_SCHEMA_VERSION = 1 as const

export interface AgentTaskSpec {
  schema_version: typeof AGENT_TASK_SPEC_SCHEMA_VERSION
  id: string
  title: string
  instructions: string
  origin_thread_id: string
  created_at: number
  policy: AgentTaskPolicy
  policy_snapshot: string
}

export interface AgentTaskAttempt {
  id: string
  task_id: string
  number: number
  state: 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted'
  started_at: number
  completed_at?: number
  actual_cost_usd: number
  used_tokens: number
  result_ref?: string
  stop_reason?: string
}

export function createAgentTaskSpec(input: {
  id: string
  title: string
  instructions: string
  origin_thread_id: string
  created_at: number
  policy: unknown
}): AgentTaskSpec {
  const policy = parseAgentTaskPolicy(input.policy)
  const spec: AgentTaskSpec = {
    schema_version: AGENT_TASK_SPEC_SCHEMA_VERSION,
    id: stableId(input.id, 'id'),
    title: boundedText(input.title, 'title', 1, 200),
    instructions: boundedText(input.instructions, 'instructions', 1, 32_000),
    origin_thread_id: stableId(input.origin_thread_id, 'origin_thread_id'),
    created_at: timestamp(input.created_at, 'created_at'),
    policy: clonePolicy(policy),
    policy_snapshot: canonicalPolicySnapshot(policy),
  }
  return deepFreeze(spec)
}

export function createAgentTaskAttempt(spec: AgentTaskSpec, number: number, startedAt: number): AgentTaskAttempt {
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('Agent task attempt number must be a positive integer')
  return {
    id: `${spec.id}:attempt:${number}`,
    task_id: spec.id,
    number,
    state: 'running',
    started_at: timestamp(startedAt, 'started_at'),
    actual_cost_usd: 0,
    used_tokens: 0,
  }
}

export function canonicalPolicySnapshot(policy: AgentTaskPolicy): string {
  return JSON.stringify({
    schema_version: policy.schema_version,
    route: policy.route,
    requested_tools: [...policy.requested_tools],
    database_pins: policy.database_pins.map(pin => ({ ...pin })),
    max_rounds: policy.max_rounds,
    max_tokens: policy.max_tokens,
    max_runtime_ms: policy.max_runtime_ms,
    max_cost_usd: policy.max_cost_usd,
    consent_ref: policy.consent_ref,
  })
}

function clonePolicy(policy: AgentTaskPolicy): AgentTaskPolicy {
  return {
    ...policy,
    route: { ...policy.route },
    requested_tools: [...policy.requested_tools],
    database_pins: policy.database_pins.map(pin => ({ ...pin })),
  }
}

function boundedText(value: string, name: string, min: number, max: number): string {
  if (typeof value !== 'string' || value.length < min || value.length > max || value.trim() !== value) {
    throw new Error(`Agent task ${name} must be a trimmed string from ${min} to ${max} characters`)
  }
  return value
}

function stableId(value: string, name: string): string {
  const parsed = boundedText(value, name, 1, 200)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/.test(parsed)) throw new Error(`Agent task ${name} must be a stable identifier`)
  return parsed
}

function timestamp(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Agent task ${name} must be a non-negative timestamp`)
  return value
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  }
  return value
}

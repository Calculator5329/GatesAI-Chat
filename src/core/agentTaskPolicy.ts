export const AGENT_TASK_POLICY_SCHEMA_VERSION = 1 as const
export const DEFAULT_AGENT_TASK_MAX_COST_USD = 1
export const DEFAULT_AGENT_TASK_DAILY_COST_USD = 5
export const AGENT_TASK_HARD_COST_CEILING_USD = 100

export type AgentTaskPolicyFailureCode =
  | 'route_unavailable'
  | 'tool_not_allowed'
  | 'plugin_unavailable'
  | 'plugin_version_mismatch'
  | 'data_policy_mismatch'
  | 'round_limit'
  | 'runtime_limit'
  | 'token_limit'
  | 'run_spend_limit'
  | 'daily_spend_limit'
  | 'hard_spend_limit'
  | 'unknown_price'

export interface AgentTaskRoutePin {
  model_id: string
  provider_id: string
  locality: 'local' | 'cloud'
}

export interface AgentTaskDatabasePin {
  plugin_id: string
  version: string
  data_policy: 'local_only' | 'cloud_allowed'
}

export interface AgentTaskPolicy {
  schema_version: typeof AGENT_TASK_POLICY_SCHEMA_VERSION
  route: AgentTaskRoutePin
  requested_tools: string[]
  database_pins: AgentTaskDatabasePin[]
  max_rounds: number
  max_tokens: number
  max_runtime_ms: number
  max_cost_usd: number
  consent_ref: string
}

export interface AgentTaskLaunchContext {
  available_routes: AgentTaskRoutePin[]
  parent_allowed_tools: string[]
  runtime_available_tools: string[]
  available_plugins: Array<{
    plugin_id: string
    version: string
    data_policy: 'local_only' | 'cloud_allowed'
  }>
}

export type AgentTaskPolicyDecision =
  | {
      ok: true
      route: AgentTaskRoutePin
      allowed_tools: string[]
      database_pins: AgentTaskDatabasePin[]
    }
  | {
      ok: false
      code: Extract<AgentTaskPolicyFailureCode,
        'route_unavailable' | 'tool_not_allowed' | 'plugin_unavailable'
        | 'plugin_version_mismatch' | 'data_policy_mismatch'>
      detail: string
    }

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export function parseAgentTaskPolicy(value: unknown): AgentTaskPolicy {
  const input = record(value, 'policy')
  exactKeys(input, [
    'schema_version', 'route', 'requested_tools', 'database_pins', 'max_rounds',
    'max_tokens', 'max_runtime_ms', 'max_cost_usd', 'consent_ref',
  ], 'policy')
  if (input.schema_version !== AGENT_TASK_POLICY_SCHEMA_VERSION) fail('policy.schema_version', 'must be exactly 1')

  return {
    schema_version: AGENT_TASK_POLICY_SCHEMA_VERSION,
    route: parseRoute(input.route, 'policy.route'),
    requested_tools: uniqueIdentifiers(input.requested_tools, 'policy.requested_tools', 100),
    database_pins: uniqueArray(input.database_pins, 'policy.database_pins', parseDatabasePin, pin => pin.plugin_id, 20),
    max_rounds: boundedInteger(input.max_rounds, 'policy.max_rounds', 1, 50),
    max_tokens: boundedInteger(input.max_tokens, 'policy.max_tokens', 1, 10_000_000),
    max_runtime_ms: boundedInteger(input.max_runtime_ms, 'policy.max_runtime_ms', 1_000, 24 * 60 * 60 * 1_000),
    max_cost_usd: boundedNumber(input.max_cost_usd, 'policy.max_cost_usd', 0, AGENT_TASK_HARD_COST_CEILING_USD),
    consent_ref: identifier(input.consent_ref, 'policy.consent_ref'),
  }
}

export function evaluateAgentTaskLaunch(
  policy: AgentTaskPolicy,
  context: AgentTaskLaunchContext,
): AgentTaskPolicyDecision {
  const exactRoute = context.available_routes.find(route => (
    route.model_id === policy.route.model_id
      && route.provider_id === policy.route.provider_id
      && route.locality === policy.route.locality
  ))
  if (!exactRoute) {
    return { ok: false, code: 'route_unavailable', detail: `${policy.route.provider_id}/${policy.route.model_id} is unavailable` }
  }

  const parent = new Set(context.parent_allowed_tools)
  const runtime = new Set(context.runtime_available_tools)
  const deniedTools = policy.requested_tools.filter(tool => !parent.has(tool) || !runtime.has(tool))
  if (deniedTools.length > 0) {
    return { ok: false, code: 'tool_not_allowed', detail: `Denied tools: ${deniedTools.join(', ')}` }
  }

  for (const pin of policy.database_pins) {
    const availableVersions = context.available_plugins.filter(plugin => plugin.plugin_id === pin.plugin_id)
    if (availableVersions.length === 0) {
      return { ok: false, code: 'plugin_unavailable', detail: `${pin.plugin_id} is unavailable` }
    }
    const exactPlugin = availableVersions.find(plugin => plugin.version === pin.version)
    if (!exactPlugin) {
      return { ok: false, code: 'plugin_version_mismatch', detail: `${pin.plugin_id}@${pin.version} is unavailable` }
    }
    if (exactPlugin.data_policy === 'local_only' && pin.data_policy !== 'local_only') {
      return { ok: false, code: 'data_policy_mismatch', detail: `${pin.plugin_id}@${pin.version} cannot be loosened beyond local_only` }
    }
    if (pin.data_policy === 'local_only' && policy.route.locality === 'cloud') {
      return { ok: false, code: 'data_policy_mismatch', detail: `${pin.plugin_id}@${pin.version} requires a local route` }
    }
  }

  return {
    ok: true,
    route: policy.route,
    allowed_tools: [...policy.requested_tools],
    database_pins: policy.database_pins.map(pin => ({ ...pin })),
  }
}

function parseRoute(value: unknown, path: string): AgentTaskRoutePin {
  const input = record(value, path)
  exactKeys(input, ['model_id', 'provider_id', 'locality'], path)
  return {
    model_id: identifier(input.model_id, `${path}.model_id`),
    provider_id: identifier(input.provider_id, `${path}.provider_id`),
    locality: oneOf(input.locality, ['local', 'cloud'], `${path}.locality`),
  }
}

function parseDatabasePin(value: unknown, path: string): AgentTaskDatabasePin {
  const input = record(value, path)
  exactKeys(input, ['plugin_id', 'version', 'data_policy'], path)
  return {
    plugin_id: identifier(input.plugin_id, `${path}.plugin_id`),
    version: semver(input.version, `${path}.version`),
    data_policy: oneOf(input.data_policy, ['local_only', 'cloud_allowed'], `${path}.data_policy`),
  }
}

function uniqueIdentifiers(value: unknown, path: string, max: number): string[] {
  return uniqueArray(value, path, identifier, item => item, max)
}

function uniqueArray<T>(
  value: unknown,
  path: string,
  parse: (value: unknown, path: string) => T,
  key: (value: T) => string,
  max: number,
): T[] {
  if (!Array.isArray(value) || value.length > max) fail(path, `must be an array with at most ${max} entries`)
  const parsed = value.map((entry, index) => parse(entry, `${path}[${index}]`))
  const seen = new Set<string>()
  for (const item of parsed) {
    const identity = key(item)
    if (seen.has(identity)) fail(path, `contains duplicate ${identity}`)
    seen.add(identity)
  }
  return parsed
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'must be an object')
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const unexpected = Object.keys(value).find(key => !allowed.includes(key))
  if (unexpected) fail(`${path}.${unexpected}`, 'is not allowed by schema 1')
}

function identifier(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 200 || value.trim() !== value || !IDENTIFIER.test(value)) {
    fail(path, 'must be a stable identifier')
  }
  return value
}

function semver(value: unknown, path: string): string {
  if (typeof value !== 'string' || !SEMVER.test(value)) fail(path, 'must be semantic version x.y.z')
  return value
}

function boundedInteger(value: unknown, path: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) fail(path, `must be an integer from ${min} to ${max}`)
  return value as number
}

function boundedNumber(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(path, `must be a finite number from ${min} to ${max}`)
  return value
}

function oneOf<const T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail(path, `must be one of: ${allowed.join(', ')}`)
  return value as T
}

function fail(path: string, message: string): never {
  throw new Error(`Agent task ${path} ${message}`)
}

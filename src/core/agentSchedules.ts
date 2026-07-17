// Self-scheduling domain for the agentic platform (Story AP-3).
//
// A schema-v2 `AgentSchedule` lets an agent (or the user) arrange a bounded
// future wake — a one-shot reminder, a delay, a repeating interval, or a daily
// wall-clock time — that later enqueues an ordinary agent task on the shared
// TaskStore ledger. This module owns the *pure* half of that contract:
//
//   * the persisted schema, its validation, and its schema-v1 migration to a
//     paused `needs_review` state (the legacy recurring-schedule shape lacked
//     an exact route, grants, and per-wake budget consent);
//   * timezone- and DST-aware next-wake computation (daily wakes follow the
//     wall clock; spring-forward gaps advance to the next valid local time and
//     fall-back ambiguity fires once);
//   * the consent state machine — an agent-authored schedule is an inert
//     proposal until the user approves it, and any later edit that broadens
//     authority (instructions, route, data pins, tools, cadence frequency,
//     catch-up, or a raised cap) returns it to pending consent, while pause,
//     lowering a limit, and archive do not;
//   * rolling-24h wake-cap accounting and the fail-closed skip reasons; and
//   * projection to the immutable `AgentTaskPolicy` snapshot the runner uses.
//
// It reads no clock of its own, performs no model calls, and holds no store
// state — the service-layer `ScheduleLedger` composes these decisions, and the
// store/persistence layers drive it. Local data can never create or broaden a
// schedule; only an explicit user confirmation can (see the design's rails).

import {
  AGENT_TASK_HARD_COST_CEILING_USD,
  AGENT_TASK_POLICY_SCHEMA_VERSION,
  type AgentTaskDatabasePin,
  type AgentTaskPolicy,
  type AgentTaskRoutePin,
} from './agentTaskPolicy'

export const AGENT_SCHEDULE_SCHEMA_VERSION = 2 as const

/** Default per-schedule wake ceiling in a rolling 24h window. */
export const DEFAULT_SCHEDULE_MAX_WAKES_PER_24H = 4
/** Hard global wake ceiling across every schedule in a rolling 24h window. */
export const GLOBAL_SCHEDULE_MAX_WAKES_PER_24H = 24
/** Default per-wake cloud spend cap; also bounded by the daily/agent ceiling. */
export const DEFAULT_SCHEDULE_COST_USD_PER_WAKE = 0.5
/** A default token cap so a schedule can build a valid agent-task policy. */
export const DEFAULT_SCHEDULE_MAX_TOKENS = 200_000
export const SCHEDULE_ROLLING_WINDOW_MS = 24 * 60 * 60 * 1_000

export type ScheduleConsentState = 'proposed' | 'active' | 'needs_consent' | 'needs_review'

export type ScheduleCatchUp = 'skip' | 'once'

export type ScheduleCreatedBy = 'user' | 'agent'

export type ScheduleTrigger =
  | { kind: 'once-at'; at: number }
  | { kind: 'delay'; delay_ms: number }
  | { kind: 'interval'; every_ms: number }
  | { kind: 'daily'; hour: number; minute: number }

/** How a wall-clock time was resolved across a DST transition, for the audit log. */
export type WakeClockAdjustment = 'none' | 'gap' | 'ambiguous'

export interface AgentSchedule {
  schema_version: typeof AGENT_SCHEDULE_SCHEMA_VERSION
  id: string
  title: string
  instructions: string
  created_by: ScheduleCreatedBy
  consent_ref: string | null
  consent_state: ScheduleConsentState
  trigger: ScheduleTrigger
  timezone: string
  enabled: boolean
  catch_up: ScheduleCatchUp
  /** Set when a spend cap disabled future wakes; only the user can clear it. */
  budget_locked: boolean
  route: AgentTaskRoutePin
  skill_id?: string
  database_pins: AgentTaskDatabasePin[]
  allowed_tools: string[]
  max_rounds: number
  max_tokens: number
  max_runtime_ms: number
  max_cost_usd_per_wake: number
  max_wakes_per_24h: number
  created_at: number
  last_wake_at?: number
  next_wake_at: number | null
  last_result_task_id?: string
}

export interface AgentScheduleInput {
  title: string
  instructions: string
  trigger: ScheduleTrigger
  timezone: string
  route: AgentTaskRoutePin
  skill_id?: string
  database_pins?: AgentTaskDatabasePin[]
  allowed_tools?: string[]
  catch_up?: ScheduleCatchUp
  enabled?: boolean
  max_rounds?: number
  max_tokens?: number
  max_runtime_ms?: number
  max_cost_usd_per_wake?: number
  max_wakes_per_24h?: number
}

/** Fields a caller may change on an existing schedule (all optional). */
export type AgentSchedulePatch = Partial<Omit<AgentScheduleInput, 'timezone'>> & { timezone?: string }

export interface CreateScheduleContext {
  id: string
  created_at: number
  created_by: ScheduleCreatedBy
  /** The explicit consent that authorized this schedule, if any. */
  consent_ref?: string
}

/** Why a due wake was not fired; every reason is auditable and distinct. */
export type WakeSkipReason =
  | 'not_active'
  | 'paused'
  | 'global_pause'
  | 'budget_locked'
  | 'overlap'
  | 'wake_cap_schedule'
  | 'wake_cap_global'
  | 'missed_while_closed'

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const MIN_INTERVAL_MS = 60_000
const MAX_INTERVAL_MS = 90 * SCHEDULE_ROLLING_WINDOW_MS
const MAX_DELAY_MS = 365 * SCHEDULE_ROLLING_WINDOW_MS

// ---------------------------------------------------------------------------
// Construction and validation
// ---------------------------------------------------------------------------

/**
 * Build a fresh schedule. A user-authored schedule with an explicit consent ref
 * starts `active` (the save action is itself consent); an agent-authored one
 * starts `proposed` and does nothing until the user approves it.
 */
export function createAgentSchedule(input: AgentScheduleInput, ctx: CreateScheduleContext): AgentSchedule {
  const createdAt = timestamp(ctx.created_at, 'created_at')
  const trigger = parseTrigger(input.trigger)
  const timezone = validTimezone(input.timezone)

  const consentRef = ctx.consent_ref === undefined ? null : identifier(ctx.consent_ref, 'consent_ref')
  const consentState: ScheduleConsentState =
    ctx.created_by === 'agent' || consentRef === null ? 'proposed' : 'active'

  const schedule: AgentSchedule = {
    schema_version: AGENT_SCHEDULE_SCHEMA_VERSION,
    id: stableId(ctx.id, 'id'),
    title: boundedText(input.title, 'title', 1, 200),
    instructions: boundedText(input.instructions, 'instructions', 1, 32_000),
    created_by: ctx.created_by,
    consent_ref: consentRef,
    consent_state: consentState,
    trigger,
    timezone,
    enabled: input.enabled ?? true,
    catch_up: input.catch_up ?? 'skip',
    budget_locked: false,
    route: parseRoute(input.route),
    skill_id: input.skill_id === undefined ? undefined : identifier(input.skill_id, 'skill_id'),
    database_pins: parseDatabasePins(input.database_pins ?? []),
    allowed_tools: parseTools(input.allowed_tools ?? []),
    max_rounds: boundedInteger(input.max_rounds ?? 6, 'max_rounds', 1, 50),
    max_tokens: boundedInteger(input.max_tokens ?? DEFAULT_SCHEDULE_MAX_TOKENS, 'max_tokens', 1, 10_000_000),
    max_runtime_ms: boundedInteger(input.max_runtime_ms ?? 5 * 60_000, 'max_runtime_ms', 1_000, SCHEDULE_ROLLING_WINDOW_MS),
    max_cost_usd_per_wake: boundedNumber(input.max_cost_usd_per_wake ?? DEFAULT_SCHEDULE_COST_USD_PER_WAKE, 'max_cost_usd_per_wake', 0, AGENT_TASK_HARD_COST_CEILING_USD),
    max_wakes_per_24h: boundedInteger(input.max_wakes_per_24h ?? DEFAULT_SCHEDULE_MAX_WAKES_PER_24H, 'max_wakes_per_24h', 1, GLOBAL_SCHEDULE_MAX_WAKES_PER_24H),
    created_at: createdAt,
    next_wake_at: null,
  }
  schedule.next_wake_at = scheduledWakeAt(schedule)
  return schedule
}

/** Validate a persisted schedule shape, rejecting anything outside schema 2. */
export function parseAgentSchedule(value: unknown): AgentSchedule {
  const input = record(value, 'schedule')
  if (input.schema_version !== AGENT_SCHEDULE_SCHEMA_VERSION) fail('schema_version', 'must be exactly 2')

  const schedule: AgentSchedule = {
    schema_version: AGENT_SCHEDULE_SCHEMA_VERSION,
    id: stableId(input.id, 'id'),
    title: boundedText(input.title, 'title', 1, 200),
    instructions: boundedText(input.instructions, 'instructions', 1, 32_000),
    created_by: oneOf(input.created_by, ['user', 'agent'], 'created_by'),
    consent_ref: input.consent_ref === null || input.consent_ref === undefined ? null : identifier(input.consent_ref, 'consent_ref'),
    consent_state: oneOf(input.consent_state, ['proposed', 'active', 'needs_consent', 'needs_review'], 'consent_state'),
    trigger: parseTrigger(input.trigger),
    timezone: validTimezone(input.timezone),
    enabled: boolean(input.enabled, 'enabled'),
    catch_up: oneOf(input.catch_up, ['skip', 'once'], 'catch_up'),
    budget_locked: boolean(input.budget_locked, 'budget_locked'),
    route: parseRoute(input.route),
    skill_id: input.skill_id === undefined ? undefined : identifier(input.skill_id, 'skill_id'),
    database_pins: parseDatabasePins(input.database_pins),
    allowed_tools: parseTools(input.allowed_tools),
    max_rounds: boundedInteger(input.max_rounds, 'max_rounds', 1, 50),
    max_tokens: boundedInteger(input.max_tokens, 'max_tokens', 1, 10_000_000),
    max_runtime_ms: boundedInteger(input.max_runtime_ms, 'max_runtime_ms', 1_000, SCHEDULE_ROLLING_WINDOW_MS),
    max_cost_usd_per_wake: boundedNumber(input.max_cost_usd_per_wake, 'max_cost_usd_per_wake', 0, AGENT_TASK_HARD_COST_CEILING_USD),
    max_wakes_per_24h: boundedInteger(input.max_wakes_per_24h, 'max_wakes_per_24h', 1, GLOBAL_SCHEDULE_MAX_WAKES_PER_24H),
    created_at: timestamp(input.created_at, 'created_at'),
    last_wake_at: input.last_wake_at === undefined ? undefined : timestamp(input.last_wake_at, 'last_wake_at'),
    next_wake_at: input.next_wake_at === null ? null : timestamp(input.next_wake_at, 'next_wake_at'),
    last_result_task_id: input.last_result_task_id === undefined ? undefined : stableId(input.last_result_task_id, 'last_result_task_id'),
  }
  return schedule
}

/**
 * Migrate a legacy schema-v1 recurring schedule intact but paused, in
 * `needs_review`. The v1 shape carried no exact route/provider, grants, or
 * per-wake budget consent, so it must never resolve a missing model by silently
 * choosing the current default — the user activates it only after confirming
 * the route, grants, and caps the review surface shows.
 */
export function migrateScheduleV1(value: unknown, fallbackRoute: AgentTaskRoutePin): AgentSchedule {
  const v1 = record(value, 'schedule_v1')
  const cadence = v1.cadence as { kind?: string; hours?: number; hour?: number; minute?: number } | undefined
  const trigger: ScheduleTrigger = cadence?.kind === 'daily'
    ? { kind: 'daily', hour: clampInt(cadence.hour, 0, 23, 9), minute: clampInt(cadence.minute, 0, 59, 0) }
    : { kind: 'interval', every_ms: intervalHoursToMs(cadence?.hours) }

  const createdAt = timestamp(v1.createdAt ?? 0, 'created_at')
  const schedule: AgentSchedule = {
    schema_version: AGENT_SCHEDULE_SCHEMA_VERSION,
    id: stableId(v1.id, 'id'),
    title: boundedText(v1.title, 'title', 1, 200),
    instructions: boundedText(v1.instructions, 'instructions', 1, 32_000),
    created_by: 'user',
    consent_ref: null,
    // Legacy schedules lack exact route/grant/budget consent: paused for review.
    consent_state: 'needs_review',
    trigger,
    timezone: validTimezone(typeof v1.timezone === 'string' ? v1.timezone : 'UTC'),
    enabled: false,
    catch_up: v1.catchUp === true ? 'once' : 'skip',
    budget_locked: false,
    route: { ...parseRoute(fallbackRoute) },
    database_pins: [],
    allowed_tools: [],
    max_rounds: 6,
    max_tokens: DEFAULT_SCHEDULE_MAX_TOKENS,
    max_runtime_ms: 5 * 60_000,
    max_cost_usd_per_wake: DEFAULT_SCHEDULE_COST_USD_PER_WAKE,
    max_wakes_per_24h: DEFAULT_SCHEDULE_MAX_WAKES_PER_24H,
    created_at: createdAt,
    last_wake_at: typeof v1.lastRunAt === 'number' && Number.isSafeInteger(v1.lastRunAt) ? v1.lastRunAt : undefined,
    next_wake_at: null,
  }
  schedule.next_wake_at = scheduledWakeAt(schedule)
  return schedule
}

// ---------------------------------------------------------------------------
// Consent state machine
// ---------------------------------------------------------------------------

/** Fields whose change broadens authority and therefore requires renewed consent. */
const CONSENT_SENSITIVE_FIELDS: ReadonlyArray<keyof AgentScheduleInput> = [
  'instructions', 'route', 'skill_id', 'database_pins', 'allowed_tools', 'trigger', 'catch_up',
]

export interface ScheduleConsentDiff {
  requires_consent: boolean
  changed: string[]
}

/**
 * Decide whether applying `patch` to `current` broadens authority. A cadence
 * change or a *raised* cap requires renewed consent; pausing, lowering a cap,
 * or a pure title change does not. Returns the sensitive fields that changed.
 */
export function scheduleConsentDiff(current: AgentSchedule, patch: AgentSchedulePatch): ScheduleConsentDiff {
  const changed: string[] = []

  for (const field of CONSENT_SENSITIVE_FIELDS) {
    const next = (patch as Record<string, unknown>)[field]
    if (next === undefined) continue
    if (field === 'trigger') {
      if (triggerFrequencyBroadened(current.trigger, parseTrigger(next))) changed.push('trigger')
      continue
    }
    if (!deepEqual(next, (current as unknown as Record<string, unknown>)[field])) changed.push(field)
  }

  // A raised cap broadens authority; lowering one never does.
  if (patch.max_wakes_per_24h !== undefined && patch.max_wakes_per_24h > current.max_wakes_per_24h) changed.push('max_wakes_per_24h')
  if (patch.max_cost_usd_per_wake !== undefined && patch.max_cost_usd_per_wake > current.max_cost_usd_per_wake) changed.push('max_cost_usd_per_wake')
  if (patch.max_rounds !== undefined && patch.max_rounds > current.max_rounds) changed.push('max_rounds')
  if (patch.max_tokens !== undefined && patch.max_tokens > current.max_tokens) changed.push('max_tokens')
  if (patch.max_runtime_ms !== undefined && patch.max_runtime_ms > current.max_runtime_ms) changed.push('max_runtime_ms')

  return { requires_consent: changed.length > 0, changed }
}

/** A trigger edit needs consent only when it makes wakes *more* frequent. */
function triggerFrequencyBroadened(current: ScheduleTrigger, next: ScheduleTrigger): boolean {
  if (current.kind !== next.kind) return true
  if (current.kind === 'interval' && next.kind === 'interval') return next.every_ms < current.every_ms
  if (current.kind === 'delay' && next.kind === 'delay') return next.delay_ms < current.delay_ms
  if (current.kind === 'daily' && next.kind === 'daily') return current.hour !== next.hour || current.minute !== next.minute
  if (current.kind === 'once-at' && next.kind === 'once-at') return current.at !== next.at
  return true
}

// ---------------------------------------------------------------------------
// Wake timing — timezone/DST-aware
// ---------------------------------------------------------------------------

/**
 * The next instant this schedule is scheduled to fire given its last wake (or
 * creation) — WITHOUT rolling past "now". A one-shot trigger that has already
 * fired returns null. Callers compare the result to the current clock to decide
 * whether a wake is due (possibly a missed one from while the app was closed).
 */
export function scheduledWakeAt(schedule: AgentSchedule): number | null {
  const t = schedule.trigger
  switch (t.kind) {
    case 'once-at':
      return schedule.last_wake_at === undefined ? t.at : null
    case 'delay':
      return schedule.last_wake_at === undefined ? schedule.created_at + t.delay_ms : null
    case 'interval': {
      const base = schedule.last_wake_at ?? schedule.created_at
      return base + t.every_ms
    }
    case 'daily': {
      const base = schedule.last_wake_at ?? schedule.created_at
      return nextDailyWake(schedule.timezone, t.hour, t.minute, base).at
    }
  }
}

/**
 * The first scheduled wake strictly after `nowMs` — used to advance a repeating
 * schedule past missed intervals when the user chooses to skip catch-up. A
 * one-shot schedule that has already fired returns null.
 */
export function nextFutureWakeAt(schedule: AgentSchedule, nowMs: number): { at: number | null; adjustment: WakeClockAdjustment } {
  const t = schedule.trigger
  if (t.kind === 'once-at' || t.kind === 'delay') {
    // A one-shot has no future wake once it has fired or its instant has passed.
    const at = scheduledWakeAt(schedule)
    return { at: at !== null && at > nowMs ? at : null, adjustment: 'none' }
  }
  if (t.kind === 'interval') {
    let at = schedule.last_wake_at ?? schedule.created_at
    // Roll forward in whole intervals; a bounded loop guards against absurd gaps.
    const steps = Math.max(0, Math.floor((nowMs - at) / t.every_ms) + 1)
    at += steps * t.every_ms
    while (at <= nowMs) at += t.every_ms
    return { at, adjustment: 'none' }
  }
  // daily
  return nextDailyWake(schedule.timezone, t.hour, t.minute, nowMs)
}

/** Wall-clock offset (local − UTC) in ms at the given UTC instant for a zone. */
function zoneOffsetMs(timeZone: string, utcMs: number): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = dtf.formatToParts(new Date(utcMs))
  const map: Record<string, number> = {}
  for (const part of parts) if (part.type !== 'literal') map[part.type] = Number(part.value)
  // Some ICU builds emit hour "24" for midnight even under h23; normalize it.
  const hour = map.hour === 24 ? 0 : map.hour
  const asUtc = Date.UTC(map.year, map.month - 1, map.day, hour, map.minute, map.second)
  return asUtc - utcMs
}

/**
 * Convert a local wall-clock time in `timeZone` to a UTC instant, resolving DST
 * edges: a nonexistent spring-forward time advances to the next valid local
 * time (`gap`); an ambiguous fall-back time resolves to its first (earlier)
 * occurrence so it fires once (`ambiguous`).
 */
export function wallTimeToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): { utc: number; adjustment: WakeClockAdjustment } {
  const naive = Date.UTC(year, month, day, hour, minute, 0, 0)
  const off1 = zoneOffsetMs(timeZone, naive)
  const guess1 = naive - off1
  const off2 = zoneOffsetMs(timeZone, guess1)
  if (off1 === off2) return { utc: guess1, adjustment: 'none' }

  const guess2 = naive - off2
  const valid1 = guess1 + zoneOffsetMs(timeZone, guess1) === naive
  const valid2 = guess2 + zoneOffsetMs(timeZone, guess2) === naive
  if (valid1 && valid2) return { utc: Math.min(guess1, guess2), adjustment: 'ambiguous' }
  if (valid1) return { utc: guess1, adjustment: 'none' }
  if (valid2) return { utc: guess2, adjustment: 'none' }
  // Spring-forward gap: the requested wall time never occurs. Advance to the
  // next valid local time (the later candidate lands just past the gap).
  return { utc: Math.max(guess1, guess2), adjustment: 'gap' }
}

/** The next daily wall-clock wake strictly after `afterMs` in the given zone. */
function nextDailyWake(timeZone: string, hour: number, minute: number, afterMs: number): { at: number; adjustment: WakeClockAdjustment } {
  const start = zonedCalendarDate(timeZone, afterMs)
  for (let addDays = 0; addDays < 400; addDays++) {
    const date = addCalendarDays(start, addDays)
    const resolved = wallTimeToUtc(timeZone, date.year, date.month, date.day, hour, minute)
    if (resolved.utc > afterMs) return { at: resolved.utc, adjustment: resolved.adjustment }
  }
  // Unreachable for sane inputs; fall back to a plain 24h step.
  return { at: afterMs + SCHEDULE_ROLLING_WINDOW_MS, adjustment: 'none' }
}

function zonedCalendarDate(timeZone: string, utcMs: number): { year: number; month: number; day: number } {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
  const map: Record<string, number> = {}
  for (const part of dtf.formatToParts(new Date(utcMs))) if (part.type !== 'literal') map[part.type] = Number(part.value)
  return { year: map.year, month: map.month - 1, day: map.day }
}

function addCalendarDays(date: { year: number; month: number; day: number }, addDays: number): { year: number; month: number; day: number } {
  // Add days on a pure UTC calendar (no DST) to get a stable Y/M/D.
  const shifted = new Date(Date.UTC(date.year, date.month, date.day) + addDays * SCHEDULE_ROLLING_WINDOW_MS)
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth(), day: shifted.getUTCDate() }
}

// ---------------------------------------------------------------------------
// Wake-cap accounting
// ---------------------------------------------------------------------------

/** How many timestamps fall within `windowMs` up to and including `nowMs`. */
export function countWakesInWindow(times: readonly number[], nowMs: number, windowMs: number = SCHEDULE_ROLLING_WINDOW_MS): number {
  const floor = nowMs - windowMs
  let count = 0
  for (const time of times) if (time > floor && time <= nowMs) count++
  return count
}

// ---------------------------------------------------------------------------
// Policy projection
// ---------------------------------------------------------------------------

/**
 * Project a schedule's persisted route/grants/caps into the immutable
 * `AgentTaskPolicy` a wake will run under. The per-wake cost cap becomes the
 * task's `max_cost_usd`; the schedule's consent ref must be present (an
 * unconsented proposal cannot build a launchable policy).
 */
export function scheduleToAgentTaskPolicy(schedule: AgentSchedule): AgentTaskPolicy {
  if (schedule.consent_ref === null) throw new Error('An unconsented schedule cannot build a launch policy')
  return {
    schema_version: AGENT_TASK_POLICY_SCHEMA_VERSION,
    route: { ...schedule.route },
    requested_tools: [...schedule.allowed_tools],
    database_pins: schedule.database_pins.map(pin => ({ ...pin })),
    max_rounds: schedule.max_rounds,
    max_tokens: schedule.max_tokens,
    max_runtime_ms: schedule.max_runtime_ms,
    max_cost_usd: schedule.max_cost_usd_per_wake,
    consent_ref: schedule.consent_ref,
  }
}

/** True when the schedule is presently allowed to fire (before cap/overlap checks). */
export function isScheduleFireable(schedule: AgentSchedule): boolean {
  return schedule.consent_state === 'active' && schedule.enabled && !schedule.budget_locked
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function parseTrigger(value: unknown): ScheduleTrigger {
  const input = record(value, 'trigger')
  const kind = oneOf(input.kind, ['once-at', 'delay', 'interval', 'daily'], 'trigger.kind')
  switch (kind) {
    case 'once-at':
      exactKeys(input, ['kind', 'at'], 'trigger')
      return { kind, at: timestamp(input.at, 'trigger.at') }
    case 'delay':
      exactKeys(input, ['kind', 'delay_ms'], 'trigger')
      return { kind, delay_ms: boundedInteger(input.delay_ms, 'trigger.delay_ms', 1_000, MAX_DELAY_MS) }
    case 'interval':
      exactKeys(input, ['kind', 'every_ms'], 'trigger')
      return { kind, every_ms: boundedInteger(input.every_ms, 'trigger.every_ms', MIN_INTERVAL_MS, MAX_INTERVAL_MS) }
    case 'daily':
      exactKeys(input, ['kind', 'hour', 'minute'], 'trigger')
      return { kind, hour: boundedInteger(input.hour, 'trigger.hour', 0, 23), minute: boundedInteger(input.minute, 'trigger.minute', 0, 59) }
  }
}

function parseRoute(value: unknown): AgentTaskRoutePin {
  const input = record(value, 'route')
  exactKeys(input, ['model_id', 'provider_id', 'locality'], 'route')
  return {
    model_id: identifier(input.model_id, 'route.model_id'),
    provider_id: identifier(input.provider_id, 'route.provider_id'),
    locality: oneOf(input.locality, ['local', 'cloud'], 'route.locality'),
  }
}

function parseDatabasePins(value: unknown): AgentTaskDatabasePin[] {
  if (!Array.isArray(value) || value.length > 20) fail('database_pins', 'must be an array with at most 20 entries')
  const seen = new Set<string>()
  return value.map((entry, index) => {
    const input = record(entry, `database_pins[${index}]`)
    exactKeys(input, ['plugin_id', 'version', 'data_policy'], `database_pins[${index}]`)
    const pin: AgentTaskDatabasePin = {
      plugin_id: identifier(input.plugin_id, `database_pins[${index}].plugin_id`),
      version: semver(input.version, `database_pins[${index}].version`),
      data_policy: oneOf(input.data_policy, ['local_only', 'cloud_allowed'], `database_pins[${index}].data_policy`),
    }
    if (seen.has(pin.plugin_id)) fail('database_pins', `contains duplicate ${pin.plugin_id}`)
    seen.add(pin.plugin_id)
    return pin
  })
}

function parseTools(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100) fail('allowed_tools', 'must be an array with at most 100 entries')
  const seen = new Set<string>()
  return value.map((entry, index) => {
    const tool = identifier(entry, `allowed_tools[${index}]`)
    if (seen.has(tool)) fail('allowed_tools', `contains duplicate ${tool}`)
    seen.add(tool)
    return tool
  })
}

function intervalHoursToMs(hours: unknown): number {
  const value = typeof hours === 'number' && Number.isFinite(hours) ? hours : 24
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.round(value * 60 * 60 * 1_000)))
}

function validTimezone(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 100) fail('timezone', 'must be a non-empty IANA timezone')
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
  } catch {
    fail('timezone', `is not a recognized IANA timezone: ${value}`)
  }
  return value
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'must be an object')
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const unexpected = Object.keys(value).find(key => !allowed.includes(key))
  if (unexpected) fail(`${path}.${unexpected}`, 'is not allowed by schema 2')
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

function boundedText(value: unknown, name: string, min: number, max: number): string {
  if (typeof value !== 'string' || value.length < min || value.length > max || value.trim() !== value) {
    fail(name, `must be a trimmed string from ${min} to ${max} characters`)
  }
  return value
}

function stableId(value: unknown, name: string): string {
  return identifier(value, name)
}

function timestamp(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail(name, 'must be a non-negative timestamp')
  return value as number
}

function boundedInteger(value: unknown, name: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) fail(name, `must be an integer from ${min} to ${max}`)
  return value as number
}

function boundedNumber(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(name, `must be a finite number from ${min} to ${max}`)
  return value
}

function boolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') fail(name, 'must be a boolean')
  return value
}

function oneOf<const T extends string>(value: unknown, allowed: readonly T[], name: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail(name, `must be one of: ${allowed.join(', ')}`)
  return value as T
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
  return Math.min(max, Math.max(min, numeric))
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function fail(path: string, message: string): never {
  throw new Error(`Agent schedule ${path} ${message}`)
}

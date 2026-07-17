import { describe, expect, it } from 'vitest'

import {
  AGENT_SCHEDULE_SCHEMA_VERSION,
  countWakesInWindow,
  createAgentSchedule,
  DEFAULT_SCHEDULE_COST_USD_PER_WAKE,
  DEFAULT_SCHEDULE_MAX_WAKES_PER_24H,
  isScheduleFireable,
  migrateScheduleV1,
  nextFutureWakeAt,
  parseAgentSchedule,
  scheduledWakeAt,
  scheduleConsentDiff,
  scheduleToAgentTaskPolicy,
  wallTimeToUtc,
  type AgentScheduleInput,
} from '../../src/core/agentSchedules'
import type { AgentTaskRoutePin } from '../../src/core/agentTaskPolicy'

const LOCAL_ROUTE: AgentTaskRoutePin = { model_id: 'llama3', provider_id: 'ollama', locality: 'local' }
const CREATED_AT = Date.UTC(2026, 0, 1, 8, 0, 0)

function input(over: Partial<AgentScheduleInput> = {}): AgentScheduleInput {
  return {
    title: 'Morning digest',
    instructions: 'Summarize new items in the library.',
    trigger: { kind: 'interval', every_ms: 60 * 60 * 1_000 },
    timezone: 'UTC',
    route: LOCAL_ROUTE,
    allowed_tools: ['read'],
    ...over,
  }
}

function userSchedule(over: Partial<AgentScheduleInput> = {}, id = 'sched-1') {
  return createAgentSchedule(input(over), { id, created_at: CREATED_AT, created_by: 'user', consent_ref: 'consent-save' })
}

describe('createAgentSchedule', () => {
  it('activates a user-authored schedule with an explicit consent ref', () => {
    const schedule = userSchedule()
    expect(schedule).toMatchObject({
      schema_version: AGENT_SCHEDULE_SCHEMA_VERSION,
      consent_state: 'active',
      consent_ref: 'consent-save',
      enabled: true,
      budget_locked: false,
      max_wakes_per_24h: DEFAULT_SCHEDULE_MAX_WAKES_PER_24H,
      max_cost_usd_per_wake: DEFAULT_SCHEDULE_COST_USD_PER_WAKE,
    })
    expect(schedule.next_wake_at).toBe(CREATED_AT + 60 * 60 * 1_000)
    expect(isScheduleFireable(schedule)).toBe(true)
  })

  it('parks an agent-authored schedule as an inert proposal', () => {
    const schedule = createAgentSchedule(input(), { id: 'sched-a', created_at: CREATED_AT, created_by: 'agent' })
    expect(schedule.consent_state).toBe('proposed')
    expect(schedule.consent_ref).toBeNull()
    expect(isScheduleFireable(schedule)).toBe(false)
  })

  it('round-trips through parseAgentSchedule', () => {
    const schedule = userSchedule()
    expect(parseAgentSchedule(schedule)).toEqual(schedule)
  })

  it('rejects an unknown schema version and an unrecognized timezone', () => {
    expect(() => parseAgentSchedule({ ...userSchedule(), schema_version: 1 })).toThrow(/schema_version/)
    expect(() => createAgentSchedule(input({ timezone: 'Mars/Olympus' }), { id: 'x', created_at: CREATED_AT, created_by: 'user', consent_ref: 'c' })).toThrow(/timezone/)
  })
})

describe('scheduled wake timing', () => {
  it('computes one-shot, delay, interval, and daily next wakes', () => {
    expect(scheduledWakeAt(userSchedule({ trigger: { kind: 'once-at', at: CREATED_AT + 5_000 } }))).toBe(CREATED_AT + 5_000)
    expect(scheduledWakeAt(userSchedule({ trigger: { kind: 'delay', delay_ms: 90_000 } }))).toBe(CREATED_AT + 90_000)
    expect(scheduledWakeAt(userSchedule({ trigger: { kind: 'interval', every_ms: 4 * 60 * 60 * 1_000 } }))).toBe(CREATED_AT + 4 * 60 * 60 * 1_000)
    expect(scheduledWakeAt(userSchedule({ trigger: { kind: 'daily', hour: 9, minute: 0 } }))).toBe(Date.UTC(2026, 0, 1, 9, 0))
  })

  it('returns null for a one-shot that has already fired', () => {
    const fired = { ...userSchedule({ trigger: { kind: 'once-at', at: CREATED_AT + 5_000 } }), last_wake_at: CREATED_AT + 5_000 }
    expect(scheduledWakeAt(fired)).toBeNull()
  })

  it('rolls a repeating schedule forward past now, coalescing missed intervals', () => {
    const schedule = userSchedule({ trigger: { kind: 'interval', every_ms: 60 * 60 * 1_000 } })
    const now = CREATED_AT + 5 * 60 * 60 * 1_000 + 10_000
    const { at } = nextFutureWakeAt(schedule, now)
    expect(at).toBe(CREATED_AT + 6 * 60 * 60 * 1_000)
  })
})

describe('DST-aware daily wakes', () => {
  it('advances a nonexistent spring-forward local time to the next valid one', () => {
    // 2026-03-08 02:30 America/New_York does not exist (clocks jump 02:00->03:00).
    const resolved = wallTimeToUtc('America/New_York', 2026, 2, 8, 2, 30)
    expect(resolved.adjustment).toBe('gap')
    // The wake lands at 03:30 EDT == 07:30 UTC.
    expect(resolved.utc).toBe(Date.UTC(2026, 2, 8, 7, 30))
  })

  it('resolves a fall-back local time to a single valid instant', () => {
    // 2026-11-01 01:30 America/New_York is ambiguous; it fires once (first occurrence).
    const resolved = wallTimeToUtc('America/New_York', 2026, 10, 1, 1, 30)
    expect(resolved.utc).toBe(Date.UTC(2026, 10, 1, 5, 30))
  })

  it('keeps an unambiguous local daily time stable', () => {
    const resolved = wallTimeToUtc('America/New_York', 2026, 5, 15, 9, 0)
    expect(resolved.adjustment).toBe('none')
    expect(resolved.utc).toBe(Date.UTC(2026, 5, 15, 13, 0)) // 09:00 EDT == 13:00 UTC
  })
})

describe('consent state machine', () => {
  it('requires renewed consent for a broadening edit but not for narrowing', () => {
    const schedule = userSchedule({ allowed_tools: ['read'], max_cost_usd_per_wake: 0.5, trigger: { kind: 'interval', every_ms: 4 * 60 * 60 * 1_000 } })

    expect(scheduleConsentDiff(schedule, { instructions: 'Do more, differently.' })).toMatchObject({ requires_consent: true, changed: ['instructions'] })
    expect(scheduleConsentDiff(schedule, { allowed_tools: ['read', 'search'] })).toMatchObject({ requires_consent: true })
    expect(scheduleConsentDiff(schedule, { max_cost_usd_per_wake: 1.0 }).requires_consent).toBe(true)
    // A faster cadence broadens; a slower one does not.
    expect(scheduleConsentDiff(schedule, { trigger: { kind: 'interval', every_ms: 60 * 60 * 1_000 } }).requires_consent).toBe(true)
    expect(scheduleConsentDiff(schedule, { trigger: { kind: 'interval', every_ms: 8 * 60 * 60 * 1_000 } }).requires_consent).toBe(false)

    // Lowering a cap, pausing, or renaming never needs consent.
    expect(scheduleConsentDiff(schedule, { max_cost_usd_per_wake: 0.25 }).requires_consent).toBe(false)
    expect(scheduleConsentDiff(schedule, { max_wakes_per_24h: 2 }).requires_consent).toBe(false)
    expect(scheduleConsentDiff(schedule, { enabled: false }).requires_consent).toBe(false)
    expect(scheduleConsentDiff(schedule, { title: 'Renamed' }).requires_consent).toBe(false)
  })
})

describe('legacy v1 migration', () => {
  it('migrates an interval v1 schedule intact but paused for review', () => {
    const migrated = migrateScheduleV1(
      { id: 'old-1', title: 'Legacy hourly', instructions: 'Check feeds.', cadence: { kind: 'interval', hours: 4 }, createdAt: CREATED_AT, catchUp: true },
      LOCAL_ROUTE,
    )
    expect(migrated).toMatchObject({
      schema_version: AGENT_SCHEDULE_SCHEMA_VERSION,
      consent_state: 'needs_review',
      consent_ref: null,
      enabled: false,
      catch_up: 'once',
      trigger: { kind: 'interval', every_ms: 4 * 60 * 60 * 1_000 },
    })
    expect(isScheduleFireable(migrated)).toBe(false)
  })

  it('does not silently resolve a missing model to a default (uses the supplied review route)', () => {
    const migrated = migrateScheduleV1(
      { id: 'old-2', title: 'Legacy daily', instructions: 'Morning check.', cadence: { kind: 'daily', hour: 9, minute: 30 }, createdAt: CREATED_AT },
      LOCAL_ROUTE,
    )
    expect(migrated.route).toEqual(LOCAL_ROUTE)
    expect(migrated.consent_state).toBe('needs_review')
    expect(migrated.trigger).toEqual({ kind: 'daily', hour: 9, minute: 30 })
  })
})

describe('wake-cap accounting and policy projection', () => {
  it('counts only wakes inside the rolling window', () => {
    const now = 100 * 60 * 60 * 1_000
    const window = 24 * 60 * 60 * 1_000
    const times = [now - window - 1, now - window + 1, now - 1, now, now + 5]
    expect(countWakesInWindow(times, now, window)).toBe(3)
  })

  it('projects the per-wake cost cap into the launch policy', () => {
    const schedule = userSchedule({ max_cost_usd_per_wake: 0.4, allowed_tools: ['read', 'search'], max_rounds: 3 })
    const policy = scheduleToAgentTaskPolicy(schedule)
    expect(policy).toMatchObject({
      route: LOCAL_ROUTE,
      requested_tools: ['read', 'search'],
      max_cost_usd: 0.4,
      max_rounds: 3,
      consent_ref: 'consent-save',
    })
  })

  it('refuses to build a launch policy for an unconsented proposal', () => {
    const proposal = createAgentSchedule(input(), { id: 'p', created_at: CREATED_AT, created_by: 'agent' })
    expect(() => scheduleToAgentTaskPolicy(proposal)).toThrow(/unconsented/)
  })
})

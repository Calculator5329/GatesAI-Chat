import { describe, expect, it } from 'vitest'

import type { AgentScheduleInput } from '../../../src/core/agentSchedules'
import type { AgentTaskRoutePin } from '../../../src/core/agentTaskPolicy'
import { ScheduleLedger } from '../../../src/services/tasks/scheduleLedger'

const HOUR = 60 * 60 * 1_000
const T0 = 1_700_000_000_000
const LOCAL_ROUTE: AgentTaskRoutePin = { model_id: 'llama3', provider_id: 'ollama', locality: 'local' }

function scheduleInput(over: Partial<AgentScheduleInput> = {}): AgentScheduleInput {
  return {
    title: 'Hourly check',
    instructions: 'Look for new items and summarize.',
    trigger: { kind: 'interval', every_ms: HOUR },
    timezone: 'UTC',
    route: LOCAL_ROUTE,
    allowed_tools: ['read'],
    ...over,
  }
}

function activeLedger(over: Partial<AgentScheduleInput> = {}, id = 's1'): ScheduleLedger {
  const ledger = new ScheduleLedger()
  const created = ledger.create(scheduleInput(over), { id, created_at: T0, created_by: 'user', consent_ref: 'consent-save' })
  expect(created.ok).toBe(true)
  return ledger
}

describe('proposal and activation', () => {
  it('does not wake an agent proposal until the user activates it', () => {
    const ledger = new ScheduleLedger()
    ledger.create(scheduleInput(), { id: 's1', created_at: T0, created_by: 'agent' })

    expect(ledger.tick(T0 + HOUR + 1).enqueued).toHaveLength(0)

    const activated = ledger.activate('s1', 'consent-approve')
    expect(activated.ok).toBe(true)

    const result = ledger.tick(T0 + HOUR + 1)
    expect(result.enqueued).toHaveLength(1)
    expect(result.enqueued[0].spec.id).toBe('s1:wake:0')
    expect(result.enqueued[0].event).toMatchObject({ schedule_id: 's1', kind: 'scheduled' })
    expect(result.enqueued[0].spec.policy.route).toEqual(LOCAL_ROUTE)
  })
})

describe('one scheduler tick, one TaskStore enqueue', () => {
  it('enqueues an ordinary agent TaskSpec built from the schedule policy', () => {
    const ledger = activeLedger({ allowed_tools: ['read', 'search'], max_cost_usd_per_wake: 0.4, max_rounds: 3 })
    const result = ledger.tick(T0 + HOUR + 1)
    expect(result.enqueued).toHaveLength(1)
    const spec = result.enqueued[0].spec
    expect(spec.title).toBe('Hourly check')
    expect(spec.policy).toMatchObject({ requested_tools: ['read', 'search'], max_cost_usd: 0.4, max_rounds: 3, consent_ref: 'consent-save' })
  })

  it('forbids overlap: a schedule with an in-flight wake coalesces the next due wake', () => {
    const ledger = activeLedger()
    expect(ledger.tick(T0 + HOUR + 1).enqueued).toHaveLength(1)

    const overlap = ledger.tick(T0 + 3 * HOUR + 1)
    expect(overlap.enqueued).toHaveLength(0)
    expect(overlap.skipped.map(skip => skip.reason)).toContain('overlap')
  })

  it('lets the schedule fire again once the prior wake reports its outcome', () => {
    const ledger = activeLedger()
    const first = ledger.tick(T0 + HOUR + 1)
    const taskId = first.enqueued[0].spec.id
    expect(ledger.recordWakeOutcome('s1', taskId, { cost_usd: 0.1, terminal_state: 'done' })).toBe(true)
    expect(ledger.get('s1')?.last_result_task_id).toBe(taskId)

    const again = ledger.tick(T0 + 3 * HOUR + 1)
    expect(again.enqueued).toHaveLength(1)
    expect(again.enqueued[0].spec.id).not.toBe(taskId)
  })
})

describe('wake caps', () => {
  it('skips with a distinct reason once the per-schedule 24h cap is reached', () => {
    const ledger = activeLedger({ max_wakes_per_24h: 1 })
    const first = ledger.tick(T0 + HOUR + 1)
    expect(first.enqueued).toHaveLength(1)
    ledger.recordWakeOutcome('s1', first.enqueued[0].spec.id, { cost_usd: 0.1, terminal_state: 'done' })

    const capped = ledger.tick(T0 + 3 * HOUR + 1)
    expect(capped.enqueued).toHaveLength(0)
    expect(capped.skipped.map(skip => skip.reason)).toContain('wake_cap_schedule')
  })
})

describe('catch-up on launch', () => {
  it('skips a wake missed while the app was closed when catchUp is skip', () => {
    const ledger = activeLedger({ catch_up: 'skip' })
    const launch = ledger.tick(T0 + 10 * HOUR, { launch: true })
    expect(launch.enqueued).toHaveLength(0)
    expect(launch.skipped.map(skip => skip.reason)).toContain('missed_while_closed')
    // The next wake has advanced past now so it does not stay perpetually due.
    expect(ledger.get('s1')!.next_wake_at! > T0 + 10 * HOUR).toBe(true)
  })

  it('enqueues exactly one catch-up wake when catchUp is once, never fanning out', () => {
    const ledger = activeLedger({ catch_up: 'once' })
    const launch = ledger.tick(T0 + 10 * HOUR, { launch: true })
    expect(launch.enqueued).toHaveLength(1)
    expect(launch.enqueued[0].event.kind).toBe('catch_up')
    expect(ledger.get('s1')!.next_wake_at! > T0 + 10 * HOUR).toBe(true)
  })
})

describe('spend rails', () => {
  it('locks future wakes after a run overshoots the per-wake cost cap', () => {
    const ledger = activeLedger({ max_cost_usd_per_wake: 0.5 })
    const first = ledger.tick(T0 + HOUR + 1)
    ledger.recordWakeOutcome('s1', first.enqueued[0].spec.id, { cost_usd: 0.9, terminal_state: 'done' })

    expect(ledger.get('s1')?.budget_locked).toBe(true)
    expect(ledger.tick(T0 + 3 * HOUR + 1).enqueued).toHaveLength(0)

    // The user clears the lock explicitly; then wakes resume.
    ledger.clearBudgetLock('s1')
    expect(ledger.tick(T0 + 4 * HOUR + 1).enqueued).toHaveLength(1)
  })
})

describe('global pause', () => {
  it('stops and resumes every wake through the always-available switch', () => {
    const ledger = activeLedger()
    ledger.setPauseAll(true)
    expect(ledger.tick(T0 + HOUR + 1).enqueued).toHaveLength(0)
    ledger.setPauseAll(false)
    expect(ledger.tick(T0 + HOUR + 1).enqueued).toHaveLength(1)
  })
})

describe('run now', () => {
  it('fires immediately, marks it a run_now wake, and rejects a second while in flight', () => {
    const ledger = activeLedger()
    const run = ledger.runNow('s1', T0 + 90_000)
    expect(run.ok).toBe(true)
    if (run.ok) {
      expect(run.wake.event.kind).toBe('run_now')
      // A run-now leaves the natural next wake untouched.
      expect(ledger.get('s1')?.next_wake_at).toBe(T0 + HOUR)
    }
    expect(ledger.runNow('s1', T0 + 100_000)).toMatchObject({ ok: false, code: 'in_flight' })
  })
})

describe('edit consent gating', () => {
  it('drops an active schedule to needs_consent on a broadening edit and re-activates on consent', () => {
    const ledger = activeLedger()
    const edited = ledger.edit('s1', { instructions: 'Do broader, different work now.' })
    expect(edited.ok && edited.schedule.consent_state).toBe('needs_consent')
    expect(ledger.tick(T0 + HOUR + 1).enqueued).toHaveLength(0)

    const reconsented = ledger.activate('s1', 'consent-renewed')
    expect(reconsented.ok && reconsented.schedule.consent_state).toBe('active')
    expect(ledger.tick(T0 + HOUR + 1).enqueued).toHaveLength(1)
  })

  it('keeps an active schedule active when a cap is only lowered', () => {
    const ledger = activeLedger({ max_wakes_per_24h: 4 })
    const edited = ledger.edit('s1', { max_wakes_per_24h: 2 })
    expect(edited.ok && edited.schedule.consent_state).toBe('active')
  })
})

describe('persistence across restarts', () => {
  it('snapshots schedules and restores them, recovering an in-flight wake as interrupted', () => {
    const ledger = activeLedger({ catch_up: 'once' })
    ledger.setPauseAll(false)
    const fired = ledger.tick(T0 + HOUR + 1)
    expect(fired.enqueued).toHaveLength(1)

    const snapshot = ledger.snapshot()
    expect(snapshot.in_flight).toHaveLength(1)

    const restored = ScheduleLedger.restore(snapshot)
    const schedule = restored.get('s1')
    expect(schedule).not.toBeNull()
    expect(schedule?.consent_state).toBe('active')
    // The orphaned wake is not silently resumed: a fresh tick can fire again.
    expect(restored.snapshot().in_flight).toHaveLength(0)
  })

  it('rejects a snapshot from an unknown version', () => {
    expect(() => ScheduleLedger.restore({ schema_version: 99, schedules: [] })).toThrow(/version 1/)
  })
})

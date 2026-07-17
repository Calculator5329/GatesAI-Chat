// Live self-scheduling ledger for the agentic platform (Story AP-3).
//
// The core `agentSchedules` module owns the pure schedule schema, DST-aware
// timing, consent state machine, and cap math. This service composes those
// decisions into a durable, drivable ledger that the store layer ticks:
//
//   * one scheduler tick computes due schedules and enqueues an ordinary agent
//     `AgentTaskSpec` onto the shared TaskStore ledger — there is no second
//     timer or queue; TaskStore owns the run from that point;
//   * overlap is forbidden per schedule (at most one in-flight wake), and a
//     single tick fires at most one wake per schedule then rolls the next wake
//     past "now", so a long sleep never fans out every missed interval;
//   * on launch, `catchUp: once` enqueues at most one missed wake after the
//     caps/consent still allow it, while `catchUp: skip` advances silently;
//   * rolling-24h per-schedule and global wake caps, a per-wake spend cap, and
//     a daily aggregate spend ceiling all fail closed with a distinct reason,
//     and a cost overshoot locks that schedule's future wakes;
//   * a global "pause all" switch is always available; and
//   * every fired wake and every skip is logged for the task history/audit, and
//     the whole ledger serializes to a snapshot so schedules and their wake
//     accounting survive an app restart.
//
// It reads the clock only through the `nowMs` arguments its driver passes, makes
// no model calls, and holds no MobX state — the store mirrors its projections
// into the task center and hands the produced specs to TaskStore.

import {
  countWakesInWindow,
  createAgentSchedule,
  GLOBAL_SCHEDULE_MAX_WAKES_PER_24H,
  isScheduleFireable,
  nextFutureWakeAt,
  parseAgentSchedule,
  scheduledWakeAt,
  scheduleConsentDiff,
  scheduleToAgentTaskPolicy,
  SCHEDULE_ROLLING_WINDOW_MS,
  type AgentSchedule,
  type AgentScheduleInput,
  type AgentSchedulePatch,
  type ScheduleCreatedBy,
  type WakeClockAdjustment,
  type WakeSkipReason,
} from '../../core/agentSchedules'
import { DEFAULT_AGENT_TASK_DAILY_COST_USD } from '../../core/agentTaskPolicy'
import { createAgentTaskSpec, type AgentTaskSpec } from './agentTaskSpec'

export const SCHEDULE_LEDGER_SNAPSHOT_VERSION = 1 as const
/** Wake/skip audit entries older than this are pruned; well beyond the cap window. */
const AUDIT_RETENTION_MS = 30 * SCHEDULE_ROLLING_WINDOW_MS

export type WakeKind = 'scheduled' | 'catch_up' | 'run_now'

export interface WakeEvent {
  schedule_id: string
  task_id: string
  kind: WakeKind
  /** The instant the schedule was due to fire (may be in the past for catch-up). */
  scheduled_for: number
  fired_at: number
  clock_adjustment: WakeClockAdjustment
  /** Filled in when the run reports its outcome; undefined while the wake is in flight. */
  cost_usd?: number
  terminal_state?: 'done' | 'failed' | 'cancelled' | 'interrupted'
}

export interface WakeSkip {
  schedule_id: string
  reason: WakeSkipReason
  scheduled_for: number
  at: number
}

export interface EnqueuedWake {
  spec: AgentTaskSpec
  event: WakeEvent
}

export interface ScheduleTickResult {
  enqueued: EnqueuedWake[]
  skipped: WakeSkip[]
}

export interface ScheduleLedgerSnapshot {
  schema_version: typeof SCHEDULE_LEDGER_SNAPSHOT_VERSION
  schedules: AgentSchedule[]
  wake_events: WakeEvent[]
  wake_skips: WakeSkip[]
  in_flight: Array<{ schedule_id: string; task_id: string }>
  all_paused: boolean
  sequence: number
}

export interface ScheduleLedgerOptions {
  /** Aggregate cloud spend ceiling across schedules per rolling 24h. */
  dailyCostCeilingUsd?: number
  /** Overrides task-id minting; defaults to `${scheduleId}:wake:${sequence}`. */
  taskIdFactory?: (scheduleId: string, sequence: number) => string
}

export type ScheduleMutationResult =
  | { ok: true; schedule: AgentSchedule }
  | { ok: false; code: ScheduleMutationFailure; detail: string }

export type ScheduleMutationFailure =
  | 'not_found'
  | 'invalid_input'
  | 'needs_consent'
  | 'not_consentable'
  | 'budget_locked'
  | 'paused'
  | 'in_flight'

interface ScheduleRecord {
  schedule: AgentSchedule
  in_flight_task_id: string | null
}

/**
 * The durable self-scheduling ledger. Construct empty and drive it, or rebuild
 * one from a persisted snapshot with {@link ScheduleLedger.restore}.
 */
export class ScheduleLedger {
  private readonly records = new Map<string, ScheduleRecord>()
  private readonly order: string[] = []
  private readonly wakeEvents: WakeEvent[] = []
  private readonly wakeSkips: WakeSkip[] = []
  private readonly ceiling: number
  private readonly makeTaskId: (scheduleId: string, sequence: number) => string
  private allPaused = false
  private sequence = 0

  constructor(options: ScheduleLedgerOptions = {}) {
    this.ceiling = resolveCeiling(options.dailyCostCeilingUsd)
    this.makeTaskId = options.taskIdFactory ?? ((scheduleId, sequence) => `${scheduleId}:wake:${sequence}`)
  }

  get all(): AgentSchedule[] {
    return this.order.map(id => clone(this.mustGet(id).schedule))
  }

  get pausedAll(): boolean {
    return this.allPaused
  }

  get(scheduleId: string): AgentSchedule | null {
    const record = this.records.get(scheduleId)
    return record ? clone(record.schedule) : null
  }

  events(): WakeEvent[] {
    return this.wakeEvents.map(event => ({ ...event }))
  }

  skips(): WakeSkip[] {
    return this.wakeSkips.map(skip => ({ ...skip }))
  }

  // -- lifecycle -----------------------------------------------------------

  /** Add a schedule from validated input. A user save carries its own consent. */
  create(input: AgentScheduleInput, ctx: { id: string; created_at: number; created_by: ScheduleCreatedBy; consent_ref?: string }): ScheduleMutationResult {
    let schedule: AgentSchedule
    try {
      schedule = createAgentSchedule(input, ctx)
    } catch (error) {
      return { ok: false, code: 'invalid_input', detail: message(error) }
    }
    if (this.records.has(schedule.id)) return { ok: false, code: 'invalid_input', detail: `Duplicate schedule id ${schedule.id}` }
    this.records.set(schedule.id, { schedule, in_flight_task_id: null })
    this.order.push(schedule.id)
    return { ok: true, schedule: clone(schedule) }
  }

  /** Approve a proposed or review-pending schedule; renewed consent activates it. */
  activate(scheduleId: string, consentRef: string): ScheduleMutationResult {
    const record = this.records.get(scheduleId)
    if (!record) return { ok: false, code: 'not_found', detail: `No schedule ${scheduleId}` }
    if (!isConsentRef(consentRef)) return { ok: false, code: 'invalid_input', detail: 'An activation requires an explicit consent reference' }
    const state = record.schedule.consent_state
    if (state !== 'proposed' && state !== 'needs_consent' && state !== 'needs_review') {
      return { ok: false, code: 'not_consentable', detail: `Schedule ${scheduleId} is already ${state}` }
    }
    record.schedule = {
      ...record.schedule,
      consent_ref: consentRef,
      consent_state: 'active',
      enabled: true,
      next_wake_at: scheduledWakeAt(record.schedule),
    }
    return { ok: true, schedule: clone(record.schedule) }
  }

  /**
   * Apply an edit. A change that broadens authority (instructions, route, data
   * pins, tools, a faster cadence, catch-up, or a raised cap) returns the
   * schedule to `needs_consent`; pausing, lowering a cap, or a title change does
   * not. An edit requiring consent must supply the renewing consent ref.
   */
  edit(scheduleId: string, patch: AgentSchedulePatch, consentRef?: string): ScheduleMutationResult {
    const record = this.records.get(scheduleId)
    if (!record) return { ok: false, code: 'not_found', detail: `No schedule ${scheduleId}` }

    let diff
    try {
      diff = scheduleConsentDiff(record.schedule, patch)
    } catch (error) {
      return { ok: false, code: 'invalid_input', detail: message(error) }
    }

    let next: AgentSchedule
    try {
      next = applyPatch(record.schedule, patch)
    } catch (error) {
      return { ok: false, code: 'invalid_input', detail: message(error) }
    }

    if (diff.requires_consent) {
      if (consentRef !== undefined && isConsentRef(consentRef)) {
        next = { ...next, consent_ref: consentRef, consent_state: 'active' }
      } else if (record.schedule.consent_state === 'active') {
        // A broadening edit to an active schedule drops it back to pending consent.
        next = { ...next, consent_state: 'needs_consent' }
      }
      // A still-pending schedule (proposed/needs_review/needs_consent) keeps its
      // pending state — an edit never advances it toward running.
    }
    next = { ...next, next_wake_at: scheduledWakeAt(next) }
    record.schedule = next
    return { ok: true, schedule: clone(next) }
  }

  /** Pause a schedule (no consent needed); its next wake is preserved. */
  pause(scheduleId: string): ScheduleMutationResult {
    return this.setEnabled(scheduleId, false)
  }

  /** Resume a paused, still-consented schedule. */
  resume(scheduleId: string): ScheduleMutationResult {
    const record = this.records.get(scheduleId)
    if (!record) return { ok: false, code: 'not_found', detail: `No schedule ${scheduleId}` }
    if (record.schedule.consent_state !== 'active') {
      return { ok: false, code: 'needs_consent', detail: `Schedule ${scheduleId} must be re-consented before it can resume` }
    }
    return this.setEnabled(scheduleId, true)
  }

  /** Remove a schedule. A schedule with an in-flight wake cannot be archived. */
  archive(scheduleId: string): ScheduleMutationResult {
    const record = this.records.get(scheduleId)
    if (!record) return { ok: false, code: 'not_found', detail: `No schedule ${scheduleId}` }
    if (record.in_flight_task_id !== null) return { ok: false, code: 'in_flight', detail: 'Cancel the in-flight wake before archiving' }
    const removed = clone(record.schedule)
    this.records.delete(scheduleId)
    this.order.splice(this.order.indexOf(scheduleId), 1)
    return { ok: true, schedule: removed }
  }

  /** Clear a spend lock after the user lowered cost, re-routed, or renewed budget. */
  clearBudgetLock(scheduleId: string): ScheduleMutationResult {
    const record = this.records.get(scheduleId)
    if (!record) return { ok: false, code: 'not_found', detail: `No schedule ${scheduleId}` }
    record.schedule = { ...record.schedule, budget_locked: false }
    return { ok: true, schedule: clone(record.schedule) }
  }

  /** The always-available global switch: stop or resume all schedule wakes. */
  setPauseAll(paused: boolean): void {
    this.allPaused = paused === true
  }

  // -- ticking -------------------------------------------------------------

  /**
   * Compute due wakes at `nowMs` and enqueue at most one per schedule. Pass
   * `{ launch: true }` on app start so `catchUp` policy governs wakes missed
   * while the process was closed.
   */
  tick(nowMs: number, options: { launch?: boolean } = {}): ScheduleTickResult {
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error('Schedule ledger tick requires a non-negative timestamp')
    const launch = options.launch === true
    const result: ScheduleTickResult = { enqueued: [], skipped: [] }

    for (const id of this.order) {
      const record = this.mustGet(id)
      const schedule = record.schedule
      const due = schedule.next_wake_at
      if (due === null || due > nowMs) continue

      // Inactive/paused schedules stay due until they are resumed or re-consented.
      if (this.allPaused || !isScheduleFireable(schedule)) {
        continue
      }
      // Overlap is forbidden: a schedule with an in-flight wake coalesces.
      if (record.in_flight_task_id !== null) {
        result.skipped.push(this.recordSkip(record, 'overlap', due, nowMs))
        continue
      }
      // On launch, a missed wake obeys the schedule's catch-up choice.
      if (launch && schedule.catch_up === 'skip') {
        result.skipped.push(this.recordSkip(record, 'missed_while_closed', due, nowMs))
        continue
      }

      const capReason = this.capReason(schedule, nowMs)
      if (capReason !== null) {
        result.skipped.push(this.recordSkip(record, capReason, due, nowMs))
        continue
      }

      const kind: WakeKind = launch ? 'catch_up' : 'scheduled'
      result.enqueued.push(this.fire(record, due, nowMs, kind))
    }

    this.prune(nowMs)
    return result
  }

  /**
   * Fire a schedule immediately at the user's request, bypassing wake caps and
   * the enabled flag but never overlap or a spend lock. The schedule must have
   * been consented at least once.
   */
  runNow(scheduleId: string, nowMs: number, consentRef?: string): { ok: true; wake: EnqueuedWake } | { ok: false; code: ScheduleMutationFailure; detail: string } {
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) return { ok: false, code: 'invalid_input', detail: 'run-now requires a non-negative timestamp' }
    const record = this.records.get(scheduleId)
    if (!record) return { ok: false, code: 'not_found', detail: `No schedule ${scheduleId}` }
    const schedule = record.schedule
    if (consentRef !== undefined && isConsentRef(consentRef)) {
      record.schedule = { ...schedule, consent_ref: consentRef, consent_state: 'active' }
    }
    if (record.schedule.consent_ref === null) return { ok: false, code: 'needs_consent', detail: 'Run-now requires the schedule to be consented' }
    if (record.schedule.budget_locked) return { ok: false, code: 'budget_locked', detail: 'Clear the spend lock before running now' }
    if (record.in_flight_task_id !== null) return { ok: false, code: 'in_flight', detail: 'A wake is already in flight for this schedule' }
    if (this.allPaused) return { ok: false, code: 'paused', detail: 'All schedules are paused' }
    return { ok: true, wake: this.fire(record, nowMs, nowMs, 'run_now') }
  }

  /**
   * Record a wake's terminal outcome: clears the in-flight lock, links the
   * result task, and — if the run overshot its per-wake cap or the daily
   * aggregate ceiling — locks the schedule's future wakes.
   */
  recordWakeOutcome(scheduleId: string, taskId: string, outcome: { cost_usd: number; terminal_state: 'done' | 'failed' | 'cancelled' | 'interrupted' }): boolean {
    const record = this.records.get(scheduleId)
    if (!record) return false
    if (record.in_flight_task_id !== taskId) return false
    if (!Number.isFinite(outcome.cost_usd) || outcome.cost_usd < 0) return false

    const event = [...this.wakeEvents].reverse().find(candidate => candidate.task_id === taskId && candidate.schedule_id === scheduleId)
    if (event) {
      event.cost_usd = outcome.cost_usd
      event.terminal_state = outcome.terminal_state
    }

    record.in_flight_task_id = null
    const overWake = micros(outcome.cost_usd) > micros(record.schedule.max_cost_usd_per_wake)
    const overDaily = micros(this.rollingSpend(event?.fired_at ?? 0)) > micros(this.ceiling)
    record.schedule = {
      ...record.schedule,
      last_result_task_id: taskId,
      budget_locked: record.schedule.budget_locked || overWake || overDaily,
    }
    return true
  }

  /** Mark an in-flight wake interrupted (app closed mid-run); no paid replay. */
  markInterrupted(scheduleId: string, taskId: string): boolean {
    return this.recordWakeOutcome(scheduleId, taskId, { cost_usd: 0, terminal_state: 'interrupted' })
  }

  // -- persistence ---------------------------------------------------------

  snapshot(): ScheduleLedgerSnapshot {
    return {
      schema_version: SCHEDULE_LEDGER_SNAPSHOT_VERSION,
      schedules: this.order.map(id => clone(this.mustGet(id).schedule)),
      wake_events: this.wakeEvents.map(event => ({ ...event })),
      wake_skips: this.wakeSkips.map(skip => ({ ...skip })),
      in_flight: this.order
        .map(id => this.mustGet(id))
        .filter(record => record.in_flight_task_id !== null)
        .map(record => ({ schedule_id: record.schedule.id, task_id: record.in_flight_task_id as string })),
      all_paused: this.allPaused,
      sequence: this.sequence,
    }
  }

  static restore(snapshot: unknown, options: ScheduleLedgerOptions = {}): ScheduleLedger {
    const parsed = record(snapshot, 'snapshot')
    if (parsed.schema_version !== SCHEDULE_LEDGER_SNAPSHOT_VERSION) throw new Error('Schedule ledger snapshot must be version 1')
    const ledger = new ScheduleLedger(options)

    const schedules = parsed.schedules
    if (!Array.isArray(schedules)) throw new Error('Schedule ledger snapshot schedules must be an array')
    for (const raw of schedules) {
      const schedule = parseAgentSchedule(raw)
      if (ledger.records.has(schedule.id)) throw new Error(`Schedule ledger snapshot has duplicate id ${schedule.id}`)
      ledger.records.set(schedule.id, { schedule, in_flight_task_id: null })
      ledger.order.push(schedule.id)
    }

    const inFlight = Array.isArray(parsed.in_flight) ? parsed.in_flight : []
    for (const entry of inFlight) {
      const item = record(entry, 'snapshot.in_flight[]')
      const target = ledger.records.get(String(item.schedule_id))
      // A run that was in flight when the app closed is orphaned; it is cleared
      // to interrupted (retryable) rather than silently resumed with stale
      // context or billed twice.
      if (target) target.in_flight_task_id = null
    }

    if (Array.isArray(parsed.wake_events)) {
      for (const raw of parsed.wake_events) ledger.wakeEvents.push(restoreEvent(raw))
    }
    if (Array.isArray(parsed.wake_skips)) {
      for (const raw of parsed.wake_skips) ledger.wakeSkips.push(restoreSkip(raw))
    }
    ledger.allPaused = parsed.all_paused === true
    ledger.sequence = Number.isSafeInteger(parsed.sequence) && (parsed.sequence as number) >= 0 ? (parsed.sequence as number) : ledger.wakeEvents.length
    return ledger
  }

  // -- internals -----------------------------------------------------------

  private fire(record: ScheduleRecord, scheduledFor: number, nowMs: number, kind: WakeKind): EnqueuedWake {
    const schedule = record.schedule
    const sequence = this.sequence++
    const taskId = this.makeTaskId(schedule.id, sequence)
    const spec = createAgentTaskSpec({
      id: taskId,
      title: schedule.title,
      instructions: schedule.instructions,
      origin_thread_id: schedule.id,
      created_at: nowMs,
      policy: scheduleToAgentTaskPolicy(schedule),
    })
    const event: WakeEvent = {
      schedule_id: schedule.id,
      task_id: taskId,
      kind,
      scheduled_for: scheduledFor,
      fired_at: nowMs,
      clock_adjustment: this.adjustmentFor(schedule, scheduledFor),
    }
    this.wakeEvents.push(event)
    record.in_flight_task_id = taskId
    // Advance strictly past now so missed intervals coalesce into this one fire.
    const future = kind === 'run_now' ? scheduledWakeAt(schedule) : nextFutureWakeAt(schedule, nowMs).at
    record.schedule = {
      ...schedule,
      last_wake_at: nowMs,
      next_wake_at: kind === 'run_now' ? schedule.next_wake_at : future,
    }
    return { spec, event: { ...event } }
  }

  private adjustmentFor(schedule: AgentSchedule, scheduledFor: number): WakeClockAdjustment {
    if (schedule.trigger.kind !== 'daily') return 'none'
    // The first daily wake strictly after (scheduledFor − 1) is the one being
    // fired, so this reports that instant's DST resolution for the audit log.
    return nextFutureWakeAt(schedule, scheduledFor - 1).adjustment
  }

  private capReason(schedule: AgentSchedule, nowMs: number): Extract<WakeSkipReason, 'wake_cap_schedule' | 'wake_cap_global' | 'budget_locked'> | null {
    const scheduleWakes = countWakesInWindow(this.wakeTimes(schedule.id), nowMs)
    if (scheduleWakes >= schedule.max_wakes_per_24h) return 'wake_cap_schedule'
    const globalWakes = countWakesInWindow(this.wakeTimes(), nowMs)
    if (globalWakes >= GLOBAL_SCHEDULE_MAX_WAKES_PER_24H) return 'wake_cap_global'
    if (micros(this.rollingSpend(nowMs)) >= micros(this.ceiling)) return 'budget_locked'
    return null
  }

  private setEnabled(scheduleId: string, enabled: boolean): ScheduleMutationResult {
    const record = this.records.get(scheduleId)
    if (!record) return { ok: false, code: 'not_found', detail: `No schedule ${scheduleId}` }
    record.schedule = { ...record.schedule, enabled }
    return { ok: true, schedule: clone(record.schedule) }
  }

  private recordSkip(record: ScheduleRecord, reason: WakeSkipReason, scheduledFor: number, nowMs: number): WakeSkip {
    const skip: WakeSkip = { schedule_id: record.schedule.id, reason, scheduled_for: scheduledFor, at: nowMs }
    this.wakeSkips.push(skip)
    // A skip advances the schedule so it does not stay perpetually due, but it
    // does not count against the wake caps.
    record.schedule = { ...record.schedule, next_wake_at: nextFutureWakeAt(record.schedule, nowMs).at }
    return { ...skip }
  }

  private wakeTimes(scheduleId?: string): number[] {
    return this.wakeEvents
      .filter(event => scheduleId === undefined || event.schedule_id === scheduleId)
      .map(event => event.fired_at)
  }

  private rollingSpend(nowMs: number): number {
    const floor = nowMs - SCHEDULE_ROLLING_WINDOW_MS
    let micrototal = 0
    for (const event of this.wakeEvents) {
      if (event.cost_usd === undefined) continue
      if (event.fired_at > floor && event.fired_at <= nowMs) micrototal += micros(event.cost_usd)
    }
    return micrototal / 1_000_000
  }

  private prune(nowMs: number): void {
    const floor = nowMs - AUDIT_RETENTION_MS
    dropOlder(this.wakeEvents, event => event.fired_at, floor, this.records)
    dropOlder(this.wakeSkips, skip => skip.at, floor, this.records)
  }

  private mustGet(id: string): ScheduleRecord {
    const record = this.records.get(id)
    if (!record) throw new Error(`Schedule ledger missing ${id}`)
    return record
  }
}

function dropOlder<T>(list: T[], at: (item: T) => number, floor: number, active: Map<string, ScheduleRecord>): void {
  // Keep audit entries within retention and any that still reference an in-flight task.
  const inFlight = new Set<string>()
  for (const record of active.values()) if (record.in_flight_task_id) inFlight.add(record.in_flight_task_id)
  for (let i = list.length - 1; i >= 0; i--) {
    const item = list[i] as unknown as { task_id?: string }
    if (at(list[i]) <= floor && !(item.task_id && inFlight.has(item.task_id))) list.splice(i, 1)
  }
}

function applyPatch(current: AgentSchedule, patch: AgentSchedulePatch): AgentSchedule {
  // Rebuild through createAgentSchedule so every changed field is re-validated,
  // then restore the identity/runtime fields the patch must not silently reset.
  const rebuilt = createAgentSchedule(
    {
      title: patch.title ?? current.title,
      instructions: patch.instructions ?? current.instructions,
      trigger: patch.trigger ?? current.trigger,
      timezone: patch.timezone ?? current.timezone,
      route: patch.route ?? current.route,
      skill_id: patch.skill_id ?? current.skill_id,
      database_pins: patch.database_pins ?? current.database_pins,
      allowed_tools: patch.allowed_tools ?? current.allowed_tools,
      catch_up: patch.catch_up ?? current.catch_up,
      enabled: patch.enabled ?? current.enabled,
      max_rounds: patch.max_rounds ?? current.max_rounds,
      max_tokens: patch.max_tokens ?? current.max_tokens,
      max_runtime_ms: patch.max_runtime_ms ?? current.max_runtime_ms,
      max_cost_usd_per_wake: patch.max_cost_usd_per_wake ?? current.max_cost_usd_per_wake,
      max_wakes_per_24h: patch.max_wakes_per_24h ?? current.max_wakes_per_24h,
    },
    { id: current.id, created_at: current.created_at, created_by: current.created_by, consent_ref: current.consent_ref ?? undefined },
  )
  return {
    ...rebuilt,
    consent_ref: current.consent_ref,
    consent_state: current.consent_state,
    budget_locked: current.budget_locked,
    last_wake_at: current.last_wake_at,
    last_result_task_id: current.last_result_task_id,
  }
}

function restoreEvent(value: unknown): WakeEvent {
  const item = record(value, 'wake_event')
  return {
    schedule_id: String(item.schedule_id),
    task_id: String(item.task_id),
    kind: (['scheduled', 'catch_up', 'run_now'] as const).includes(item.kind as WakeKind) ? (item.kind as WakeKind) : 'scheduled',
    scheduled_for: numberOr(item.scheduled_for, 0),
    fired_at: numberOr(item.fired_at, 0),
    clock_adjustment: (['none', 'gap', 'ambiguous'] as const).includes(item.clock_adjustment as WakeClockAdjustment) ? (item.clock_adjustment as WakeClockAdjustment) : 'none',
    cost_usd: item.cost_usd === undefined ? undefined : numberOr(item.cost_usd, 0),
    terminal_state: item.terminal_state === undefined ? undefined : (item.terminal_state as WakeEvent['terminal_state']),
  }
}

function restoreSkip(value: unknown): WakeSkip {
  const item = record(value, 'wake_skip')
  return {
    schedule_id: String(item.schedule_id),
    reason: item.reason as WakeSkipReason,
    scheduled_for: numberOr(item.scheduled_for, 0),
    at: numberOr(item.at, 0),
  }
}

function resolveCeiling(value: number | undefined): number {
  if (value === undefined) return DEFAULT_AGENT_TASK_DAILY_COST_USD
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error('Schedule ledger daily cost ceiling must be a finite non-negative number')
  }
  return value
}

function isConsentRef(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.trim() === value
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`Schedule ledger ${path} must be an object`)
  return value as Record<string, unknown>
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clone(schedule: AgentSchedule): AgentSchedule {
  return {
    ...schedule,
    trigger: { ...schedule.trigger },
    route: { ...schedule.route },
    database_pins: schedule.database_pins.map(pin => ({ ...pin })),
    allowed_tools: [...schedule.allowed_tools],
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function micros(value: number): number {
  return Math.round(value * 1_000_000)
}

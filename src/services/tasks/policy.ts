import type { AgentTaskPolicy, AgentTaskPolicyFailureCode } from '../../core/agentTaskPolicy'
import { AGENT_TASK_HARD_COST_CEILING_USD } from '../../core/agentTaskPolicy'

const USD_SCALE = 1_000_000
const TOKENS_PER_MILLION = 1_000_000

export interface AgentTaskPricing {
  prompt_usd_per_million?: number
  completion_usd_per_million?: number
}

export interface AgentTaskBudgetState {
  spent_today_usd: number
  reserved_today_usd: number
  spent_run_usd: number
  reserved_run_usd: number
  daily_limit_usd: number
}

export type AgentTaskBudgetDecision =
  | { ok: true; reservation_usd: number; next: AgentTaskBudgetState }
  | { ok: false; code: Extract<AgentTaskPolicyFailureCode, 'unknown_price' | 'run_spend_limit' | 'daily_spend_limit' | 'hard_spend_limit'>; detail: string }

export type AgentTaskStepDecision =
  | { ok: true }
  | { ok: false; code: Extract<AgentTaskPolicyFailureCode, 'round_limit' | 'runtime_limit' | 'token_limit'>; detail: string }

export function estimateWorstCaseRequestCost(input: {
  locality: 'local' | 'cloud'
  pricing?: AgentTaskPricing
  prompt_tokens: number
  max_output_tokens: number
}): { ok: true; cost_usd: number } | { ok: false; code: 'unknown_price' } {
  integer(input.prompt_tokens, 'prompt_tokens')
  integer(input.max_output_tokens, 'max_output_tokens')
  if (input.locality === 'local') return { ok: true, cost_usd: 0 }
  if (!input.pricing
    || !validPrice(input.pricing.prompt_usd_per_million)
    || !validPrice(input.pricing.completion_usd_per_million)) {
    return { ok: false, code: 'unknown_price' }
  }
  const cost = (
    input.prompt_tokens * input.pricing.prompt_usd_per_million
      + input.max_output_tokens * input.pricing.completion_usd_per_million
  ) / TOKENS_PER_MILLION
  return { ok: true, cost_usd: fromMicros(Math.ceil(cost * USD_SCALE)) }
}

export function reserveAgentTaskBudget(input: {
  policy: AgentTaskPolicy
  state: AgentTaskBudgetState
  worst_case_cost_usd?: number
}): AgentTaskBudgetDecision {
  const state = validateBudgetState(input.state)
  if (input.worst_case_cost_usd === undefined) {
    return { ok: false, code: 'unknown_price', detail: 'Paid route has no complete price for reservation' }
  }
  const reservation = money(input.worst_case_cost_usd, 'worst_case_cost_usd')
  const runTotal = addMoney(state.spent_run_usd, state.reserved_run_usd, reservation)
  if (runTotal > toMicros(input.policy.max_cost_usd)) {
    return { ok: false, code: 'run_spend_limit', detail: 'Worst-case request exceeds the per-run budget' }
  }
  const dailyTotal = addMoney(state.spent_today_usd, state.reserved_today_usd, reservation)
  if (dailyTotal > toMicros(AGENT_TASK_HARD_COST_CEILING_USD)) {
    return { ok: false, code: 'hard_spend_limit', detail: 'Worst-case request exceeds the hard workspace ceiling' }
  }
  if (dailyTotal > toMicros(state.daily_limit_usd)) {
    return { ok: false, code: 'daily_spend_limit', detail: 'Worst-case request exceeds the local-day budget' }
  }
  return {
    ok: true,
    reservation_usd: reservation,
    next: {
      ...state,
      reserved_today_usd: addMoneyValue(state.reserved_today_usd, reservation),
      reserved_run_usd: addMoneyValue(state.reserved_run_usd, reservation),
    },
  }
}

export function reconcileAgentTaskReservation(input: {
  state: AgentTaskBudgetState
  reservation_usd: number
  actual_cost_usd: number
}): AgentTaskBudgetState {
  const state = validateBudgetState(input.state)
  const reservation = money(input.reservation_usd, 'reservation_usd')
  const actual = money(input.actual_cost_usd, 'actual_cost_usd')
  if (toMicros(actual) > toMicros(reservation)) throw new Error('Agent task actual_cost_usd exceeds the reserved worst-case cost')
  if (toMicros(reservation) > toMicros(state.reserved_today_usd)
    || toMicros(reservation) > toMicros(state.reserved_run_usd)) {
    throw new Error('Agent task reservation is not present in the budget state')
  }
  return {
    ...state,
    spent_today_usd: addMoneyValue(state.spent_today_usd, actual),
    reserved_today_usd: subtractMoney(state.reserved_today_usd, reservation),
    spent_run_usd: addMoneyValue(state.spent_run_usd, actual),
    reserved_run_usd: subtractMoney(state.reserved_run_usd, reservation),
  }
}

export function evaluateAgentTaskStep(input: {
  policy: AgentTaskPolicy
  completed_rounds: number
  elapsed_ms: number
  used_tokens: number
  next_max_tokens: number
}): AgentTaskStepDecision {
  integer(input.completed_rounds, 'completed_rounds')
  integer(input.elapsed_ms, 'elapsed_ms')
  integer(input.used_tokens, 'used_tokens')
  integer(input.next_max_tokens, 'next_max_tokens')
  if (input.completed_rounds >= input.policy.max_rounds) {
    return { ok: false, code: 'round_limit', detail: 'No round remains in the task policy' }
  }
  if (input.elapsed_ms >= input.policy.max_runtime_ms) {
    return { ok: false, code: 'runtime_limit', detail: 'No runtime remains in the task policy' }
  }
  if (input.used_tokens + input.next_max_tokens > input.policy.max_tokens) {
    return { ok: false, code: 'token_limit', detail: 'Next request could exceed the token budget' }
  }
  return { ok: true }
}

export function sumLocalDaySpend(
  localDay: string,
  entries: ReadonlyArray<{ local_day: string; actual_cost_usd: number; reserved_cost_usd: number }>,
): { spent_usd: number; reserved_usd: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDay)) throw new Error('Agent task localDay must be YYYY-MM-DD')
  let spent = 0
  let reserved = 0
  for (const entry of entries) {
    if (entry.local_day !== localDay) continue
    spent = addMoneyValue(spent, money(entry.actual_cost_usd, 'actual_cost_usd'))
    reserved = addMoneyValue(reserved, money(entry.reserved_cost_usd, 'reserved_cost_usd'))
  }
  return { spent_usd: spent, reserved_usd: reserved }
}

function validateBudgetState(state: AgentTaskBudgetState): AgentTaskBudgetState {
  return {
    spent_today_usd: money(state.spent_today_usd, 'spent_today_usd'),
    reserved_today_usd: money(state.reserved_today_usd, 'reserved_today_usd'),
    spent_run_usd: money(state.spent_run_usd, 'spent_run_usd'),
    reserved_run_usd: money(state.reserved_run_usd, 'reserved_run_usd'),
    daily_limit_usd: money(state.daily_limit_usd, 'daily_limit_usd'),
  }
}

function validPrice(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function integer(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Agent task ${name} must be a non-negative safe integer`)
}

function money(value: number, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > AGENT_TASK_HARD_COST_CEILING_USD) {
    throw new Error(`Agent task ${name} must be from 0 to ${AGENT_TASK_HARD_COST_CEILING_USD}`)
  }
  return fromMicros(toMicros(value))
}

function toMicros(value: number): number {
  return Math.round(value * USD_SCALE)
}

function fromMicros(value: number): number {
  return value / USD_SCALE
}

function addMoney(...values: number[]): number {
  return values.reduce((sum, value) => sum + toMicros(value), 0)
}

function addMoneyValue(...values: number[]): number {
  return fromMicros(addMoney(...values))
}

function subtractMoney(value: number, amount: number): number {
  return fromMicros(toMicros(value) - toMicros(amount))
}

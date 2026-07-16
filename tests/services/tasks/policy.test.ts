import { describe, expect, it } from 'vitest'

import { parseAgentTaskPolicy } from '../../../src/core/agentTaskPolicy'
import {
  estimateWorstCaseRequestCost,
  evaluateAgentTaskStep,
  reconcileAgentTaskReservation,
  reserveAgentTaskBudget,
  sumLocalDaySpend,
} from '../../../src/services/tasks/policy'

const policy = parseAgentTaskPolicy({
  schema_version: 1,
  route: { model_id: 'paid-model', provider_id: 'openrouter', locality: 'cloud' },
  requested_tools: [],
  database_pins: [],
  max_rounds: 3,
  max_tokens: 1_000,
  max_runtime_ms: 10_000,
  max_cost_usd: 1,
  consent_ref: 'consent-1',
})

const state = {
  spent_today_usd: 1,
  reserved_today_usd: 0,
  spent_run_usd: 0,
  reserved_run_usd: 0,
  daily_limit_usd: 5,
}

describe('agent task pricing and reservation', () => {
  it('reserves a conservative worst-case request cost to micro-dollar precision', () => {
    expect(estimateWorstCaseRequestCost({
      locality: 'cloud',
      pricing: { prompt_usd_per_million: 3, completion_usd_per_million: 15 },
      prompt_tokens: 10_000,
      max_output_tokens: 2_000,
    })).toEqual({ ok: true, cost_usd: 0.06 })
  })

  it('charges local routes zero and fails closed for unknown cloud pricing', () => {
    expect(estimateWorstCaseRequestCost({ locality: 'local', prompt_tokens: 100, max_output_tokens: 100 })).toEqual({ ok: true, cost_usd: 0 })
    expect(estimateWorstCaseRequestCost({ locality: 'cloud', prompt_tokens: 100, max_output_tokens: 100 })).toEqual({
      ok: false,
      code: 'unknown_price',
    })
  })

  it('reserves before a request and reconciles actual cost without float drift', () => {
    const reserved = reserveAgentTaskBudget({ policy, state, worst_case_cost_usd: 0.333333 })
    expect(reserved).toMatchObject({ ok: true, reservation_usd: 0.333333 })
    if (!reserved.ok) throw new Error('expected reservation')
    const reconciled = reconcileAgentTaskReservation({
      state: reserved.next,
      reservation_usd: reserved.reservation_usd,
      actual_cost_usd: 0.123456,
    })
    expect(reconciled).toEqual({
      ...state,
      spent_today_usd: 1.123456,
      reserved_today_usd: 0,
      spent_run_usd: 0.123456,
      reserved_run_usd: 0,
    })
  })

  it('blocks per-run, local-day, hard-ceiling, and missing-price reservations', () => {
    expect(reserveAgentTaskBudget({ policy, state, worst_case_cost_usd: undefined })).toMatchObject({ code: 'unknown_price' })
    expect(reserveAgentTaskBudget({ policy, state, worst_case_cost_usd: 1.01 })).toMatchObject({ code: 'run_spend_limit' })
    expect(reserveAgentTaskBudget({
      policy: { ...policy, max_cost_usd: 100 },
      state: { ...state, spent_today_usd: 4.9 },
      worst_case_cost_usd: 0.11,
    })).toMatchObject({ code: 'daily_spend_limit' })
    expect(reserveAgentTaskBudget({
      policy: { ...policy, max_cost_usd: 100 },
      state: { ...state, spent_today_usd: 99, daily_limit_usd: 100 },
      worst_case_cost_usd: 1.01,
    })).toMatchObject({ code: 'hard_spend_limit' })
  })

  it('rejects provider cost above the reserved worst case', () => {
    const reserved = reserveAgentTaskBudget({ policy, state, worst_case_cost_usd: 0.2 })
    if (!reserved.ok) throw new Error('expected reservation')
    expect(() => reconcileAgentTaskReservation({
      state: reserved.next,
      reservation_usd: 0.2,
      actual_cost_usd: 0.200001,
    })).toThrow('exceeds')
  })
})

describe('agent task execution limits and daily accounting', () => {
  it('fails before a round that could cross round, time, or token limits', () => {
    expect(evaluateAgentTaskStep({ policy, completed_rounds: 3, elapsed_ms: 0, used_tokens: 0, next_max_tokens: 1 })).toMatchObject({ code: 'round_limit' })
    expect(evaluateAgentTaskStep({ policy, completed_rounds: 0, elapsed_ms: 10_000, used_tokens: 0, next_max_tokens: 1 })).toMatchObject({ code: 'runtime_limit' })
    expect(evaluateAgentTaskStep({ policy, completed_rounds: 0, elapsed_ms: 0, used_tokens: 900, next_max_tokens: 101 })).toMatchObject({ code: 'token_limit' })
    expect(evaluateAgentTaskStep({ policy, completed_rounds: 2, elapsed_ms: 9_999, used_tokens: 900, next_max_tokens: 100 })).toEqual({ ok: true })
  })

  it('sums only the selected local day with decimal-safe accounting', () => {
    expect(sumLocalDaySpend('2026-07-16', [
      { local_day: '2026-07-16', actual_cost_usd: 0.1, reserved_cost_usd: 0.2 },
      { local_day: '2026-07-16', actual_cost_usd: 0.2, reserved_cost_usd: 0.1 },
      { local_day: '2026-07-15', actual_cost_usd: 99, reserved_cost_usd: 0 },
    ])).toEqual({ spent_usd: 0.3, reserved_usd: 0.3 })
  })
})

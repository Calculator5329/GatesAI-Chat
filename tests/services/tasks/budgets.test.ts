import { describe, expect, it } from 'vitest'

import { createAgentTaskSpec, type AgentTaskAttempt } from '../../../src/services/tasks/agentTaskSpec'
import {
  fifoPending,
  MAX_CONCURRENT_LEDGER_AGENT_TASKS,
  pendingReason,
  projectAttemptUsage,
  remainingTaskBudget,
  type AgentTaskLedgerEntry,
} from '../../../src/services/tasks/budgets'

const policy = {
  schema_version: 1, route: { model_id: 'local-model', provider_id: 'ollama', locality: 'local' },
  requested_tools: [], database_pins: [], max_rounds: 3, max_tokens: 1000,
  max_runtime_ms: 60_000, max_cost_usd: 1, consent_ref: 'consent-1',
} as const

function attempt(over: Partial<AgentTaskAttempt> = {}): AgentTaskAttempt {
  return { id: 'a', task_id: 't', number: 1, state: 'done', started_at: 1, actual_cost_usd: 0, used_tokens: 0, ...over }
}

function entry(sequence: number, attempts: AgentTaskAttempt[] = []): AgentTaskLedgerEntry {
  return {
    spec: createAgentTaskSpec({ id: `task-${sequence}`, title: 'T', instructions: 'Do it.', origin_thread_id: 'origin', created_at: 1, policy }),
    enqueue_sequence: sequence,
    state: 'pending',
    pending_reason: 'ready',
    attempts,
  }
}

describe('agent task budgets', () => {
  it('orders pending entries FIFO by enqueue sequence', () => {
    const entries = [entry(3), entry(1), entry(2)]
    expect(fifoPending(entries).map(e => e.enqueue_sequence)).toEqual([1, 2, 3])
  })

  it('reports waiting_for_slot only once the two-slot ceiling is reached', () => {
    expect(pendingReason(0)).toBe('ready')
    expect(pendingReason(MAX_CONCURRENT_LEDGER_AGENT_TASKS - 1)).toBe('ready')
    expect(pendingReason(MAX_CONCURRENT_LEDGER_AGENT_TASKS)).toBe('waiting_for_slot')
    expect(() => pendingReason(-1)).toThrow()
  })

  it('sums attempt usage in whole micro-dollars and fails on invalid data', () => {
    expect(projectAttemptUsage([attempt({ actual_cost_usd: 0.1, used_tokens: 10 }), attempt({ actual_cost_usd: 0.2, used_tokens: 5 })]))
      .toEqual({ actual_cost_usd: 0.3, used_tokens: 15 })
    expect(() => projectAttemptUsage([attempt({ actual_cost_usd: -1 })])).toThrow()
    expect(() => projectAttemptUsage([attempt({ used_tokens: -1 })])).toThrow()
  })

  it('projects remaining task budget clamped at zero', () => {
    expect(remainingTaskBudget(entry(1, [attempt({ actual_cost_usd: 0.25, used_tokens: 200 })])))
      .toEqual({ cost_usd: 0.75, tokens: 800 })
    expect(remainingTaskBudget(entry(1, [attempt({ actual_cost_usd: 5, used_tokens: 5000 })])))
      .toEqual({ cost_usd: 0, tokens: 0 })
  })
})

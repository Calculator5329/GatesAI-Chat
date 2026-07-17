import type { AgentTaskAttempt, AgentTaskSpec } from './agentTaskSpec'

export const MAX_CONCURRENT_LEDGER_AGENT_TASKS = 2

export type AgentTaskPendingReason = 'waiting_for_slot' | 'blocked_policy' | 'ready'

export interface AgentTaskLedgerEntry {
  spec: AgentTaskSpec
  enqueue_sequence: number
  state: 'pending' | 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted'
  pending_reason: AgentTaskPendingReason | null
  attempts: AgentTaskAttempt[]
}

export function fifoPending(entries: readonly AgentTaskLedgerEntry[]): AgentTaskLedgerEntry[] {
  return entries
    .filter(entry => entry.state === 'pending')
    .slice()
    .sort((left, right) => left.enqueue_sequence - right.enqueue_sequence)
}

export function pendingReason(activeCount: number): AgentTaskPendingReason {
  if (!Number.isSafeInteger(activeCount) || activeCount < 0) throw new Error('Agent task activeCount must be a non-negative integer')
  return activeCount >= MAX_CONCURRENT_LEDGER_AGENT_TASKS ? 'waiting_for_slot' : 'ready'
}

export function projectAttemptUsage(attempts: readonly AgentTaskAttempt[]): {
  actual_cost_usd: number
  used_tokens: number
} {
  let costMicros = 0
  let usedTokens = 0
  for (const attempt of attempts) {
    if (!Number.isFinite(attempt.actual_cost_usd) || attempt.actual_cost_usd < 0) throw new Error('Agent task attempt cost must be non-negative')
    if (!Number.isSafeInteger(attempt.used_tokens) || attempt.used_tokens < 0) throw new Error('Agent task attempt tokens must be non-negative')
    costMicros += Math.round(attempt.actual_cost_usd * 1_000_000)
    usedTokens += attempt.used_tokens
  }
  return { actual_cost_usd: costMicros / 1_000_000, used_tokens: usedTokens }
}

export function remainingTaskBudget(entry: AgentTaskLedgerEntry): { cost_usd: number; tokens: number } {
  const usage = projectAttemptUsage(entry.attempts)
  return {
    cost_usd: Math.max(0, Math.round((entry.spec.policy.max_cost_usd - usage.actual_cost_usd) * 1_000_000) / 1_000_000),
    tokens: Math.max(0, entry.spec.policy.max_tokens - usage.used_tokens),
  }
}

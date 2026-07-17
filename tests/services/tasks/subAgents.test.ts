import { describe, expect, it } from 'vitest'

import type { AgentTaskPolicy } from '../../../src/core/agentTaskPolicy'
import { SubAgentLedger, type SubAgentLedgerOptions } from '../../../src/services/tasks/subAgents'

function policy(over: Partial<AgentTaskPolicy> = {}): AgentTaskPolicy {
  return {
    schema_version: 1,
    route: { model_id: 'local-model', provider_id: 'ollama', locality: 'local' },
    requested_tools: ['read', 'search'],
    database_pins: [],
    max_rounds: 6,
    max_tokens: 1000,
    max_runtime_ms: 60_000,
    max_cost_usd: 1,
    consent_ref: 'consent-root',
    ...over,
  }
}

function ledger(options: SubAgentLedgerOptions = {}, rootPolicy: AgentTaskPolicy = policy()): SubAgentLedger {
  return new SubAgentLedger({
    id: 'root',
    title: 'Root delegation',
    instructions: 'Coordinate the work.',
    origin_thread_id: 'origin',
    created_at: 1,
    policy: rootPolicy,
  }, options)
}

const childInput = (over: Partial<AgentTaskPolicy> = {}) => ({
  title: 'Child work',
  instructions: 'Do a bounded slice.',
  policy: policy({ requested_tools: ['read'], max_rounds: 3, max_cost_usd: 0.5, consent_ref: 'consent-child', ...over }),
})

describe('SubAgentLedger construction', () => {
  it('seeds the root as a consented, ready, depth-0 node', () => {
    const tree = ledger()
    expect(tree.root).toMatchObject({ id: 'root', parent_id: null, depth: 0, state: 'pending', pending_reason: 'ready', consent_ref: 'consent-root' })
    expect(tree.view().root_id).toBe('root')
    expect(tree.view().caps).toEqual({ max_depth: 2, max_children: 4, max_descendants: 8 })
  })
})

describe('delegation consent rails', () => {
  it('refuses to spawn from a parent that is not running', () => {
    const tree = ledger()
    expect(tree.proposeChild('root', childInput())).toMatchObject({ ok: false, code: 'parent_not_running' })
  })

  it('parks an agent proposal as inert until the user approves it', () => {
    const tree = ledger()
    tree.startNext(10)
    const spawned = tree.proposeChild('root', childInput())
    expect(spawned).toMatchObject({ ok: true, node: { state: 'proposed', pending_reason: 'waiting_for_consent', consent_ref: null } })
    // A proposal never starts on its own.
    expect(tree.startNext(11)).toBeNull()

    const childId = spawned.ok ? spawned.node.id : ''
    expect(tree.approveChild(childId, 'consent-approve')).toBe(true)
    expect(tree.startNext(12)?.task_id).toBe(childId)
    expect(tree.nodes.find(node => node.id === childId)).toMatchObject({ state: 'running', consent_ref: 'consent-approve' })
  })

  it('lets a direct user delegation queue immediately and records rejection', () => {
    const tree = ledger()
    tree.startNext(10)
    const direct = tree.delegateChild('root', childInput(), 'consent-direct')
    expect(direct).toMatchObject({ ok: true, node: { state: 'pending', pending_reason: 'ready', consent_ref: 'consent-direct' } })

    const rejected = tree.proposeChild('root', childInput())
    const rejectedId = rejected.ok ? rejected.node.id : ''
    expect(tree.rejectChild(rejectedId, 'not-needed')).toBe(true)
    expect(tree.nodes.find(node => node.id === rejectedId)).toMatchObject({ state: 'cancelled', stop_reason: 'not-needed' })
    expect(tree.delegateChild('root', childInput(), '  ')).toMatchObject({ ok: false, code: 'invalid_policy' })
  })
})

describe('caps and authority intersection', () => {
  it('enforces the direct-child cap', () => {
    const tree = ledger({ caps: { max_depth: 2, max_children: 1, max_descendants: 8 } })
    tree.startNext(10)
    expect(tree.delegateChild('root', childInput(), 'c1')).toMatchObject({ ok: true })
    expect(tree.delegateChild('root', childInput(), 'c2')).toMatchObject({ ok: false, code: 'max_children' })
  })

  it('enforces the depth cap through a running grandchild', () => {
    const tree = ledger({ caps: { max_depth: 1, max_children: 4, max_descendants: 8 } })
    tree.startNext(10)
    const child = tree.delegateChild('root', childInput(), 'c1')
    const childId = child.ok ? child.node.id : ''
    tree.startNext(11) // start the child so it may delegate
    expect(tree.delegateChild(childId, childInput(), 'c2')).toMatchObject({ ok: false, code: 'max_depth' })
  })

  it('rejects a child requesting broader authority than the parent', () => {
    const tree = ledger()
    tree.startNext(10)
    expect(tree.delegateChild('root', childInput({ requested_tools: ['read', 'admin'] }), 'c1'))
      .toMatchObject({ ok: false, code: 'tool_not_allowed' })
  })
})

describe('scheduling, budgets, and aggregation', () => {
  it('shares the two-slot cap across the whole tree', () => {
    const tree = ledger()
    tree.startNext(10) // root running (slot 1)
    tree.delegateChild('root', childInput(), 'c1')
    tree.delegateChild('root', childInput(), 'c2')
    expect(tree.startNext(11)).not.toBeNull() // c1 running (slot 2)
    expect(tree.startNext(12)).toBeNull() // slots full
    expect(tree.view().nodes.find(node => node.pending_reason === 'waiting_for_slot')).toBeTruthy()
  })

  it('aggregates cost/tokens and rolls done child results up to the parent', () => {
    const tree = ledger()
    tree.startNext(10)
    const child = tree.delegateChild('root', childInput(), 'c1')
    const childId = child.ok ? child.node.id : ''
    tree.startNext(11)
    expect(tree.finishAttempt(childId, { state: 'done', actual_cost_usd: 0.2, used_tokens: 120, result_ref: 'artifact://child' })).toBe(true)
    expect(tree.finishAttempt('root', { state: 'done', actual_cost_usd: 0.1, used_tokens: 30, result_ref: 'artifact://root' })).toBe(true)

    expect(tree.aggregateUsage()).toEqual({ actual_cost_usd: 0.3, used_tokens: 150 })
    expect(tree.aggregateResults('root')).toEqual(['artifact://root', 'artifact://child'])
    expect(tree.view().totals).toMatchObject({ actual_cost_usd: 0.3, used_tokens: 150 })
  })

  it('fails a node closed when it overshoots its own cap', () => {
    const tree = ledger()
    tree.startNext(10)
    const child = tree.delegateChild('root', childInput({ max_cost_usd: 0.5 }), 'c1')
    const childId = child.ok ? child.node.id : ''
    tree.startNext(11)
    expect(tree.finishAttempt(childId, { state: 'done', actual_cost_usd: 0.9, used_tokens: 10 })).toBe(true)
    expect(tree.nodes.find(node => node.id === childId)).toMatchObject({ state: 'failed', stop_reason: 'budget_exceeded' })
  })

  it('stops the tree at the aggregate daily ceiling and blocks further starts', () => {
    const tree = ledger({ dailyCostCeilingUsd: 0.5 })
    tree.startNext(10)
    const child = tree.delegateChild('root', childInput({ max_cost_usd: 1 }), 'c1')
    const childId = child.ok ? child.node.id : ''
    tree.startNext(11)
    expect(tree.finishAttempt(childId, { state: 'done', actual_cost_usd: 0.8, used_tokens: 10 })).toBe(true)
    expect(tree.nodes.find(node => node.id === childId)).toMatchObject({ state: 'failed', stop_reason: 'daily_spend_limit' })

    const blocked = tree.delegateChild('root', childInput(), 'c2')
    const blockedId = blocked.ok ? blocked.node.id : ''
    expect(tree.startNext(12)).toBeNull()
    expect(tree.view().nodes.find(node => node.id === blockedId)?.pending_reason).toBe('blocked_budget')
  })

  it('rejects invalid cumulative usage', () => {
    const tree = ledger()
    tree.startNext(10)
    expect(tree.finishAttempt('root', { state: 'done', actual_cost_usd: -1, used_tokens: 1 })).toBe(false)
    expect(tree.finishAttempt('root', { state: 'done', actual_cost_usd: 0.1, used_tokens: -1 })).toBe(false)
    expect(tree.nodes[0].state).toBe('running')
  })
})

describe('cancellation and retry', () => {
  it('cascades cancellation to every descendant', () => {
    const tree = ledger()
    tree.startNext(10)
    const child = tree.delegateChild('root', childInput(), 'c1')
    const childId = child.ok ? child.node.id : ''
    tree.startNext(11)
    const grandProposal = tree.proposeChild(childId, childInput())
    const grandId = grandProposal.ok ? grandProposal.node.id : ''

    expect(tree.cancel('root')).toBe(true)
    for (const id of ['root', childId, grandId]) {
      expect(tree.nodes.find(node => node.id === id)?.state).toBe('cancelled')
    }
  })

  it('cancels only the targeted subtree', () => {
    const tree = ledger()
    tree.startNext(10)
    const a = tree.delegateChild('root', childInput(), 'ca')
    const b = tree.delegateChild('root', childInput(), 'cb')
    const aId = a.ok ? a.node.id : ''
    const bId = b.ok ? b.node.id : ''
    expect(tree.cancel(aId)).toBe(true)
    expect(tree.nodes.find(node => node.id === aId)?.state).toBe('cancelled')
    expect(tree.nodes.find(node => node.id === bId)?.state).toBe('pending')
  })

  it('links a retry to a fresh attempt without losing prior usage', () => {
    const tree = ledger()
    expect(tree.startNext(10)?.id).toBe('root:attempt:1')
    expect(tree.finishAttempt('root', { state: 'interrupted', actual_cost_usd: 0.1, used_tokens: 100, result_ref: 'artifact://partial' })).toBe(true)
    expect(tree.nodes[0].state).toBe('interrupted')
    expect(tree.retry('root')).toBe(true)
    expect(tree.startNext(11)?.id).toBe('root:attempt:2')
    expect(tree.nodes[0].attempts[0]).toMatchObject({ state: 'interrupted', actual_cost_usd: 0.1, result_ref: 'artifact://partial' })
    expect(tree.aggregateUsage().used_tokens).toBe(100)
  })
})

describe('projection', () => {
  it('exposes a frozen, progress-labelled view', () => {
    const tree = ledger()
    tree.startNext(10)
    expect(tree.reportRound('root', 2)).toBe(true)
    expect(tree.reportRound('root', 99)).toBe(false)
    const view = tree.view()
    expect(Object.isFrozen(view)).toBe(true)
    expect(Object.isFrozen(view.nodes[0])).toBe(true)
    expect(view.nodes[0].progress).toEqual({ value: 2, max: 6, label: 'Round 2 of 6' })
    expect(view.nodes[0].route).toEqual({ model_id: 'local-model', provider_id: 'ollama', locality: 'local' })
  })

  it('does not let a returned node snapshot mutate ledger authority', () => {
    const tree = ledger()
    const snapshot = tree.root
    snapshot.state = 'done'
    snapshot.attempts.push({ id: 'x', task_id: 'root', number: 9, state: 'done', started_at: 0, actual_cost_usd: 0, used_tokens: 0 })
    expect(tree.root.state).toBe('pending')
    expect(tree.root.attempts).toHaveLength(0)
  })
})

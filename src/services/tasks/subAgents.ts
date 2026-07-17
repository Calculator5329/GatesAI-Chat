// Background sub-agent tree on the unified TaskStore ledger (agentic AP-2).
//
// A running agent task may delegate bounded child agent-tasks. This module owns
// the domain logic behind that: it turns the root task's immutable policy
// snapshot and delegation caps into a live tree where
//
//   * every spawn is checked against depth / direct-child / descendant caps and
//     against the parent policy (a child grant is always a subset — see
//     core/subAgentPolicy);
//   * agent-initiated children start life as *proposals* that do nothing until
//     the user approves them, while a direct user delegation carries its own
//     launch consent;
//   * the two-slot agent concurrency cap governs the whole tree, and excess
//     ready work queues FIFO;
//   * cost/tokens are aggregated up the tree, enforced against the root budget
//     and a daily ceiling, and a run that would overshoot fails closed;
//   * cancelling a node cascades to every descendant; and
//   * a frozen projection (`view()`) reports each node's route, grants, pending
//     reason, progress, cost, and result for the task-center.
//
// It performs no model calls, reads no clock of its own, and holds no MobX
// state — the store layer drives it and mirrors the projection into the dock.

import {
  AGENT_TASK_HARD_COST_CEILING_USD,
  DEFAULT_AGENT_TASK_DAILY_COST_USD,
  parseAgentTaskPolicy,
  type AgentTaskPolicy,
  type AgentTaskRoutePin,
} from '../../core/agentTaskPolicy'
import {
  canSpawnChild,
  deriveSubAgentPolicy,
  DEFAULT_SUBAGENT_DELEGATION_CAPS,
  parseSubAgentDelegationCaps,
  type SubAgentDelegationCaps,
  type SubAgentDerivationFailureCode,
  type SubAgentSpawnRejection,
} from '../../core/subAgentPolicy'
import { createAgentTaskAttempt, createAgentTaskSpec, type AgentTaskAttempt, type AgentTaskSpec } from './agentTaskSpec'
import { MAX_CONCURRENT_LEDGER_AGENT_TASKS, projectAttemptUsage } from './budgets'

export type SubAgentNodeState =
  | 'proposed'
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

export type SubAgentPendingReason =
  | 'waiting_for_consent'
  | 'waiting_for_slot'
  | 'blocked_budget'
  | 'ready'

export interface SubAgentNode {
  id: string
  parent_id: string | null
  depth: number
  spec: AgentTaskSpec
  state: SubAgentNodeState
  pending_reason: SubAgentPendingReason | null
  enqueue_sequence: number
  /** The consent that authorized this node to run, or null while a proposal. */
  consent_ref: string | null
  /** Live round for the active attempt, mirrored into the progress projection. */
  current_round: number
  attempts: AgentTaskAttempt[]
  result_ref?: string
  stop_reason?: string
}

export interface SubAgentSpawnInput {
  title: string
  instructions: string
  /** A candidate policy; it is validated to be a strict subset of the parent. */
  policy: unknown
}

export type SubAgentSpawnFailure =
  | { code: SubAgentSpawnRejection; detail: string }
  | { code: SubAgentDerivationFailureCode; detail: string }
  | { code: 'parent_not_running' | 'parent_not_found' | 'invalid_policy'; detail: string }

export type SubAgentSpawnResult =
  | { ok: true; node: SubAgentNode }
  | { ok: false } & SubAgentSpawnFailure

export interface SubAgentAttemptOutcome {
  state: 'done' | 'failed' | 'cancelled' | 'interrupted'
  actual_cost_usd: number
  used_tokens: number
  completed_at?: number
  result_ref?: string
  stop_reason?: string
}

export interface SubAgentTreeTotals {
  actual_cost_usd: number
  used_tokens: number
  remaining_cost_usd: number
  running: number
  pending: number
  proposed: number
}

export interface SubAgentNodeView {
  id: string
  parent_id: string | null
  depth: number
  title: string
  state: SubAgentNodeState
  pending_reason: SubAgentPendingReason | null
  route: AgentTaskRoutePin
  allowed_tools: string[]
  consent_ref: string | null
  progress: { value: number; max: number; label: string }
  actual_cost_usd: number
  used_tokens: number
  attempts: number
  result_ref?: string
  stop_reason?: string
}

export interface SubAgentTreeView {
  root_id: string
  caps: SubAgentDelegationCaps
  nodes: SubAgentNodeView[]
  totals: SubAgentTreeTotals
}

export interface SubAgentLedgerOptions {
  caps?: unknown
  /** Aggregate cloud spend ceiling across the tree; defaults to the daily cap. */
  dailyCostCeilingUsd?: number
  idFactory?: (parentId: string | null, sequence: number) => string
}

/**
 * A single root agent task and its bounded delegation tree. Construct it from
 * the root's persisted spec inputs; the store keeps one ledger per root task.
 */
export class SubAgentLedger {
  private readonly caps: SubAgentDelegationCaps
  private readonly ceiling: number
  private readonly makeId: (parentId: string | null, sequence: number) => string
  private readonly order: string[] = []
  private readonly byId = new Map<string, SubAgentNode>()
  private readonly rootId: string
  private sequence = 0

  constructor(root: {
    id: string
    title: string
    instructions: string
    origin_thread_id: string
    created_at: number
    policy: unknown
  }, options: SubAgentLedgerOptions = {}) {
    this.caps = options.caps === undefined ? { ...DEFAULT_SUBAGENT_DELEGATION_CAPS } : parseSubAgentDelegationCaps(options.caps)
    this.ceiling = resolveCeiling(options.dailyCostCeilingUsd)
    this.makeId = options.idFactory ?? ((parentId, sequence) => (parentId ? `${parentId}/child-${sequence}` : root.id))

    const spec = createAgentTaskSpec(root)
    const node: SubAgentNode = {
      id: spec.id,
      parent_id: null,
      depth: 0,
      spec,
      // The root is a direct user delegation: creation carries launch consent.
      state: 'pending',
      pending_reason: 'ready',
      enqueue_sequence: this.sequence++,
      consent_ref: spec.policy.consent_ref,
      current_round: 0,
      attempts: [],
    }
    this.rootId = spec.id
    this.order.push(node.id)
    this.byId.set(node.id, node)
    this.refreshPendingReasons()
  }

  get root(): SubAgentNode {
    return this.snapshotNode(this.mustGet(this.rootId))
  }

  get nodes(): SubAgentNode[] {
    return this.order.map(id => this.snapshotNode(this.mustGet(id)))
  }

  /**
   * Agent-initiated delegation. The child is created as an inert proposal that
   * does no work until the user approves it — the design's rail against
   * unsolicited follow-on tasks.
   */
  proposeChild(parentId: string, input: SubAgentSpawnInput): SubAgentSpawnResult {
    return this.spawn(parentId, input, { consentRef: null })
  }

  /**
   * Direct user delegation. The caller supplies the explicit consent reference
   * that authorized the spawn, so the child is queued ready rather than parked
   * as a proposal.
   */
  delegateChild(parentId: string, input: SubAgentSpawnInput, consentRef: string): SubAgentSpawnResult {
    if (typeof consentRef !== 'string' || consentRef.trim() !== consentRef || consentRef.length < 1) {
      return { ok: false, code: 'invalid_policy', detail: 'A direct delegation requires an explicit consent reference' }
    }
    return this.spawn(parentId, input, { consentRef })
  }

  /** Approve a proposed child; renewed explicit consent moves it into the queue. */
  approveChild(nodeId: string, consentRef: string): boolean {
    const node = this.byId.get(nodeId)
    if (!node || node.state !== 'proposed') return false
    if (typeof consentRef !== 'string' || consentRef.trim() !== consentRef || consentRef.length < 1) return false
    node.consent_ref = consentRef
    node.state = 'pending'
    node.pending_reason = 'ready'
    this.refreshPendingReasons()
    return true
  }

  /** Reject a proposed child; it is recorded cancelled so it is not re-run. */
  rejectChild(nodeId: string, reason = 'rejected'): boolean {
    const node = this.byId.get(nodeId)
    if (!node || node.state !== 'proposed') return false
    node.state = 'cancelled'
    node.pending_reason = null
    node.stop_reason = reason
    this.refreshPendingReasons()
    return true
  }

  /**
   * Start the next ready node in FIFO order, honoring the two-slot cap and the
   * aggregate budget. Returns the new running attempt, or null if nothing may
   * start right now.
   */
  startNext(startedAt: number): AgentTaskAttempt | null {
    this.refreshPendingReasons()
    if (this.runningCount() >= MAX_CONCURRENT_LEDGER_AGENT_TASKS) return null
    if (this.remainingTreeCost() <= 0) return null
    for (const id of this.order) {
      const node = this.mustGet(id)
      if (node.state === 'pending' && node.pending_reason === 'ready') {
        const attempt = createAgentTaskAttempt(node.spec, node.attempts.length + 1, startedAt)
        node.attempts.push(attempt)
        node.state = 'running'
        node.pending_reason = null
        node.current_round = 0
        this.refreshPendingReasons()
        return { ...attempt }
      }
    }
    return null
  }

  /** A running child reports it advanced to `round` (1-based), for progress. */
  reportRound(nodeId: string, round: number): boolean {
    const node = this.byId.get(nodeId)
    if (!node || node.state !== 'running') return false
    if (!Number.isSafeInteger(round) || round < 1 || round > node.spec.policy.max_rounds) return false
    node.current_round = round
    return true
  }

  /**
   * Record the outcome of a node's active attempt. Aggregates cost/tokens and
   * fails the node closed if it overshot its own cap or the tree ceiling. A
   * 'done' outcome that fits budget becomes done; 'interrupted' stays retryable.
   */
  finishAttempt(nodeId: string, outcome: SubAgentAttemptOutcome): boolean {
    const node = this.byId.get(nodeId)
    if (!node || node.state !== 'running') return false
    const attempt = node.attempts[node.attempts.length - 1]
    if (!attempt || attempt.state !== 'running') return false
    if (!Number.isFinite(outcome.actual_cost_usd) || outcome.actual_cost_usd < 0) return false
    if (!Number.isSafeInteger(outcome.used_tokens) || outcome.used_tokens < 0) return false
    if (outcome.completed_at !== undefined && (!Number.isSafeInteger(outcome.completed_at) || outcome.completed_at < attempt.started_at)) return false

    attempt.actual_cost_usd = outcome.actual_cost_usd
    attempt.used_tokens = outcome.used_tokens
    if (outcome.completed_at !== undefined) attempt.completed_at = outcome.completed_at
    if (outcome.result_ref !== undefined) attempt.result_ref = outcome.result_ref

    const nodeCost = projectAttemptUsage(node.attempts).actual_cost_usd
    const overNodeBudget = micros(nodeCost) > micros(node.spec.policy.max_cost_usd)
    const overTreeBudget = micros(this.aggregateCost()) > micros(this.ceilingForTree())

    let finalState: SubAgentNode['state'] = outcome.state
    let stopReason = outcome.stop_reason
    if (outcome.state === 'done' && (overNodeBudget || overTreeBudget)) {
      finalState = 'failed'
      stopReason = overNodeBudget ? 'budget_exceeded' : 'daily_spend_limit'
    }

    attempt.state = finalState === 'done' ? 'done' : finalState === 'interrupted' ? 'interrupted' : finalState === 'cancelled' ? 'cancelled' : 'failed'
    if (stopReason !== undefined) attempt.stop_reason = stopReason

    node.state = finalState
    node.pending_reason = null
    node.stop_reason = stopReason
    node.current_round = 0
    if (outcome.result_ref !== undefined) node.result_ref = outcome.result_ref
    this.refreshPendingReasons()
    return true
  }

  /**
   * Cancel a node and cascade to every descendant. Proposed/pending work is
   * dropped immediately; a running node's active attempt is marked cancelled.
   * Terminal descendants keep their recorded outcome.
   */
  cancel(nodeId: string): boolean {
    const node = this.byId.get(nodeId)
    if (!node) return false
    for (const target of this.subtree(nodeId)) {
      if (isTerminal(target.state)) continue
      if (target.state === 'running') {
        const attempt = target.attempts[target.attempts.length - 1]
        if (attempt && attempt.state === 'running') {
          attempt.state = 'cancelled'
          attempt.stop_reason = 'cancelled'
        }
      }
      target.state = 'cancelled'
      target.pending_reason = null
      target.current_round = 0
      target.stop_reason = target.stop_reason ?? 'cancelled'
    }
    this.refreshPendingReasons()
    return true
  }

  /** Re-queue an interrupted or failed node as a fresh attempt linked to prior. */
  retry(nodeId: string): boolean {
    const node = this.byId.get(nodeId)
    if (!node || (node.state !== 'interrupted' && node.state !== 'failed')) return false
    node.state = 'pending'
    node.pending_reason = 'ready'
    node.stop_reason = undefined
    node.result_ref = undefined
    this.refreshPendingReasons()
    return true
  }

  /** Ordered result pointers for a node and its done descendants (parent rollup). */
  aggregateResults(nodeId: string = this.rootId): string[] {
    return this.subtree(nodeId)
      .filter(node => node.state === 'done' && node.result_ref !== undefined)
      .map(node => node.result_ref as string)
  }

  /** Cost/tokens summed across a node's subtree (defaults to the whole tree). */
  aggregateUsage(nodeId: string = this.rootId): { actual_cost_usd: number; used_tokens: number } {
    const attempts = this.subtree(nodeId).flatMap(node => node.attempts)
    return projectAttemptUsage(attempts)
  }

  view(): SubAgentTreeView {
    const totals = this.totals()
    return Object.freeze({
      root_id: this.rootId,
      caps: { ...this.caps },
      nodes: this.order.map(id => this.projectNode(this.mustGet(id))),
      totals,
    })
  }

  private spawn(parentId: string, input: SubAgentSpawnInput, options: { consentRef: string | null }): SubAgentSpawnResult {
    const parent = this.byId.get(parentId)
    if (!parent) return { ok: false, code: 'parent_not_found', detail: `No node ${parentId}` }
    if (parent.state !== 'running') {
      return { ok: false, code: 'parent_not_running', detail: 'Only a running agent task may delegate' }
    }

    const directChildren = this.order.filter(id => this.mustGet(id).parent_id === parentId).length
    const descendants = this.order.length - 1
    const spawnDecision = canSpawnChild(this.caps, parent.depth, directChildren, descendants)
    if (!spawnDecision.ok) return { ok: false, code: spawnDecision.code, detail: spawnDecision.detail }

    let candidate: AgentTaskPolicy
    try {
      candidate = parseAgentTaskPolicy(input.policy)
    } catch (error) {
      return { ok: false, code: 'invalid_policy', detail: error instanceof Error ? error.message : 'invalid policy' }
    }

    const derivation = deriveSubAgentPolicy(parent.spec.policy, candidate)
    if (!derivation.ok) return { ok: false, code: derivation.code, detail: derivation.detail }

    const sequence = this.sequence++
    const childId = this.makeId(parentId, sequence)
    if (this.byId.has(childId)) return { ok: false, code: 'invalid_policy', detail: `Duplicate node id ${childId}` }

    const spec = createAgentTaskSpec({
      id: childId,
      title: input.title,
      instructions: input.instructions,
      origin_thread_id: parent.spec.origin_thread_id,
      created_at: parent.spec.created_at,
      policy: derivation.policy,
    })
    const node: SubAgentNode = {
      id: childId,
      parent_id: parentId,
      depth: spawnDecision.child_depth,
      spec,
      state: options.consentRef ? 'pending' : 'proposed',
      pending_reason: options.consentRef ? 'ready' : 'waiting_for_consent',
      enqueue_sequence: sequence,
      consent_ref: options.consentRef,
      current_round: 0,
      attempts: [],
    }
    this.order.push(childId)
    this.byId.set(childId, node)
    this.refreshPendingReasons()
    return { ok: true, node: this.snapshotNode(node) }
  }

  private refreshPendingReasons(): void {
    const slotsFull = this.runningCount() >= MAX_CONCURRENT_LEDGER_AGENT_TASKS
    const budgetGone = this.remainingTreeCost() <= 0
    for (const id of this.order) {
      const node = this.mustGet(id)
      if (node.state === 'proposed') {
        node.pending_reason = 'waiting_for_consent'
        continue
      }
      if (node.state !== 'pending') {
        if (isTerminal(node.state) || node.state === 'running') node.pending_reason = null
        continue
      }
      node.pending_reason = budgetGone ? 'blocked_budget' : slotsFull ? 'waiting_for_slot' : 'ready'
    }
  }

  private runningCount(): number {
    let count = 0
    for (const id of this.order) if (this.mustGet(id).state === 'running') count++
    return count
  }

  private aggregateCost(): number {
    return this.aggregateUsage().actual_cost_usd
  }

  private ceilingForTree(): number {
    return Math.min(this.mustGet(this.rootId).spec.policy.max_cost_usd, this.ceiling)
  }

  private remainingTreeCost(): number {
    return Math.round((this.ceilingForTree() - this.aggregateCost()) * 1_000_000) / 1_000_000
  }

  private totals(): SubAgentTreeTotals {
    const usage = this.aggregateUsage()
    let running = 0
    let pending = 0
    let proposed = 0
    for (const id of this.order) {
      const node = this.mustGet(id)
      if (node.state === 'running') running++
      else if (node.state === 'pending') pending++
      else if (node.state === 'proposed') proposed++
    }
    return {
      actual_cost_usd: usage.actual_cost_usd,
      used_tokens: usage.used_tokens,
      remaining_cost_usd: Math.max(0, this.remainingTreeCost()),
      running,
      pending,
      proposed,
    }
  }

  private subtree(nodeId: string): SubAgentNode[] {
    const root = this.byId.get(nodeId)
    if (!root) return []
    const collected: SubAgentNode[] = []
    const stack = [nodeId]
    const seen = new Set<string>()
    while (stack.length > 0) {
      const current = stack.pop() as string
      if (seen.has(current)) continue
      seen.add(current)
      const node = this.byId.get(current)
      if (!node) continue
      collected.push(node)
      for (const id of this.order) {
        if (this.mustGet(id).parent_id === current) stack.push(id)
      }
    }
    return collected
  }

  private projectNode(node: SubAgentNode): SubAgentNodeView {
    const usage = projectAttemptUsage(node.attempts)
    const round = node.state === 'running' ? node.current_round : node.state === 'done' ? node.spec.policy.max_rounds : node.current_round
    return Object.freeze({
      id: node.id,
      parent_id: node.parent_id,
      depth: node.depth,
      title: node.spec.title,
      state: node.state,
      pending_reason: node.pending_reason,
      route: { ...node.spec.policy.route },
      allowed_tools: [...node.spec.policy.requested_tools],
      consent_ref: node.consent_ref,
      progress: { value: round, max: node.spec.policy.max_rounds, label: `Round ${round} of ${node.spec.policy.max_rounds}` },
      actual_cost_usd: usage.actual_cost_usd,
      used_tokens: usage.used_tokens,
      attempts: node.attempts.length,
      result_ref: node.result_ref,
      stop_reason: node.stop_reason,
    }) as SubAgentNodeView
  }

  private snapshotNode(node: SubAgentNode): SubAgentNode {
    return {
      ...node,
      spec: node.spec,
      attempts: node.attempts.map(attempt => ({ ...attempt })),
    }
  }

  private mustGet(id: string): SubAgentNode {
    const node = this.byId.get(id)
    if (!node) throw new Error(`Sub-agent ledger missing node ${id}`)
    return node
  }
}

function resolveCeiling(value: number | undefined): number {
  if (value === undefined) return DEFAULT_AGENT_TASK_DAILY_COST_USD
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > AGENT_TASK_HARD_COST_CEILING_USD) {
    throw new Error(`Sub-agent daily cost ceiling must be a finite number from 0 to ${AGENT_TASK_HARD_COST_CEILING_USD}`)
  }
  return value
}

function isTerminal(state: SubAgentNodeState): boolean {
  return state === 'done' || state === 'failed' || state === 'cancelled' || state === 'interrupted'
}

function micros(value: number): number {
  return Math.round(value * 1_000_000)
}

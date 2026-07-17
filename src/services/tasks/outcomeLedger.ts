// Live self-improvement journal for the agentic platform (Story AP-4).
//
// The core `agentOutcomes` module owns the pure record/proposal/applied-lesson
// schemas, redaction, delimiting, and deterministic metrics. This service
// composes those into the durable, user-drivable loop that the store layer
// mirrors into the UI:
//
//   observe  → an agent task ends, so its attempt is folded into a local
//              `OutcomeRecord` beside the schedule/task ledgers — no model call,
//              no secret, no raw plugin row leaves this journal;
//   assess   → deterministic signals (completion, retry, cancel, tool errors,
//              budget stop, explicit feedback) are available immediately; an
//              optional evaluator only ever supplies proposed lesson *text*;
//   propose  → a scoped, evidence-linked `LessonProposal` is created but never
//              applied on its own; a rejected proposal's signature is remembered
//              so it is not surfaced again;
//   approve  → retrieval lessons may be accepted individually (or under an
//              explicit low-risk auto-accept policy); prompt/skill patches always
//              require an explicit human accept — this ledger refuses to
//              auto-accept them;
//   apply    → future same-kind task assembly retrieves a bounded set of
//              accepted, enabled lessons as one clearly-labeled, delimited
//              context block; every applied version is inspectable, disable-able,
//              and roll-back-able, and a negative/unsafe outcome fails closed by
//              auto-disabling the implicated lessons and flagging them for review.
//
// It reads no clock (timestamps arrive from the driver), makes no model calls,
// and holds no MobX state. Everything serializes to a snapshot so the journal
// and its accepted lessons survive an app restart; restore re-validates every
// record because persisted data is untrusted.

import type { AgentTaskAttempt, AgentTaskSpec } from './agentTaskSpec'
import {
  createLessonProposal,
  createOutcomeRecord,
  DEFAULT_LESSON_RETRIEVAL_LIMIT,
  lessonSignature,
  renderLessonContextBlock,
  scopeMatches,
  summarizeOutcomes,
  withFeedback,
  type AppliedLesson,
  type LessonProposal,
  type LessonProposalInput,
  type LessonScope,
  type OutcomeFeedbackRating,
  type OutcomeRecord,
  type OutcomeRecordInput,
  type OutcomeSummary,
} from '../../core/agentOutcomes'

export const OUTCOME_LEDGER_SNAPSHOT_VERSION = 1 as const

/** Keep the journal bounded; oldest outcomes prune first past this count. */
export const DEFAULT_OUTCOME_RETENTION = 1_000

/** Ratings that, when a user applies them, fail the loop closed. */
const AUTO_DISABLE_RATINGS = new Set<OutcomeFeedbackRating>(['unsafe', 'wrong'])

export interface OutcomeLedgerSnapshot {
  schema_version: typeof OUTCOME_LEDGER_SNAPSHOT_VERSION
  outcomes: OutcomeRecord[]
  proposals: LessonProposal[]
  applied: AppliedLesson[]
  rejected_signatures: string[]
  needs_review: string[]
  sequence: number
}

export interface OutcomeLedgerOptions {
  /** Max outcome records retained; defaults to {@link DEFAULT_OUTCOME_RETENTION}. */
  retention?: number
}

export type LessonMutationResult =
  | { ok: true; lesson: AppliedLesson }
  | { ok: false; code: LessonMutationFailure; detail: string }

export type LessonMutationFailure =
  | 'not_found'
  | 'invalid_input'
  | 'already_reviewed'
  | 'requires_manual_accept'
  | 'duplicate_rejected'
  | 'not_applied'

export interface RegressionAssessment {
  scope: LessonScope
  proposal_id: string
  before: OutcomeSummary
  after: OutcomeSummary
  /** True when the post-apply success rate fell below the pre-apply rate. */
  regressed: boolean
}

/**
 * The durable self-improvement journal. Construct empty and drive it, or rebuild
 * one from a persisted snapshot with {@link OutcomeLedger.restore}.
 */
export class OutcomeLedger {
  private readonly outcomes: OutcomeRecord[] = []
  private readonly outcomeIndex = new Map<string, number>()
  private readonly proposals = new Map<string, LessonProposal>()
  private readonly proposalOrder: string[] = []
  private readonly applied = new Map<string, AppliedLesson>()
  private readonly appliedOrder: string[] = []
  private readonly rejectedSignatures = new Set<string>()
  private readonly needsReview = new Set<string>()
  private readonly retention: number
  private sequence = 0

  constructor(options: OutcomeLedgerOptions = {}) {
    this.retention = resolveRetention(options.retention)
  }

  // -- observe -------------------------------------------------------------

  /** Append a validated, redacted outcome record. Duplicate ids replace in place. */
  ingest(input: OutcomeRecordInput): OutcomeRecord {
    const record = createOutcomeRecord(input)
    const existing = this.outcomeIndex.get(record.id)
    if (existing !== undefined) {
      this.outcomes[existing] = record
    } else {
      this.outcomeIndex.set(record.id, this.outcomes.length)
      this.outcomes.push(record)
      this.prune()
    }
    return record
  }

  /**
   * Fold a finished agent-task attempt into an outcome record. The task type is
   * supplied by the caller (schedule id, classification, or the origin kind);
   * everything else is derived from the immutable spec and attempt so the
   * journal cannot disagree with the run's own ledger.
   */
  ingestAttempt(spec: AgentTaskSpec, attempt: AgentTaskAttempt, extra: {
    task_type: string
    created_at: number
    tool_summary?: { success?: number; failure?: number; errors?: string[] }
    versions?: OutcomeRecordInput['versions']
  }): OutcomeRecord {
    if (attempt.task_id !== spec.id) throw new Error('Outcome ledger attempt does not belong to the given spec')
    if (attempt.state === 'running') throw new Error('Outcome ledger cannot ingest a still-running attempt')
    const completedAt = attempt.completed_at ?? extra.created_at
    const versions: OutcomeRecordInput['versions'] = extra.versions ?? {
      database_versions: spec.policy.database_pins.map(pin => ({ plugin_id: pin.plugin_id, version: pin.version })),
    }
    return this.ingest({
      id: `${attempt.id}:outcome`,
      task_id: spec.id,
      attempt_id: attempt.id,
      task_type: extra.task_type,
      policy_hash: spec.policy_snapshot,
      route: { ...spec.policy.route },
      versions,
      timing: { started_at: attempt.started_at, completed_at: completedAt },
      usage: { used_tokens: attempt.used_tokens, cost_usd: attempt.actual_cost_usd },
      tool_summary: extra.tool_summary,
      terminal_state: attempt.state,
      stop_reason: attempt.stop_reason,
      result_ref: attempt.result_ref,
      created_at: extra.created_at,
    })
  }

  /**
   * Attach or replace a user's feedback on an outcome. A negative/unsafe rating
   * fails closed: every enabled lesson implicated by that outcome's scopes is
   * auto-disabled and flagged for review. Returns the ids of disabled lessons.
   */
  recordFeedback(outcomeId: string, feedback: { rating: OutcomeFeedbackRating; note?: string; at: number }): {
    ok: boolean
    disabled: string[]
  } {
    const index = this.outcomeIndex.get(outcomeId)
    if (index === undefined) return { ok: false, disabled: [] }
    const updated = withFeedback(this.outcomes[index], feedback)
    this.outcomes[index] = updated

    const disabled: string[] = []
    if (AUTO_DISABLE_RATINGS.has(feedback.rating)) {
      const scopes = outcomeScopes(updated)
      for (const id of this.appliedOrder) {
        const lesson = this.applied.get(id)
        if (!lesson || !lesson.enabled) continue
        if (scopes.some(scope => scopeMatches(scope, lesson.scope))) {
          this.applied.set(id, { ...lesson, enabled: false })
          this.needsReview.add(id)
          disabled.push(id)
        }
      }
    }
    return { ok: true, disabled }
  }

  outcome(id: string): OutcomeRecord | null {
    const index = this.outcomeIndex.get(id)
    return index === undefined ? null : clone(this.outcomes[index])
  }

  allOutcomes(): OutcomeRecord[] {
    return this.outcomes.map(clone)
  }

  /** Deterministic aggregate over the outcomes matching a scope (all if omitted). */
  summarize(scope?: LessonScope): OutcomeSummary {
    const records = scope ? this.outcomes.filter(record => outcomeScopes(record).some(s => scopeMatches(s, scope))) : this.outcomes
    return summarizeOutcomes(records)
  }

  // -- propose -------------------------------------------------------------

  /**
   * Create a scoped, evidence-linked lesson proposal. Every referenced outcome
   * must already be in the journal, and a proposal whose signature was already
   * rejected is refused so the user is not asked the same thing twice.
   */
  propose(input: LessonProposalInput): { ok: true; proposal: LessonProposal } | { ok: false; code: LessonMutationFailure; detail: string } {
    let proposal: LessonProposal
    try {
      proposal = createLessonProposal(input)
    } catch (error) {
      return { ok: false, code: 'invalid_input', detail: message(error) }
    }
    if (this.proposals.has(proposal.id)) return { ok: false, code: 'invalid_input', detail: `Duplicate proposal id ${proposal.id}` }
    const missing = proposal.evidence_outcome_ids.find(id => !this.outcomeIndex.has(id))
    if (missing !== undefined) return { ok: false, code: 'invalid_input', detail: `Evidence outcome ${missing} is not in the journal` }
    if (this.rejectedSignatures.has(lessonSignature(proposal))) return { ok: false, code: 'duplicate_rejected', detail: 'An equivalent lesson was already rejected' }

    this.proposals.set(proposal.id, proposal)
    this.proposalOrder.push(proposal.id)
    return { ok: true, proposal: clone(proposal) }
  }

  proposal(id: string): LessonProposal | null {
    const found = this.proposals.get(id)
    return found ? clone(found) : null
  }

  allProposals(): LessonProposal[] {
    return this.proposalOrder.map(id => clone(this.proposals.get(id) as LessonProposal))
  }

  pendingProposals(): LessonProposal[] {
    return this.allProposals().filter(proposal => proposal.status === 'proposed')
  }

  // -- approve -------------------------------------------------------------

  /**
   * Accept a proposal and activate it as an applied lesson. Retrieval lessons may
   * auto-accept under an explicit low-risk policy; prompt/skill patches never
   * can and must pass `{ manual: true }`. Accepting a patch for a target that is
   * already applied supersedes it (disabling the old one) so activation is a
   * reversible pointer change.
   */
  accept(proposalId: string, options: { at: number; autoAccept?: boolean; manual?: boolean } = { at: 0 }): LessonMutationResult {
    const proposal = this.proposals.get(proposalId)
    if (!proposal) return { ok: false, code: 'not_found', detail: `No proposal ${proposalId}` }
    if (proposal.status !== 'proposed') return { ok: false, code: 'already_reviewed', detail: `Proposal ${proposalId} is already ${proposal.status}` }
    if (!Number.isSafeInteger(options.at) || options.at < 0) return { ok: false, code: 'invalid_input', detail: 'accept requires a non-negative timestamp' }
    if (proposal.kind !== 'retrieval' && options.manual !== true) {
      return { ok: false, code: 'requires_manual_accept', detail: 'Prompt/skill patches require an explicit manual accept with a diff review' }
    }
    // Note: `autoAccept` is only honored for retrieval lessons; patches always
    // require the explicit manual accept enforced above.

    const superseded = proposal.kind === 'retrieval' ? undefined : this.activePatchFor(proposal)
    const version = this.nextVersion(proposal.scope, proposal.kind)
    const lesson: AppliedLesson = {
      proposal_id: proposal.id,
      scope: { ...proposal.scope },
      kind: proposal.kind,
      version,
      enabled: true,
      text: proposal.text,
      applied_at: options.at,
      ...(superseded ? { supersedes: superseded.proposal_id } : {}),
    }
    if (superseded) this.applied.set(superseded.proposal_id, { ...superseded, enabled: false })

    this.proposals.set(proposalId, { ...proposal, status: 'accepted', reviewed_at: options.at })
    this.applied.set(lesson.proposal_id, lesson)
    this.appliedOrder.push(lesson.proposal_id)
    return { ok: true, lesson: clone(lesson) }
  }

  /**
   * Reject a proposal and remember its signature so an equivalent lesson is not
   * proposed again.
   */
  reject(proposalId: string, at: number): { ok: boolean; code?: LessonMutationFailure } {
    const proposal = this.proposals.get(proposalId)
    if (!proposal) return { ok: false, code: 'not_found' }
    if (proposal.status !== 'proposed') return { ok: false, code: 'already_reviewed' }
    this.proposals.set(proposalId, { ...proposal, status: 'rejected', reviewed_at: at })
    this.rejectedSignatures.add(lessonSignature(proposal))
    return { ok: true }
  }

  // -- apply / retrieve ----------------------------------------------------

  appliedLesson(proposalId: string): AppliedLesson | null {
    const found = this.applied.get(proposalId)
    return found ? clone(found) : null
  }

  allApplied(): AppliedLesson[] {
    return this.appliedOrder.map(id => clone(this.applied.get(id) as AppliedLesson))
  }

  /** Applied lessons currently enabled and eligible for retrieval. */
  activeLessons(): AppliedLesson[] {
    return this.allApplied().filter(lesson => lesson.enabled)
  }

  /**
   * Retrieve the bounded set of accepted, enabled lessons matching any of the
   * given scopes, most-recently-applied first. This is the read side of "apply":
   * feed the result to {@link renderLessonContextBlock} for prompt assembly.
   */
  retrieve(scopes: LessonScope | readonly LessonScope[], limit = DEFAULT_LESSON_RETRIEVAL_LIMIT): AppliedLesson[] {
    const queries: readonly LessonScope[] = Array.isArray(scopes) ? scopes : [scopes]
    const bound = Number.isSafeInteger(limit) && limit > 0 ? limit : DEFAULT_LESSON_RETRIEVAL_LIMIT
    const matched = this.appliedOrder
      .map(id => this.applied.get(id) as AppliedLesson)
      .filter(lesson => lesson.enabled && queries.some(query => scopeMatches(lesson.scope, query)))
    matched.sort((left, right) => right.applied_at - left.applied_at || right.version - left.version)
    return matched.slice(0, bound).map(clone)
  }

  /** Render a retrieval directly as a labeled, delimited prompt context block. */
  retrieveContextBlock(scopes: LessonScope | readonly LessonScope[], limit = DEFAULT_LESSON_RETRIEVAL_LIMIT): string {
    return renderLessonContextBlock(this.retrieve(scopes, limit))
  }

  /** Disable an applied lesson: it leaves active retrieval immediately. */
  disable(proposalId: string): LessonMutationResult {
    const lesson = this.applied.get(proposalId)
    if (!lesson) return { ok: false, code: 'not_applied', detail: `No applied lesson ${proposalId}` }
    const next = { ...lesson, enabled: false }
    this.applied.set(proposalId, next)
    return { ok: true, lesson: clone(next) }
  }

  /** Re-enable a previously disabled applied lesson. */
  enable(proposalId: string): LessonMutationResult {
    const lesson = this.applied.get(proposalId)
    if (!lesson) return { ok: false, code: 'not_applied', detail: `No applied lesson ${proposalId}` }
    const next = { ...lesson, enabled: true }
    this.applied.set(proposalId, next)
    this.needsReview.delete(proposalId)
    return { ok: true, lesson: clone(next) }
  }

  /**
   * Roll a lesson back: disable it and, when it superseded a prior version,
   * re-enable that predecessor so the previous behavior is restored.
   */
  rollback(proposalId: string): { ok: true; disabled: AppliedLesson; restored?: AppliedLesson } | { ok: false; code: LessonMutationFailure; detail: string } {
    const lesson = this.applied.get(proposalId)
    if (!lesson) return { ok: false, code: 'not_applied', detail: `No applied lesson ${proposalId}` }
    const disabled = { ...lesson, enabled: false }
    this.applied.set(proposalId, disabled)
    let restored: AppliedLesson | undefined
    if (lesson.supersedes && this.applied.has(lesson.supersedes)) {
      const predecessor = this.applied.get(lesson.supersedes) as AppliedLesson
      restored = { ...predecessor, enabled: true }
      this.applied.set(lesson.supersedes, restored)
      this.needsReview.delete(lesson.supersedes)
    }
    return { ok: true, disabled: clone(disabled), ...(restored ? { restored: clone(restored) } : {}) }
  }

  /** Applied-lesson ids flagged for review by a negative/unsafe outcome. */
  reviewQueue(): string[] {
    return [...this.needsReview]
  }

  // -- measure -------------------------------------------------------------

  /**
   * Compare outcomes for a lesson's scope before and after it was applied. A drop
   * in success rate is a regression the UI should surface as a rollback prompt.
   */
  assessRegression(proposalId: string): RegressionAssessment | null {
    const lesson = this.applied.get(proposalId)
    if (!lesson) return null
    const scoped = this.outcomes.filter(record => outcomeScopes(record).some(scope => scopeMatches(scope, lesson.scope)))
    const before = scoped.filter(record => record.created_at < lesson.applied_at)
    const after = scoped.filter(record => record.created_at >= lesson.applied_at)
    const beforeSummary = summarizeOutcomes(before)
    const afterSummary = summarizeOutcomes(after)
    const regressed = before.length > 0 && after.length > 0
      && (afterSummary.success_rate < beforeSummary.success_rate || afterSummary.unsafe > 0)
    return { scope: { ...lesson.scope }, proposal_id: proposalId, before: beforeSummary, after: afterSummary, regressed }
  }

  // -- data management -----------------------------------------------------

  /** Export the whole journal; already-redacted, so no secrets leave here. */
  export(): OutcomeLedgerSnapshot {
    return this.snapshot()
  }

  /** Forget every applied lesson and proposal, keeping the outcome journal. */
  clearLessons(): void {
    this.proposals.clear()
    this.proposalOrder.length = 0
    this.applied.clear()
    this.appliedOrder.length = 0
    this.rejectedSignatures.clear()
    this.needsReview.clear()
  }

  /** Clear the entire journal, including outcomes. */
  clearAll(): void {
    this.clearLessons()
    this.outcomes.length = 0
    this.outcomeIndex.clear()
    this.sequence = 0
  }

  // -- persistence ---------------------------------------------------------

  snapshot(): OutcomeLedgerSnapshot {
    return {
      schema_version: OUTCOME_LEDGER_SNAPSHOT_VERSION,
      outcomes: this.outcomes.map(clone),
      proposals: this.proposalOrder.map(id => clone(this.proposals.get(id) as LessonProposal)),
      applied: this.appliedOrder.map(id => clone(this.applied.get(id) as AppliedLesson)),
      rejected_signatures: [...this.rejectedSignatures],
      needs_review: [...this.needsReview],
      sequence: this.sequence,
    }
  }

  static restore(snapshot: unknown, options: OutcomeLedgerOptions = {}): OutcomeLedger {
    const parsed = asRecord(snapshot, 'snapshot')
    if (parsed.schema_version !== OUTCOME_LEDGER_SNAPSHOT_VERSION) throw new Error('Outcome ledger snapshot must be version 1')
    const ledger = new OutcomeLedger(options)

    if (!Array.isArray(parsed.outcomes)) throw new Error('Outcome ledger snapshot outcomes must be an array')
    for (const raw of parsed.outcomes) ledger.ingest(restoreOutcomeInput(raw))

    if (!Array.isArray(parsed.proposals)) throw new Error('Outcome ledger snapshot proposals must be an array')
    for (const raw of parsed.proposals) {
      const restored = restoreProposal(raw)
      ledger.proposals.set(restored.id, restored)
      ledger.proposalOrder.push(restored.id)
    }

    if (!Array.isArray(parsed.applied)) throw new Error('Outcome ledger snapshot applied must be an array')
    for (const raw of parsed.applied) {
      const restored = restoreApplied(raw, ledger.proposals)
      ledger.applied.set(restored.proposal_id, restored)
      ledger.appliedOrder.push(restored.proposal_id)
    }

    if (Array.isArray(parsed.rejected_signatures)) {
      for (const sig of parsed.rejected_signatures) if (typeof sig === 'string') ledger.rejectedSignatures.add(sig)
    }
    if (Array.isArray(parsed.needs_review)) {
      for (const id of parsed.needs_review) if (typeof id === 'string' && ledger.applied.has(id)) ledger.needsReview.add(id)
    }
    if (Number.isSafeInteger(parsed.sequence) && (parsed.sequence as number) >= 0) ledger.sequence = parsed.sequence as number
    return ledger
  }

  // -- internals -----------------------------------------------------------

  private prune(): void {
    if (this.outcomes.length <= this.retention) return
    this.outcomes.splice(0, this.outcomes.length - this.retention)
    // Removing from the front shifts every position; rebuild the index.
    this.outcomeIndex.clear()
    this.outcomes.forEach((record, index) => this.outcomeIndex.set(record.id, index))
  }

  private nextVersion(scope: LessonScope, kind: LessonProposal['kind']): number {
    let max = 0
    for (const id of this.appliedOrder) {
      const lesson = this.applied.get(id)
      if (lesson && lesson.kind === kind && scopeMatches(lesson.scope, scope)) max = Math.max(max, lesson.version)
    }
    return max + 1
  }

  private activePatchFor(proposal: LessonProposal): AppliedLesson | undefined {
    const target = proposal.candidate_patch?.target
    if (target === undefined) return undefined
    for (const id of [...this.appliedOrder].reverse()) {
      const lesson = this.applied.get(id)
      if (!lesson || !lesson.enabled || lesson.kind !== proposal.kind) continue
      const applied = this.proposals.get(lesson.proposal_id)
      if (applied?.candidate_patch?.target === target) return lesson
    }
    return undefined
  }
}

// -- scope derivation --------------------------------------------------------

/** Every scope an outcome belongs to; used for retrieval, summary, auto-disable. */
export function outcomeScopes(record: OutcomeRecord): LessonScope[] {
  const scopes: LessonScope[] = [
    { kind: 'task_type', value: record.task_type },
    { kind: 'model_id', value: record.route.model_id },
  ]
  if (record.versions.skill_id) scopes.push({ kind: 'skill_id', value: record.versions.skill_id })
  for (const pin of record.versions.database_versions) scopes.push({ kind: 'plugin_id', value: pin.plugin_id })
  return scopes
}

// -- restore helpers ---------------------------------------------------------

function restoreOutcomeInput(value: unknown): OutcomeRecordInput {
  const raw = asRecord(value, 'snapshot.outcomes[]')
  const timing = asRecord(raw.timing, 'snapshot.outcomes[].timing')
  return {
    id: str(raw.id),
    task_id: str(raw.task_id),
    attempt_id: str(raw.attempt_id),
    task_type: str(raw.task_type),
    policy_hash: str(raw.policy_hash),
    route: raw.route as OutcomeRecordInput['route'],
    versions: raw.versions as OutcomeRecordInput['versions'],
    timing: { started_at: num(timing.started_at), completed_at: num(timing.completed_at) },
    usage: raw.usage as OutcomeRecordInput['usage'],
    tool_summary: raw.tool_summary as OutcomeRecordInput['tool_summary'],
    terminal_state: raw.terminal_state as OutcomeRecordInput['terminal_state'],
    stop_reason: raw.stop_reason as string | undefined,
    result_ref: raw.result_ref as string | undefined,
    feedback: raw.feedback as OutcomeRecordInput['feedback'],
    created_at: num(raw.created_at),
  }
}

function restoreProposal(value: unknown): LessonProposal {
  const raw = asRecord(value, 'snapshot.proposals[]')
  // Reconstruct through the validating constructor, then re-apply review state.
  const base = createLessonProposal({
    id: str(raw.id),
    scope: raw.scope as LessonScope,
    evidence_outcome_ids: raw.evidence_outcome_ids as string[],
    text: str(raw.text),
    kind: raw.kind as LessonProposal['kind'],
    confidence: num(raw.confidence),
    candidate_patch: raw.candidate_patch as LessonProposal['candidate_patch'],
    expires_at: raw.expires_at as number | undefined,
    created_at: num(raw.created_at),
  })
  const status = raw.status as LessonProposal['status']
  const next: LessonProposal = { ...base, status }
  if (raw.reviewed_at !== undefined) next.reviewed_at = num(raw.reviewed_at)
  return next
}

function restoreApplied(value: unknown, proposals: Map<string, LessonProposal>): AppliedLesson {
  const raw = asRecord(value, 'snapshot.applied[]')
  const proposalId = str(raw.proposal_id)
  if (!proposals.has(proposalId)) throw new Error(`Outcome ledger applied lesson ${proposalId} has no proposal`)
  const lesson: AppliedLesson = {
    proposal_id: proposalId,
    scope: raw.scope as LessonScope,
    kind: raw.kind as AppliedLesson['kind'],
    version: num(raw.version),
    enabled: raw.enabled === true,
    text: str(raw.text),
    applied_at: num(raw.applied_at),
  }
  if (raw.supersedes !== undefined) lesson.supersedes = str(raw.supersedes)
  return lesson
}

// -- small utilities ---------------------------------------------------------

function resolveRetention(value: number | undefined): number {
  if (value === undefined) return DEFAULT_OUTCOME_RETENTION
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Outcome ledger retention must be a positive integer')
  return value
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`Outcome ledger ${path} must be an object`)
  return value as Record<string, unknown>
}

function str(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Outcome ledger snapshot expected a string')
  return value
}

function num(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Outcome ledger snapshot expected a number')
  return value
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

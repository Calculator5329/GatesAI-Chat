export const AGENT_OUTCOME_SCHEMA_VERSION = 1 as const
export const LESSON_PROPOSAL_SCHEMA_VERSION = 1 as const
export const APPLIED_LESSON_SCHEMA_VERSION = 1 as const

export type AgentOutcomeTerminalState =
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'budget_stopped'
  | 'interrupted'

export type AgentOutcomeFeedbackRating = 'useful' | 'wrong' | 'incomplete' | 'unsafe'
export type LessonKind = 'retrieval_memory' | 'prompt_patch' | 'skill_patch'
export type LessonProposalStatus = 'proposed' | 'accepted' | 'rejected' | 'archived'
export type LessonScopeKind = 'task_type' | 'skill_id' | 'model_id' | 'plugin_id'

export interface LessonScope {
  kind: LessonScopeKind
  value: string
}

export interface AgentOutcomeRecord {
  schema_version: typeof AGENT_OUTCOME_SCHEMA_VERSION
  id: string
  task_id: string
  attempt_id: string
  policy_hash: string
  route: {
    model_id: string
    provider_id: string
    locality: 'local' | 'cloud'
  }
  versions: {
    skill?: { id: string; version: string }
    database_plugins: Array<{ id: string; version: string; data_policy: 'local_only' | 'cloud_allowed' }>
  }
  timing: {
    started_at: string
    ended_at: string
    duration_ms: number
  }
  usage: {
    input_tokens: number
    output_tokens: number
    cost_usd: number
  }
  tool_summary: Array<{
    name: string
    success_count: number
    failure_count: number
  }>
  terminal_state: AgentOutcomeTerminalState
  result_ref: string
  feedback?: {
    rating: AgentOutcomeFeedbackRating
    reason?: string
    redactions: number
  }
  created_at: string
}

export interface LessonProposal {
  schema_version: typeof LESSON_PROPOSAL_SCHEMA_VERSION
  id: string
  scope: LessonScope
  evidence_outcome_ids: string[]
  text: string
  kind: LessonKind
  confidence: number
  status: LessonProposalStatus
  candidate_patch?: {
    target_id: string
    base_version: string
    unified_diff: string
  }
  created_at: string
  review_by: string
  reviewed_at?: string
}

export interface AppliedLesson {
  schema_version: typeof APPLIED_LESSON_SCHEMA_VERSION
  proposal_id: string
  scope: LessonScope
  version: number
  enabled: boolean
  approval: {
    kind: 'user' | 'low_risk_policy'
    ref: string
  }
  applied_at: string
  supersedes?: { proposal_id: string; version: number }
  disabled_reason?: 'user_disabled' | 'negative_outcome' | 'unsafe_outcome' | 'superseded' | 'archived'
}

export interface AgentOutcomeMetrics {
  total: number
  terminal: Record<AgentOutcomeTerminalState, number>
  completion_rate: number
  retry_attempts: number
  total_input_tokens: number
  total_output_tokens: number
  total_cost_usd: number
  average_duration_ms: number
  tool_successes: number
  tool_failures: number
  feedback: Record<AgentOutcomeFeedbackRating, number>
  outcomes_needing_review: number
  review_signals: number
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const SHA256 = /^sha256:[a-f0-9]{64}$/
const RESULT_REF = /^task-result:\/\/[A-Za-z0-9][A-Za-z0-9._:@/-]*$/

const SECRET_PATTERNS: RegExp[] = [
  /\b(?:sk[-_]|ghp_|github_pat_)[A-Za-z0-9_-]{16,}\b/gi,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*\b/gi,
  /\b(?:api[_ -]?key|password|secret|access[_ -]?token)\s*[:=]\s*[^\s,;]{4,}/gi,
  /\b\d{3}-\d{2}-\d{4}\b/g,
  /\b(?:\d[ -]*?){13,19}\b/g,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
]

const SENSITIVE_LESSON_MARKERS = [
  /\b(?:social security|ssn|account number|routing number|credit card|debit card)\b/i,
  /\b(?:diagnosis|medical condition|prescription|patient|health record)\b/i,
  /\b(?:password|api key|access token|private key|secret key|credential)\b/i,
]

export function parseAgentOutcomeRecord(value: unknown): AgentOutcomeRecord {
  const input = record(value, 'outcome')
  exactKeys(input, [
    'schema_version', 'id', 'task_id', 'attempt_id', 'policy_hash', 'route',
    'versions', 'timing', 'usage', 'tool_summary', 'terminal_state', 'result_ref',
    'feedback', 'created_at',
  ], 'outcome')
  if (input.schema_version !== AGENT_OUTCOME_SCHEMA_VERSION) fail('outcome.schema_version', 'must be exactly 1')

  const timing = parseTiming(input.timing)
  const createdAt = timestamp(input.created_at, 'outcome.created_at')
  if (Date.parse(createdAt) < Date.parse(timing.ended_at)) fail('outcome.created_at', 'must not precede timing.ended_at')

  return {
    schema_version: AGENT_OUTCOME_SCHEMA_VERSION,
    id: identifier(input.id, 'outcome.id'),
    task_id: identifier(input.task_id, 'outcome.task_id'),
    attempt_id: identifier(input.attempt_id, 'outcome.attempt_id'),
    policy_hash: hash(input.policy_hash, 'outcome.policy_hash'),
    route: parseRoute(input.route),
    versions: parseVersions(input.versions),
    timing,
    usage: parseUsage(input.usage),
    tool_summary: uniqueArray(input.tool_summary, 'outcome.tool_summary', parseToolSummary, item => item.name, 100),
    terminal_state: oneOf(input.terminal_state, ['done', 'failed', 'cancelled', 'budget_stopped', 'interrupted'], 'outcome.terminal_state'),
    result_ref: resultRef(input.result_ref, 'outcome.result_ref'),
    ...(input.feedback === undefined ? {} : { feedback: parseFeedback(input.feedback) }),
    created_at: createdAt,
  }
}

export function parseLessonProposal(value: unknown): LessonProposal {
  const input = record(value, 'proposal')
  exactKeys(input, [
    'schema_version', 'id', 'scope', 'evidence_outcome_ids', 'text', 'kind',
    'confidence', 'status', 'candidate_patch', 'created_at', 'review_by',
    'reviewed_at',
  ], 'proposal')
  if (input.schema_version !== LESSON_PROPOSAL_SCHEMA_VERSION) fail('proposal.schema_version', 'must be exactly 1')

  const kind = oneOf(input.kind, ['retrieval_memory', 'prompt_patch', 'skill_patch'], 'proposal.kind')
  const status = oneOf(input.status, ['proposed', 'accepted', 'rejected', 'archived'], 'proposal.status')
  const createdAt = timestamp(input.created_at, 'proposal.created_at')
  const reviewBy = timestamp(input.review_by, 'proposal.review_by')
  if (Date.parse(reviewBy) <= Date.parse(createdAt)) fail('proposal.review_by', 'must be after created_at')
  const reviewedAt = input.reviewed_at === undefined ? undefined : timestamp(input.reviewed_at, 'proposal.reviewed_at')
  if (status === 'proposed' && reviewedAt !== undefined) fail('proposal.reviewed_at', 'must be absent while proposed')
  if (status !== 'proposed' && reviewedAt === undefined) fail('proposal.reviewed_at', 'is required after review')

  const lessonText = safeLessonText(input.text, 'proposal.text', 2_000)
  const candidatePatch = input.candidate_patch === undefined ? undefined : parseCandidatePatch(input.candidate_patch)
  if (kind === 'retrieval_memory' && candidatePatch) fail('proposal.candidate_patch', 'is not allowed for retrieval memory')
  if (kind !== 'retrieval_memory' && !candidatePatch) fail('proposal.candidate_patch', 'is required for prompt or skill patches')

  return {
    schema_version: LESSON_PROPOSAL_SCHEMA_VERSION,
    id: identifier(input.id, 'proposal.id'),
    scope: parseScope(input.scope, 'proposal.scope'),
    evidence_outcome_ids: uniqueArray(input.evidence_outcome_ids, 'proposal.evidence_outcome_ids', identifier, value => value, 20, 1),
    text: lessonText,
    kind,
    confidence: boundedNumber(input.confidence, 'proposal.confidence', 0, 1),
    status,
    ...(candidatePatch ? { candidate_patch: candidatePatch } : {}),
    created_at: createdAt,
    review_by: reviewBy,
    ...(reviewedAt ? { reviewed_at: reviewedAt } : {}),
  }
}

export function parseAppliedLesson(value: unknown): AppliedLesson {
  const input = record(value, 'applied_lesson')
  exactKeys(input, [
    'schema_version', 'proposal_id', 'scope', 'version', 'enabled', 'approval',
    'applied_at', 'supersedes', 'disabled_reason',
  ], 'applied_lesson')
  if (input.schema_version !== APPLIED_LESSON_SCHEMA_VERSION) fail('applied_lesson.schema_version', 'must be exactly 1')
  if (typeof input.enabled !== 'boolean') fail('applied_lesson.enabled', 'must be a boolean')

  const approval = parseApproval(input.approval)
  const disabledReason = input.disabled_reason === undefined
    ? undefined
    : oneOf(input.disabled_reason, ['user_disabled', 'negative_outcome', 'unsafe_outcome', 'superseded', 'archived'], 'applied_lesson.disabled_reason')
  if (input.enabled && disabledReason) fail('applied_lesson.disabled_reason', 'must be absent while enabled')
  if (!input.enabled && !disabledReason) fail('applied_lesson.disabled_reason', 'is required while disabled')

  return {
    schema_version: APPLIED_LESSON_SCHEMA_VERSION,
    proposal_id: identifier(input.proposal_id, 'applied_lesson.proposal_id'),
    scope: parseScope(input.scope, 'applied_lesson.scope'),
    version: boundedInteger(input.version, 'applied_lesson.version', 1, 1_000_000),
    enabled: input.enabled,
    approval,
    applied_at: timestamp(input.applied_at, 'applied_lesson.applied_at'),
    ...(input.supersedes === undefined ? {} : { supersedes: parseSupersedes(input.supersedes) }),
    ...(disabledReason ? { disabled_reason: disabledReason } : {}),
  }
}

export function assertLessonApprovalAllowed(proposal: LessonProposal, lesson: AppliedLesson): void {
  if (proposal.id !== lesson.proposal_id) fail('applied_lesson.proposal_id', 'must match the proposal')
  if (proposal.scope.kind !== lesson.scope.kind || proposal.scope.value !== lesson.scope.value) {
    fail('applied_lesson.scope', 'must exactly match the proposal scope')
  }
  if (proposal.status !== 'accepted') fail('proposal.status', 'must be accepted before application')
  if (proposal.kind !== 'retrieval_memory' && lesson.approval.kind !== 'user') {
    fail('applied_lesson.approval.kind', 'prompt and skill patches require user approval')
  }
}

export function redactOutcomeText(value: string): { text: string; redactions: number } {
  let redactions = 0
  let text = value
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, () => {
      redactions += 1
      return '[REDACTED]'
    })
  }
  return { text, redactions }
}

export function summarizeAgentOutcomes(records: readonly AgentOutcomeRecord[]): AgentOutcomeMetrics {
  const terminal: AgentOutcomeMetrics['terminal'] = {
    done: 0,
    failed: 0,
    cancelled: 0,
    budget_stopped: 0,
    interrupted: 0,
  }
  const feedback: AgentOutcomeMetrics['feedback'] = { useful: 0, wrong: 0, incomplete: 0, unsafe: 0 }
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let totalCostUsd = 0
  let totalDurationMs = 0
  let toolSuccesses = 0
  let toolFailures = 0
  let outcomesNeedingReview = 0
  const taskAttempts = new Map<string, number>()
  const outcomeIds = new Set<string>()
  const attemptIds = new Set<string>()

  for (const outcome of records) {
    if (outcomeIds.has(outcome.id)) fail('metrics.records', `contains duplicate outcome ${outcome.id}`)
    outcomeIds.add(outcome.id)
    const attemptIdentity = JSON.stringify([outcome.task_id, outcome.attempt_id])
    if (attemptIds.has(attemptIdentity)) fail('metrics.records', `contains duplicate attempt ${attemptIdentity}`)
    attemptIds.add(attemptIdentity)
    terminal[outcome.terminal_state] += 1
    totalInputTokens += outcome.usage.input_tokens
    totalOutputTokens += outcome.usage.output_tokens
    totalCostUsd += outcome.usage.cost_usd
    totalDurationMs += outcome.timing.duration_ms
    taskAttempts.set(outcome.task_id, (taskAttempts.get(outcome.task_id) ?? 0) + 1)
    for (const tool of outcome.tool_summary) {
      toolSuccesses += tool.success_count
      toolFailures += tool.failure_count
    }
    if (outcome.feedback) feedback[outcome.feedback.rating] += 1
    const negativeFeedback = outcome.feedback
      && outcome.feedback.rating !== 'useful'
    if (outcome.terminal_state === 'failed'
      || outcome.terminal_state === 'budget_stopped'
      || negativeFeedback) {
      outcomesNeedingReview += 1
    }
  }

  const total = records.length
  const retryAttempts = Array.from(taskAttempts.values()).reduce((sum, attempts) => sum + Math.max(0, attempts - 1), 0)
  return {
    total,
    terminal,
    completion_rate: total === 0 ? 0 : terminal.done / total,
    retry_attempts: retryAttempts,
    total_input_tokens: totalInputTokens,
    total_output_tokens: totalOutputTokens,
    total_cost_usd: Number(totalCostUsd.toFixed(6)),
    average_duration_ms: total === 0 ? 0 : Math.round(totalDurationMs / total),
    tool_successes: toolSuccesses,
    tool_failures: toolFailures,
    feedback,
    outcomes_needing_review: outcomesNeedingReview,
    review_signals: terminal.failed + terminal.budget_stopped + feedback.wrong + feedback.incomplete + feedback.unsafe,
  }
}

function parseRoute(value: unknown): AgentOutcomeRecord['route'] {
  const input = record(value, 'outcome.route')
  exactKeys(input, ['model_id', 'provider_id', 'locality'], 'outcome.route')
  return {
    model_id: identifier(input.model_id, 'outcome.route.model_id'),
    provider_id: identifier(input.provider_id, 'outcome.route.provider_id'),
    locality: oneOf(input.locality, ['local', 'cloud'], 'outcome.route.locality'),
  }
}

function parseVersions(value: unknown): AgentOutcomeRecord['versions'] {
  const input = record(value, 'outcome.versions')
  exactKeys(input, ['skill', 'database_plugins'], 'outcome.versions')
  const skill = input.skill === undefined ? undefined : parseVersionPin(input.skill, 'outcome.versions.skill')
  const databasePlugins = uniqueArray(input.database_plugins, 'outcome.versions.database_plugins', (entry, path) => {
    const pin = record(entry, path)
    exactKeys(pin, ['id', 'version', 'data_policy'], path)
    return {
      id: identifier(pin.id, `${path}.id`),
      version: semver(pin.version, `${path}.version`),
      data_policy: oneOf(pin.data_policy, ['local_only', 'cloud_allowed'], `${path}.data_policy`),
    }
  }, pin => `${pin.id}@${pin.version}`, 20)
  return { ...(skill ? { skill } : {}), database_plugins: databasePlugins }
}

function parseVersionPin(value: unknown, path: string): { id: string; version: string } {
  const input = record(value, path)
  exactKeys(input, ['id', 'version'], path)
  return { id: identifier(input.id, `${path}.id`), version: semver(input.version, `${path}.version`) }
}

function parseTiming(value: unknown): AgentOutcomeRecord['timing'] {
  const input = record(value, 'outcome.timing')
  exactKeys(input, ['started_at', 'ended_at', 'duration_ms'], 'outcome.timing')
  const startedAt = timestamp(input.started_at, 'outcome.timing.started_at')
  const endedAt = timestamp(input.ended_at, 'outcome.timing.ended_at')
  const durationMs = boundedInteger(input.duration_ms, 'outcome.timing.duration_ms', 0, 7 * 24 * 60 * 60 * 1_000)
  const observed = Date.parse(endedAt) - Date.parse(startedAt)
  if (observed < 0 || observed !== durationMs) fail('outcome.timing.duration_ms', 'must exactly match started_at and ended_at')
  return { started_at: startedAt, ended_at: endedAt, duration_ms: durationMs }
}

function parseUsage(value: unknown): AgentOutcomeRecord['usage'] {
  const input = record(value, 'outcome.usage')
  exactKeys(input, ['input_tokens', 'output_tokens', 'cost_usd'], 'outcome.usage')
  return {
    input_tokens: boundedInteger(input.input_tokens, 'outcome.usage.input_tokens', 0, 100_000_000),
    output_tokens: boundedInteger(input.output_tokens, 'outcome.usage.output_tokens', 0, 100_000_000),
    cost_usd: boundedNumber(input.cost_usd, 'outcome.usage.cost_usd', 0, 100),
  }
}

function parseToolSummary(value: unknown, path: string): AgentOutcomeRecord['tool_summary'][number] {
  const input = record(value, path)
  exactKeys(input, ['name', 'success_count', 'failure_count'], path)
  return {
    name: identifier(input.name, `${path}.name`),
    success_count: boundedInteger(input.success_count, `${path}.success_count`, 0, 1_000_000),
    failure_count: boundedInteger(input.failure_count, `${path}.failure_count`, 0, 1_000_000),
  }
}

function parseFeedback(value: unknown): NonNullable<AgentOutcomeRecord['feedback']> {
  const input = record(value, 'outcome.feedback')
  exactKeys(input, ['rating', 'reason'], 'outcome.feedback')
  const rating = oneOf(input.rating, ['useful', 'wrong', 'incomplete', 'unsafe'], 'outcome.feedback.rating')
  if (input.reason === undefined) return { rating, redactions: 0 }
  const rawReason = text(input.reason, 'outcome.feedback.reason', 1, 1_000)
  const redacted = redactOutcomeText(rawReason)
  return { rating, reason: redacted.text, redactions: redacted.redactions }
}

function parseScope(value: unknown, path: string): LessonScope {
  const input = record(value, path)
  exactKeys(input, ['kind', 'value'], path)
  return {
    kind: oneOf(input.kind, ['task_type', 'skill_id', 'model_id', 'plugin_id'], `${path}.kind`),
    value: identifier(input.value, `${path}.value`),
  }
}

function parseCandidatePatch(value: unknown): NonNullable<LessonProposal['candidate_patch']> {
  const input = record(value, 'proposal.candidate_patch')
  exactKeys(input, ['target_id', 'base_version', 'unified_diff'], 'proposal.candidate_patch')
  return {
    target_id: identifier(input.target_id, 'proposal.candidate_patch.target_id'),
    base_version: semver(input.base_version, 'proposal.candidate_patch.base_version'),
    unified_diff: safeLessonText(input.unified_diff, 'proposal.candidate_patch.unified_diff', 20_000),
  }
}

function parseApproval(value: unknown): AppliedLesson['approval'] {
  const input = record(value, 'applied_lesson.approval')
  exactKeys(input, ['kind', 'ref'], 'applied_lesson.approval')
  return {
    kind: oneOf(input.kind, ['user', 'low_risk_policy'], 'applied_lesson.approval.kind'),
    ref: identifier(input.ref, 'applied_lesson.approval.ref'),
  }
}

function parseSupersedes(value: unknown): NonNullable<AppliedLesson['supersedes']> {
  const input = record(value, 'applied_lesson.supersedes')
  exactKeys(input, ['proposal_id', 'version'], 'applied_lesson.supersedes')
  return {
    proposal_id: identifier(input.proposal_id, 'applied_lesson.supersedes.proposal_id'),
    version: boundedInteger(input.version, 'applied_lesson.supersedes.version', 1, 1_000_000),
  }
}

function safeLessonText(value: unknown, path: string, max: number): string {
  const parsed = text(value, path, 1, max)
  if (SECRET_PATTERNS.some(pattern => {
    pattern.lastIndex = 0
    return pattern.test(parsed)
  }) || SENSITIVE_LESSON_MARKERS.some(pattern => pattern.test(parsed))) {
    fail(path, 'must not contain credentials or sensitive identity, health, or finance data')
  }
  return parsed
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'must be an object')
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const unexpected = Object.keys(value).find(key => !allowed.includes(key))
  if (unexpected) fail(`${path}.${unexpected}`, 'is not allowed by schema 1')
}

function text(value: unknown, path: string, min: number, max: number): string {
  if (typeof value !== 'string' || value.length < min || value.length > max || value.trim() !== value) {
    fail(path, `must be a trimmed string from ${min} to ${max} characters`)
  }
  return value
}

function identifier(value: unknown, path: string): string {
  const parsed = text(value, path, 1, 200)
  if (!IDENTIFIER.test(parsed)) fail(path, 'must be a stable identifier')
  return parsed
}

function semver(value: unknown, path: string): string {
  const parsed = text(value, path, 5, 100)
  if (!SEMVER.test(parsed)) fail(path, 'must be semantic version x.y.z')
  return parsed
}

function hash(value: unknown, path: string): string {
  const parsed = text(value, path, 71, 71)
  if (!SHA256.test(parsed)) fail(path, 'must be a lowercase SHA-256 digest')
  return parsed
}

function resultRef(value: unknown, path: string): string {
  const parsed = text(value, path, 15, 500)
  if (!RESULT_REF.test(parsed) || parsed.includes('..')) fail(path, 'must be an opaque task-result reference')
  return parsed
}

function timestamp(value: unknown, path: string): string {
  const parsed = text(value, path, 20, 64)
  const time = Date.parse(parsed)
  if (!Number.isFinite(time) || !parsed.endsWith('Z')) fail(path, 'must be a UTC ISO date-time')
  return parsed
}

function boundedInteger(value: unknown, path: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) fail(path, `must be an integer from ${min} to ${max}`)
  return value as number
}

function boundedNumber(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(path, `must be a finite number from ${min} to ${max}`)
  return value
}

function oneOf<const T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail(path, `must be one of: ${allowed.join(', ')}`)
  return value as T
}

function uniqueArray<T>(
  value: unknown,
  path: string,
  parse: (entry: unknown, path: string) => T,
  key: (entry: T) => string,
  max: number,
  min = 0,
): T[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(path, `must contain from ${min} to ${max} entries`)
  const parsed = value.map((entry, index) => parse(entry, `${path}[${index}]`))
  const seen = new Set<string>()
  for (const item of parsed) {
    const identity = key(item)
    if (seen.has(identity)) fail(path, `contains duplicate ${identity}`)
    seen.add(identity)
  }
  return parsed
}

function fail(path: string, message: string): never {
  throw new Error(`Agent outcome ${path} ${message}`)
}

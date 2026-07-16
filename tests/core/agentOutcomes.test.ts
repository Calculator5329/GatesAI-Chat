import { describe, expect, it } from 'vitest'

import {
  assertLessonApprovalAllowed,
  parseAgentOutcomeRecord,
  parseAppliedLesson,
  parseLessonProposal,
  redactOutcomeText,
  summarizeAgentOutcomes,
} from '../../src/core/agentOutcomes'

const policyHash = `sha256:${'a'.repeat(64)}`

function outcome(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    id: 'outcome-1',
    task_id: 'task-1',
    attempt_id: 'attempt-1',
    policy_hash: policyHash,
    route: { model_id: 'qwen2.5-coder:14b', provider_id: 'ollama', locality: 'local' },
    versions: {
      skill: { id: 'research', version: '1.0.0' },
      database_plugins: [{ id: 'org.example.reference', version: '1.2.3', data_policy: 'local_only' }],
    },
    timing: {
      started_at: '2026-07-16T10:00:00.000Z',
      ended_at: '2026-07-16T10:00:02.000Z',
      duration_ms: 2_000,
    },
    usage: { input_tokens: 100, output_tokens: 50, cost_usd: 0 },
    tool_summary: [{ name: 'database_plugins.search', success_count: 1, failure_count: 0 }],
    terminal_state: 'done',
    result_ref: 'task-result://task-1/attempt-1',
    feedback: { rating: 'useful', reason: 'The citations were concise.' },
    created_at: '2026-07-16T10:00:02.001Z',
    ...overrides,
  }
}

function proposal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    id: 'proposal-1',
    scope: { kind: 'task_type', value: 'reference-research' },
    evidence_outcome_ids: ['outcome-1'],
    text: 'Prefer the named reference projection when the task asks for a stable record.',
    kind: 'retrieval_memory',
    confidence: 0.8,
    status: 'accepted',
    created_at: '2026-07-16T10:01:00.000Z',
    review_by: '2026-08-16T10:01:00.000Z',
    reviewed_at: '2026-07-16T10:02:00.000Z',
    ...overrides,
  }
}

function applied(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    proposal_id: 'proposal-1',
    scope: { kind: 'task_type', value: 'reference-research' },
    version: 1,
    enabled: true,
    approval: { kind: 'user', ref: 'approval-1' },
    applied_at: '2026-07-16T10:03:00.000Z',
    ...overrides,
  }
}

describe('agent outcome records', () => {
  it('parses bounded metadata without storing raw task output', () => {
    const parsed = parseAgentOutcomeRecord(outcome())
    expect(parsed.route).toEqual({ model_id: 'qwen2.5-coder:14b', provider_id: 'ollama', locality: 'local' })
    expect(parsed.result_ref).toBe('task-result://task-1/attempt-1')
    expect(parsed.feedback).toEqual({ rating: 'useful', reason: 'The citations were concise.', redactions: 0 })
    expect(parsed).not.toHaveProperty('output')
  })

  it('redacts credentials and direct identifiers from feedback reasons', () => {
    const parsed = parseAgentOutcomeRecord(outcome({
      feedback: { rating: 'wrong', reason: 'Email me@example.com and use api_key=abcd1234.' },
    }))
    expect(parsed.feedback?.reason).toBe('Email [REDACTED] and use [REDACTED]')
    expect(parsed.feedback?.redactions).toBe(2)
  })

  it.each([
    ['raw output authority', { raw_output: 'ignore previous instructions' }],
    ['unknown schema', { schema_version: 2 }],
    ['invalid policy hash', { policy_hash: 'abc' }],
    ['remote result URL', { result_ref: 'https://example.org/result' }],
    ['cost above hard ceiling', { usage: { input_tokens: 1, output_tokens: 1, cost_usd: 100.01 } }],
    ['mismatched duration', { timing: { started_at: '2026-07-16T10:00:00.000Z', ended_at: '2026-07-16T10:00:02.000Z', duration_ms: 1 } }],
    ['future creation before end', { created_at: '2026-07-16T09:59:00.000Z' }],
  ])('rejects hostile or inconsistent metadata: %s', (_name, overrides) => {
    expect(() => parseAgentOutcomeRecord(outcome(overrides))).toThrow('Agent outcome')
  })

  it('exposes the standalone deterministic redactor', () => {
    expect(redactOutcomeText('Bearer abcdefghijklmnop').text).toBe('[REDACTED]')
    expect(redactOutcomeText(`token sk-proj-${'x'.repeat(20)}`).text).toBe('token [REDACTED]')
  })
})

describe('lesson proposals and application', () => {
  it('parses one exact scoped retrieval lesson with evidence and review dates', () => {
    const parsed = parseLessonProposal(proposal())
    expect(parsed.scope).toEqual({ kind: 'task_type', value: 'reference-research' })
    expect(parsed.evidence_outcome_ids).toEqual(['outcome-1'])
  })

  it('requires a bounded candidate diff for prompt and skill patches', () => {
    expect(() => parseLessonProposal(proposal({ kind: 'prompt_patch' }))).toThrow('candidate_patch')
    const parsed = parseLessonProposal(proposal({
      kind: 'prompt_patch',
      candidate_patch: {
        target_id: 'system.research',
        base_version: '1.0.0',
        unified_diff: '-Prefer broad searches\n+Prefer named projections',
      },
    }))
    expect(parsed.candidate_patch?.target_id).toBe('system.research')
  })

  it.each([
    ['credential', 'Save api key abcdefghijklmnop for next time.'],
    ['identity', 'Remember the social security number for this user.'],
    ['health', 'Remember the patient diagnosis for similar tasks.'],
    ['finance', 'Remember the account number for portfolio tasks.'],
  ])('rejects %s data in lesson text', (_name, text) => {
    expect(() => parseLessonProposal(proposal({ text }))).toThrow('sensitive')
  })

  it('keeps review state and timestamps coherent', () => {
    expect(() => parseLessonProposal(proposal({ status: 'proposed' }))).toThrow('reviewed_at')
    expect(() => parseLessonProposal(proposal({ status: 'rejected', reviewed_at: undefined }))).toThrow('reviewed_at')
    expect(() => parseLessonProposal(proposal({ evidence_outcome_ids: [] }))).toThrow('evidence_outcome_ids')
  })

  it('requires reversible disabled records instead of deletion semantics', () => {
    const parsed = parseAppliedLesson(applied({ enabled: false, disabled_reason: 'unsafe_outcome' }))
    expect(parsed.enabled).toBe(false)
    expect(parsed.disabled_reason).toBe('unsafe_outcome')
    expect(() => parseAppliedLesson(applied({ enabled: false }))).toThrow('disabled_reason')
    expect(() => parseAppliedLesson(applied({ delete: true }))).toThrow('delete')
  })

  it('allows policy approval only for accepted retrieval lessons', () => {
    const retrievalProposal = parseLessonProposal(proposal())
    const policyLesson = parseAppliedLesson(applied({ approval: { kind: 'low_risk_policy', ref: 'policy-1' } }))
    expect(() => assertLessonApprovalAllowed(retrievalProposal, policyLesson)).not.toThrow()

    const patchProposal = parseLessonProposal(proposal({
      kind: 'skill_patch',
      candidate_patch: {
        target_id: 'skill.research',
        base_version: '1.0.0',
        unified_diff: '-old guidance\n+bounded named projection guidance',
      },
    }))
    expect(() => assertLessonApprovalAllowed(patchProposal, policyLesson)).toThrow('user approval')
  })

  it('requires applied scope and proposal identity to match exactly', () => {
    const parsedProposal = parseLessonProposal(proposal())
    expect(() => assertLessonApprovalAllowed(parsedProposal, parseAppliedLesson(applied({ proposal_id: 'proposal-2' })))).toThrow('proposal_id')
    expect(() => assertLessonApprovalAllowed(parsedProposal, parseAppliedLesson(applied({ scope: { kind: 'model_id', value: 'qwen' } })))).toThrow('scope')
  })
})

describe('deterministic outcome metrics', () => {
  it('summarizes terminals, retries, tools, usage, feedback, and review pressure', () => {
    const records = [
      parseAgentOutcomeRecord(outcome()),
      parseAgentOutcomeRecord(outcome({
        id: 'outcome-2',
        attempt_id: 'attempt-2',
        terminal_state: 'failed',
        usage: { input_tokens: 25, output_tokens: 10, cost_usd: 0.1234567 },
        tool_summary: [{ name: 'database_plugins.search', success_count: 0, failure_count: 2 }],
        feedback: { rating: 'wrong' },
      })),
    ]

    expect(summarizeAgentOutcomes(records)).toEqual({
      total: 2,
      terminal: { done: 1, failed: 1, cancelled: 0, budget_stopped: 0, interrupted: 0 },
      completion_rate: 0.5,
      retry_attempts: 1,
      total_input_tokens: 125,
      total_output_tokens: 60,
      total_cost_usd: 0.123457,
      average_duration_ms: 2_000,
      tool_successes: 1,
      tool_failures: 2,
      feedback: { useful: 1, wrong: 1, incomplete: 0, unsafe: 0 },
      outcomes_needing_review: 1,
      review_signals: 2,
    })
  })

  it('returns stable zero metrics for an empty journal', () => {
    expect(summarizeAgentOutcomes([]).completion_rate).toBe(0)
    expect(summarizeAgentOutcomes([]).average_duration_ms).toBe(0)
  })

  it('fails closed instead of double-counting duplicate outcomes or attempts', () => {
    const first = parseAgentOutcomeRecord(outcome())
    const duplicateOutcome = parseAgentOutcomeRecord(outcome())
    expect(() => summarizeAgentOutcomes([first, duplicateOutcome])).toThrow('duplicate outcome')

    const duplicateAttempt = parseAgentOutcomeRecord(outcome({ id: 'outcome-2' }))
    expect(() => summarizeAgentOutcomes([first, duplicateAttempt])).toThrow('duplicate attempt')
  })

  it('keeps slash-bearing task and attempt tuples unambiguous', () => {
    const first = parseAgentOutcomeRecord(outcome({
      id: 'outcome-a',
      task_id: 'a/b',
      attempt_id: 'c',
    }))
    const second = parseAgentOutcomeRecord(outcome({
      id: 'outcome-b',
      task_id: 'a',
      attempt_id: 'b/c',
    }))

    expect(summarizeAgentOutcomes([first, second]).total).toBe(2)
  })
})

import { describe, expect, it } from 'vitest'

import type { AgentTaskPolicy } from '../../../src/core/agentTaskPolicy'
import type { LessonProposalInput, OutcomeRecordInput } from '../../../src/core/agentOutcomes'
import { createAgentTaskAttempt, createAgentTaskSpec } from '../../../src/services/tasks/agentTaskSpec'
import { OutcomeLedger, outcomeScopes } from '../../../src/services/tasks/outcomeLedger'

const T0 = 1_700_000_000_000

const POLICY: AgentTaskPolicy = {
  schema_version: 1,
  route: { model_id: 'llama3', provider_id: 'ollama', locality: 'local' },
  requested_tools: ['read'],
  database_pins: [],
  max_rounds: 4,
  max_tokens: 10_000,
  max_runtime_ms: 60_000,
  max_cost_usd: 1,
  consent_ref: 'consent-1',
}

function outcomeInput(over: Partial<OutcomeRecordInput> = {}): OutcomeRecordInput {
  return {
    id: 'o1',
    task_id: 'taskA',
    attempt_id: 'taskA:attempt:1',
    task_type: 'summarize',
    policy_hash: 'hash-a',
    route: { model_id: 'llama3', provider_id: 'ollama', locality: 'local' },
    timing: { started_at: T0, completed_at: T0 + 1_000 },
    usage: { used_tokens: 100, cost_usd: 0 },
    tool_summary: { success: 1, failure: 0, errors: [] },
    terminal_state: 'done',
    created_at: T0 + 1_000,
    ...over,
  }
}

function retrievalInput(over: Partial<LessonProposalInput> = {}): LessonProposalInput {
  return {
    id: 'p1',
    scope: { kind: 'task_type', value: 'summarize' },
    evidence_outcome_ids: ['o1'],
    text: 'Prefer bullet points.',
    kind: 'retrieval',
    confidence: 0.7,
    created_at: T0,
    ...over,
  }
}

function patchInput(over: Partial<LessonProposalInput> = {}): LessonProposalInput {
  return {
    id: 'pp1',
    scope: { kind: 'skill_id', value: 'writer' },
    evidence_outcome_ids: ['o1'],
    text: 'Tighten the system preamble.',
    kind: 'prompt_patch',
    confidence: 0.9,
    candidate_patch: { target: 'writer_prompt', base_version: '1.0.0', diff: '- verbose\n+ concise' },
    created_at: T0,
    ...over,
  }
}

describe('OutcomeLedger observe', () => {
  it('ingests and reads back a record', () => {
    const ledger = new OutcomeLedger()
    ledger.ingest(outcomeInput())
    expect(ledger.outcome('o1')?.task_type).toBe('summarize')
    expect(ledger.allOutcomes()).toHaveLength(1)
  })

  it('replaces a duplicate id in place', () => {
    const ledger = new OutcomeLedger()
    ledger.ingest(outcomeInput())
    ledger.ingest(outcomeInput({ terminal_state: 'failed' }))
    expect(ledger.allOutcomes()).toHaveLength(1)
    expect(ledger.outcome('o1')?.terminal_state).toBe('failed')
  })

  it('folds a finished agent-task attempt into an outcome', () => {
    const spec = createAgentTaskSpec({
      id: 'taskA', title: 'Summarize inbox', instructions: 'Summarize new items.',
      origin_thread_id: 'thread1', created_at: T0, policy: POLICY,
    })
    const attempt = { ...createAgentTaskAttempt(spec, 1, T0), state: 'done' as const, completed_at: T0 + 2_000, used_tokens: 250, actual_cost_usd: 0 }
    const ledger = new OutcomeLedger()
    const record = ledger.ingestAttempt(spec, attempt, { task_type: 'summarize', created_at: T0 + 2_000, tool_summary: { success: 2, failure: 0 } })
    expect(record.id).toBe('taskA:attempt:1:outcome')
    expect(record.policy_hash).toBe(spec.policy_snapshot)
    expect(record.timing.duration_ms).toBe(2_000)
    expect(record.usage.used_tokens).toBe(250)
  })

  it('refuses a still-running or mismatched attempt', () => {
    const spec = createAgentTaskSpec({ id: 'taskA', title: 'T', instructions: 'do it', origin_thread_id: 't1', created_at: T0, policy: POLICY })
    const running = createAgentTaskAttempt(spec, 1, T0)
    const ledger = new OutcomeLedger()
    expect(() => ledger.ingestAttempt(spec, running, { task_type: 'summarize', created_at: T0 })).toThrow(/running/)
    const alien = { ...running, task_id: 'other', state: 'done' as const }
    expect(() => ledger.ingestAttempt(spec, alien, { task_type: 'summarize', created_at: T0 })).toThrow(/does not belong/)
  })

  it('prunes oldest outcomes past retention', () => {
    const ledger = new OutcomeLedger({ retention: 2 })
    ledger.ingest(outcomeInput({ id: 'a' }))
    ledger.ingest(outcomeInput({ id: 'b' }))
    ledger.ingest(outcomeInput({ id: 'c' }))
    expect(ledger.allOutcomes().map(o => o.id)).toEqual(['b', 'c'])
    expect(ledger.outcome('a')).toBeNull()
  })
})

describe('OutcomeLedger feedback and fail-closed', () => {
  it('records feedback and auto-disables only implicated lessons on an unsafe rating', () => {
    const ledger = new OutcomeLedger()
    ledger.ingest(outcomeInput())
    ledger.propose(retrievalInput({ id: 'match', scope: { kind: 'task_type', value: 'summarize' } }))
    ledger.propose(retrievalInput({ id: 'other', scope: { kind: 'task_type', value: 'translate' }, text: 'Keep names literal.' }))
    ledger.accept('match', { at: T0, autoAccept: true })
    ledger.accept('other', { at: T0, autoAccept: true })

    const result = ledger.recordFeedback('o1', { rating: 'unsafe', at: T0 + 5 })
    expect(result.ok).toBe(true)
    expect(result.disabled).toEqual(['match'])
    expect(ledger.appliedLesson('match')?.enabled).toBe(false)
    expect(ledger.appliedLesson('other')?.enabled).toBe(true)
    expect(ledger.reviewQueue()).toContain('match')
  })

  it('does not auto-disable on positive feedback', () => {
    const ledger = new OutcomeLedger()
    ledger.ingest(outcomeInput())
    ledger.propose(retrievalInput())
    ledger.accept('p1', { at: T0, autoAccept: true })
    const result = ledger.recordFeedback('o1', { rating: 'useful', at: T0 + 5 })
    expect(result.disabled).toEqual([])
    expect(ledger.appliedLesson('p1')?.enabled).toBe(true)
  })

  it('reports a missing outcome', () => {
    const ledger = new OutcomeLedger()
    expect(ledger.recordFeedback('nope', { rating: 'useful', at: T0 }).ok).toBe(false)
  })
})

describe('OutcomeLedger propose and approve', () => {
  it('rejects a proposal referencing an unknown outcome', () => {
    const ledger = new OutcomeLedger()
    const result = ledger.propose(retrievalInput({ evidence_outcome_ids: ['ghost'] }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('invalid_input')
  })

  it('auto-accepts a retrieval lesson but refuses a patch without manual accept', () => {
    const ledger = new OutcomeLedger()
    ledger.ingest(outcomeInput())
    ledger.propose(retrievalInput())
    ledger.propose(patchInput())
    expect(ledger.accept('p1', { at: T0, autoAccept: true }).ok).toBe(true)
    const patchAttempt = ledger.accept('pp1', { at: T0 })
    expect(patchAttempt.ok).toBe(false)
    if (!patchAttempt.ok) expect(patchAttempt.code).toBe('requires_manual_accept')
    expect(ledger.accept('pp1', { at: T0, manual: true }).ok).toBe(true)
  })

  it('supersedes a prior patch for the same target and rolls back to it', () => {
    const ledger = new OutcomeLedger()
    ledger.ingest(outcomeInput())
    ledger.propose(patchInput({ id: 'v1' }))
    ledger.propose(patchInput({ id: 'v2', text: 'Tighten it further.', candidate_patch: { target: 'writer_prompt', base_version: '1.0.0', diff: '- ok\n+ better' } }))
    ledger.accept('v1', { at: T0, manual: true })
    const second = ledger.accept('v2', { at: T0 + 10, manual: true })
    expect(second.ok).toBe(true)
    if (second.ok) {
      expect(second.lesson.version).toBe(2)
      expect(second.lesson.supersedes).toBe('v1')
    }
    expect(ledger.appliedLesson('v1')?.enabled).toBe(false)

    const rolled = ledger.rollback('v2')
    expect(rolled.ok).toBe(true)
    if (rolled.ok) {
      expect(rolled.disabled.enabled).toBe(false)
      expect(rolled.restored?.proposal_id).toBe('v1')
    }
    expect(ledger.appliedLesson('v1')?.enabled).toBe(true)
  })

  it('remembers a rejected signature so it is not re-proposed', () => {
    const ledger = new OutcomeLedger()
    ledger.ingest(outcomeInput())
    ledger.propose(retrievalInput())
    ledger.reject('p1', T0)
    expect(ledger.proposal('p1')?.status).toBe('rejected')
    const again = ledger.propose(retrievalInput({ id: 'p1-again' }))
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.code).toBe('duplicate_rejected')
  })
})

describe('OutcomeLedger retrieve and apply', () => {
  it('retrieves enabled lessons for a scope newest-first and excludes disabled', () => {
    const ledger = new OutcomeLedger()
    ledger.ingest(outcomeInput())
    ledger.propose(retrievalInput({ id: 'older', text: 'Old lesson.' }))
    ledger.propose(retrievalInput({ id: 'newer', text: 'New lesson.' }))
    ledger.propose(retrievalInput({ id: 'off', text: 'Disabled lesson.' }))
    ledger.accept('older', { at: T0 + 1, autoAccept: true })
    ledger.accept('newer', { at: T0 + 2, autoAccept: true })
    ledger.accept('off', { at: T0 + 3, autoAccept: true })
    ledger.disable('off')

    const retrieved = ledger.retrieve({ kind: 'task_type', value: 'summarize' })
    expect(retrieved.map(l => l.proposal_id)).toEqual(['newer', 'older'])
    const block = ledger.retrieveContextBlock({ kind: 'task_type', value: 'summarize' }, 1)
    expect(block).toContain('New lesson.')
    expect(block).not.toContain('Old lesson.')
  })

  it('re-enables a disabled lesson and clears its review flag', () => {
    const ledger = new OutcomeLedger()
    ledger.ingest(outcomeInput())
    ledger.propose(retrievalInput())
    ledger.accept('p1', { at: T0, autoAccept: true })
    ledger.recordFeedback('o1', { rating: 'wrong', at: T0 + 1 })
    expect(ledger.reviewQueue()).toContain('p1')
    ledger.enable('p1')
    expect(ledger.appliedLesson('p1')?.enabled).toBe(true)
    expect(ledger.reviewQueue()).not.toContain('p1')
  })
})

describe('OutcomeLedger measure', () => {
  it('flags a regression when success rate drops after a lesson applies', () => {
    const ledger = new OutcomeLedger()
    ledger.ingest(outcomeInput({ id: 'o1', created_at: T0 - 100 }))
    ledger.ingest(outcomeInput({ id: 'o2', created_at: T0 - 50 }))
    ledger.propose(retrievalInput())
    ledger.accept('p1', { at: T0, autoAccept: true })
    ledger.ingest(outcomeInput({ id: 'o3', created_at: T0 + 50, terminal_state: 'failed' }))
    ledger.ingest(outcomeInput({ id: 'o4', created_at: T0 + 100, terminal_state: 'failed' }))

    const assessment = ledger.assessRegression('p1')
    expect(assessment?.before.success_rate).toBe(1)
    expect(assessment?.after.success_rate).toBe(0)
    expect(assessment?.regressed).toBe(true)
  })

  it('summarizes outcomes by scope', () => {
    const ledger = new OutcomeLedger()
    ledger.ingest(outcomeInput({ id: 'o1', task_type: 'summarize' }))
    ledger.ingest(outcomeInput({ id: 'o2', task_type: 'translate', terminal_state: 'failed' }))
    expect(ledger.summarize({ kind: 'task_type', value: 'summarize' }).count).toBe(1)
    expect(ledger.summarize().count).toBe(2)
  })
})

describe('OutcomeLedger data management and persistence', () => {
  it('clears lessons but keeps the journal', () => {
    const ledger = new OutcomeLedger()
    ledger.ingest(outcomeInput())
    ledger.propose(retrievalInput())
    ledger.accept('p1', { at: T0, autoAccept: true })
    ledger.clearLessons()
    expect(ledger.allProposals()).toHaveLength(0)
    expect(ledger.allApplied()).toHaveLength(0)
    expect(ledger.allOutcomes()).toHaveLength(1)
  })

  it('clears everything', () => {
    const ledger = new OutcomeLedger()
    ledger.ingest(outcomeInput())
    ledger.clearAll()
    expect(ledger.allOutcomes()).toHaveLength(0)
  })

  it('round-trips through snapshot and restore', () => {
    const ledger = new OutcomeLedger()
    ledger.ingest(outcomeInput())
    ledger.propose(retrievalInput({ id: 'accepted' }))
    ledger.propose(retrievalInput({ id: 'rejected', text: 'Bad idea.' }))
    ledger.accept('accepted', { at: T0, autoAccept: true })
    ledger.reject('rejected', T0)
    ledger.recordFeedback('o1', { rating: 'unsafe', at: T0 + 1 })

    const snapshot = ledger.snapshot()
    const restored = OutcomeLedger.restore(snapshot)
    expect(restored.allOutcomes()).toHaveLength(1)
    expect(restored.proposal('accepted')?.status).toBe('accepted')
    expect(restored.proposal('rejected')?.status).toBe('rejected')
    expect(restored.appliedLesson('accepted')?.enabled).toBe(false)
    expect(restored.reviewQueue()).toContain('accepted')
    // A rejected signature survives the round trip.
    expect(restored.propose(retrievalInput({ id: 'rejected-again', text: 'Bad idea.' })).ok).toBe(false)
  })

  it('rejects a snapshot with the wrong version', () => {
    expect(() => OutcomeLedger.restore({ schema_version: 2 })).toThrow(/version 1/)
  })
})

describe('outcomeScopes', () => {
  it('derives task_type, model, skill, and plugin scopes', () => {
    const record = new OutcomeLedger().ingest(outcomeInput({
      versions: { skill_id: 'writer', database_versions: [{ plugin_id: 'wiki', version: '1.2.0' }] },
    }))
    const scopes = outcomeScopes(record)
    expect(scopes).toContainEqual({ kind: 'task_type', value: 'summarize' })
    expect(scopes).toContainEqual({ kind: 'model_id', value: 'llama3' })
    expect(scopes).toContainEqual({ kind: 'skill_id', value: 'writer' })
    expect(scopes).toContainEqual({ kind: 'plugin_id', value: 'wiki' })
  })
})

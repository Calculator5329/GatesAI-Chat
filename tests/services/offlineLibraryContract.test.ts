import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      resolve(process.cwd(), `tests/fixtures/offline-library/v1.3/${name}.json`),
      'utf8',
    ),
  )

interface PluginFixture {
  schema_version: number
  version: string
  transport: Record<string, unknown>
  safety: Record<string, unknown>
}

interface ProfileFixture {
  plugin_version: string
  local_only: boolean
  remote_fallback: boolean
  selection: Record<string, string>
  profiles: Array<{
    id: string
    evidence: {
      trials: number
      score_confidence_95: { low: number; high: number }
    }
    limitations: string[]
  }>
}

interface BenchmarkFixture {
  api_version: string
  run: { repetitions: number[]; seeds: number[] }
  summaries: { model: Array<Record<string, unknown>> }
}

describe('Offline Library v1.3 sanitized consumer fixture', () => {
  it('pins a narrow loopback-only, read-only transport contract', () => {
    const plugin = fixture('plugin') as PluginFixture

    expect(plugin.schema_version).toBe(1)
    expect(plugin.version).toBe('1.3.0')
    expect(plugin.transport).toEqual(
      expect.objectContaining({
        base_url: 'http://127.0.0.1:8892/api/v1',
        backend_proxy_required_for_webviews: true,
        network_required: false,
        redirects: false,
        max_response_bytes: 1_000_000,
      }),
    )
    expect(plugin.safety).toEqual(
      expect.objectContaining({
        mutations: false,
        arbitrary_sql: false,
        arbitrary_paths: false,
        private_databases_exposed: false,
        restricted_databases_exposed: false,
        public_schema_only: true,
      }),
    )
  })

  it('keeps profile selection task-aware, local-only, and evidence-linked', () => {
    const profiles = fixture('profiles') as ProfileFixture
    const ids = new Set(profiles.profiles.map((profile) => profile.id))

    expect(profiles.plugin_version).toBe('1.3.0')
    expect(profiles.local_only).toBe(true)
    expect(profiles.remote_fallback).toBe(false)
    expect(Object.values(profiles.selection).every((id) => ids.has(id))).toBe(true)
    expect(profiles.profiles).toHaveLength(3)
    for (const profile of profiles.profiles) {
      expect(profile.evidence.trials).toBeGreaterThan(0)
      expect(profile.evidence.score_confidence_95.low).toBeLessThanOrEqual(
        profile.evidence.score_confidence_95.high,
      )
      expect(profile.limitations.length).toBeGreaterThan(0)
    }
  })

  it('contains repeated aggregate metrics but no publication-unsafe evidence', () => {
    const benchmark = fixture('knowledge-arena') as BenchmarkFixture
    const serialized = JSON.stringify(benchmark).toLowerCase()

    expect(benchmark.api_version).toBe('1')
    expect(benchmark.run.repetitions).toEqual([1, 2, 3])
    expect(benchmark.run.seeds).toEqual([101, 102, 103])
    expect(benchmark.summaries.model[0]).toEqual(
      expect.objectContaining({
        sourceHitRate: expect.any(Number),
        citationValidityRate: expect.any(Number),
        averageTermRecall: expect.any(Number),
        averageRetrievalLatencyMs: expect.any(Number),
        averageGenerationLatencyMs: expect.any(Number),
        trust: expect.any(Object),
      }),
    )
    expect(serialized).not.toContain('raw_answer')
    expect(serialized).not.toContain('evidence_passage')
    expect(serialized).not.toContain('factual_hallucination_rate')
    expect(serialized).not.toContain('/home/')
  })
})

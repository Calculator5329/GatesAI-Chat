# v5 architecture spike — bounded findings

This is an isolated, text-only experiment, not the start of v5 or a decision to
rewrite the production domain. It demonstrates an inward dependency direction
and a small public interface for its implemented subset. It does not establish
production feature equivalence, performance improvement, migration cost, or that
extraction is impossible.

## Original measurements and their limits

The original hand-selected production path counted 25 files / 6,733 lines against
nine files / 1,050 lines in the initial spike. It counted 53 interface members
across eight production seams against ten across six spike ports (12 including
the adapter's key-value store). These are historical static counts, before this
correctness repair; they were not recomputed here. The production files also
implement tools, images, RAG, tasks, compaction and export. The spike does not.
Counting an import closure instead would still not establish equivalent work.

The original report disclosed that its seven tests were not executed in its
lane because the runner was refused. Its claims that concurrency was covered
and the layering was cheaper on every measured axis were too strong. A smaller
interface for fewer behaviors is a useful experiment, not a rewrite estimate.
The original source, tests and findings are preserved with hashes under
`~/.cache/tmp/astra-d20-proof/source-archive/`.

## Observed baseline defects

A bounded harness using the actual public runtime and hash-recorded source
reproduced these outcomes with no network or provider calls:

- Two real overlapping sends both called the fake transport. The first turn's
  later save overwrote the second completed reply. The old test only seeded an
  unfinished assistant record; it did not exercise concurrent sends.
- LF frames produced the expected text; equivalent CRLF frames produced an empty
  response marked complete.
- An HTTP-200 provider error event also became empty successful completion.
- EOF without finish evidence preserved partial text but called it complete.
  Requiring terminal evidence is now an explicit adapter/domain policy.

Evidence: `~/.cache/tmp/astra-d20-proof/results.json`, `probe.mjs`, and
`source-hashes.json`. These are measured baseline failures, not claims about
production GatesAI Chat behavior.

## Corrected spike behavior and verification

The adopted repair is documented in `docs/correctness-design-20260905.md`.
One runtime instance refuses overlapping sends for the same conversation before
loading or saving it, while other conversation IDs remain independent. Admission
releases in finally after success or failure. The stream reader handles LF,
CRLF and CR incrementally, preserves data-field semantics, and aborts a pending
read without waiting for an unbounded underlying cancellation callback.

The adapter requires [DONE] or a known finish reason. Malformed/error frames,
unsupported finish reasons and premature EOF fail while retaining partial text.
The domain also refuses implicit success when an arbitrary transport ends without
a terminal chunk. Cancellation remains cancelled. Trailing usage after a known
finish is retained.

`npx vitest run --config spike-v5/vitest.config.ts`: **22 passed**.
`npx tsc -p spike-v5/tsconfig.json`: **passed**. The test command reported 506 ms
wall duration on this run; no comparable production measurement was performed.
Logs: `~/.cache/tmp/astra-d20-proof/fixed-tests.log` and `typecheck.log`.
New probes supplement the original behavior tests; parent source review supplies
independent acceptance. No production app files changed.

## What remains unproven

No UI, tools, RAG, attachments, image generation, Ollama, Web Lite runtime,
multi-tab persistence leadership, crash durability, or abort-and-resend policy.
Admission is runtime-instance-local; separate runtimes, direct runChatTurn calls
and external writers have no CAS protection. Stalled repository/plugin code and
arbitrary injected transports have no new timeout guarantee.

Before architecture adoption, inventory the production behaviors that must
survive, then measure comparable behavior through candidate interfaces. A bounded
tool-round experiment could test whether the small interface survives that added
responsibility. Neither a tool decorator nor a domain rewrite is selected by the
current evidence. Preserve this experiment as evidence; do not treat it as a
replacement implementation.

The original public-runtime harness was also rerun against the repaired source,
with concurrency now expecting refusal rather than awaiting a second completion.
It observed one fake provider call, preserved the first reply, matched LF/CRLF
text, and returned error for provider-error and missing-finish streams. Repaired
script, source hashes and results: `~/.cache/tmp/astra-d20-fixed-proof/`.

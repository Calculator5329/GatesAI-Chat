# Exact embedding reuse — 2026-09-05

A11 preserves the existing RagIndexer interface and puts reuse inside its generation implementation. Baseline is master 2315387. User intent: reduce repeated local embedding work while preserving semantic-memory correctness and explicit rebuild.

## Design review before source

Adopt an optional `embeddingInput` string on derived RagChunk records. This is the exact bounded text sent to the embedder, including adjacent message, title, and library path context. It is bounded at 2400 characters per chunk. Existing schema-2 records remain readable; absent metadata is a cache miss, never evidence of identity. This is derived IndexedDB index metadata, not the portable app persistence schema; no app migration or index schema/policy/model change is needed.

The existing active-generation persistence seam remains authoritative. Match source type/thread/source ID/ordinal using an unambiguous tuple, then compare exact embedding input. A compatible active manifest must match model, schema, policy, and dimensions. Valid reused vectors must be nonempty and finite. Missing or incompatible metadata embeds anew. Hashes remain provenance metadata only and cannot short-circuit correctness. Unchanged source metadata and exact inputs preserve the existing generation. Metadata-only change and removal atomically replace the generation with reused vectors and no embedder call. Explicit rebuild bypasses reuse. Changed inputs batch into one embedder call; no empty call. Fresh vectors must have valid counts, nonzero dimensions, finite elements, and match reused vector dimensions. Cancellation is checked before commit; failure leaves active generation and watermarks untouched.

Use unique generation IDs because fast all-reused commits can happen within one millisecond. Keep source/chunk policy and input formatting unchanged. No cache service, new dependency, external storage, model/ranking/abstention change, or UI expansion.

Interrogation: a source-only hash design would miss adjacent-message edits and can collide; reject it. A new cache store would create invalidation and atomicity coupling; reject it. Optional exact input on current derived chunks keeps locality and older data safe. Cost is bounded duplicated local text and a scan of active vectors per tick; measure embedding calls, not unmeasured wall latency. Explicit rebuild remains the recovery path.

Gate lenses: producers are collectRagSources, boundedEmbeddingText, embedder and persisted chunks; consumers are generation persistence and retrieval. Adversarial cases include forged matching watermark, unchanged timestamps, changed adjacent sibling/title/path, legacy chunks, wrong model/policy/dimension, nonfinite vector, abort during embed. Runtime diagnostic probes must demonstrate both safe reuse and rejected reuse; these new probes do not authorize themselves. Existing CI/E2E plus parent independent acceptance remain gates.

## Verification plan

Measure 100 synthetic single-message sources: initial build, no change, one edit, removal, explicit rebuild. Compare observed embedder calls/input counts before and after; no wall latency claim. Probe source context, restored index restart, legacy metadata, model change, malformed output, cancellation, and failed persistence. Run focused RAG tests, npm run ci, and required full E2E outside sandbox. Archive and hash-verify generated observation side effects before restoring only those tracked paths. A12 is a separate narrow configuration commit with an intentional first-attempt failing trace probe and unchanged retry/timeout policy.

## Measured diagnostic evidence

The existing implementation on 2315387 failed the new 100-source diagnostic probe: observed embedder batch sizes were `[100, 100, 99, 99]` (initial, one edit, removal, explicit rebuild; no-change made no call). Candidate observes `[100, 1, 99]`: one edit needs one input, removal needs zero inputs, rebuild still refreshes all remaining 99. These are injected FakeEmbedder input counts, not production wall-time measurements. Raw baseline: `/home/ethan/.cache/tmp/astra-embedding-baseline.log`.

Focused probes exercise exact context, forged matching watermark, restart, legacy and incompatible metadata, invalid vector/count/dimension, abort, and failed persistence. Automatic indexing rejects same-model dimension drift even when every chunk changes; explicit rebuild may establish a new complete dimension as before. Baseline repository tests plus parent independent review/acceptance remain the release gates.

A12 diagnostic uses the real Playwright configuration with a temporary one-test project and no application/global setup. With zero retries, baseline on-first-retry produced no trace; retain-on-failure produced one valid trace ZIP containing events. Both attempts intentionally fail the same immediate assertion after rendering a local page. CI tracing, retries, workers and timeouts stay unchanged. Evidence: `/home/ethan/.cache/tmp/astra-audit-20260905/embedding-trace-probe/evidence.json` and adjacent logs/trace.

## Required repository verification

- `npm run ci`: 176 files / 1328 tests passed, then typecheck and lint passed. Log `/home/ethan/.cache/tmp/astra-embedding-ci.log`.
- `TMPDIR=/home/ethan/.cache/tmp CI= GATESAI_E2E_DESKTOP_PORT=15391 GATESAI_E2E_WEB_LITE_PORT=15392 npm run test:e2e -- --workers=2 --retries=0 --output=/home/ethan/.cache/tmp/astra-audit-20260905/embedding-e2e`: 144 passed, outside sandbox. Log `/home/ethan/.cache/tmp/astra-embedding-e2e.log`.
- Archived all 105 generated tracked runtime-observation modifications, verified SHA-256 against archived bytes, and restored only those files after checking baseline hashes equal HEAD. Archive manifest `/home/ethan/.cache/tmp/astra-audit-20260905/embedding-runtime-observations/manifest.json`.

No live embedding provider, production deployment, or wall-latency benchmark was run. Tests use the existing injected embedder and mocked browser environments. Both A11 and A12 were present during required verification.

## Review correction: non-secure local contexts

Parent review (2026-09-05) identified that bare `crypto.randomUUID()` unnecessarily requires a secure context; localhost E2E cannot expose that regression. Generation identity must work in supported browser contexts where earlier indexing worked. Use 128 random bits from `crypto.getRandomValues`, which does not require the UUID secure-context API. Keep a diagnostic with randomUUID absent and fixed time: distinct replacement generation IDs must still be produced. Future ID changes must preserve this compatibility, not infer it from localhost verification.

The Chromium diagnostic intercepted an HTTP `.invalid` fixture entirely locally and observed `isSecureContext: false`, `typeof crypto.randomUUID: undefined`, and successful 16-byte `getRandomValues`. It passed without contacting an external site. Log: `/home/ethan/.cache/tmp/astra-embedding-insecure-probe.log`. The first correction CI attempt exposed a TypeScript mismatch in Vitest getter spying (the runtime probe passed); the test now temporarily defines/restores only the UUID property descriptor instead.

Final review correction gates: `npm run ci` passed 1329 tests, typecheck and lint (`/home/ethan/.cache/tmp/astra-embedding-id-ci-final.log`); the required full browser command above with output `embedding-id-e2e` again passed all 144 with two workers and zero retries (`/home/ethan/.cache/tmp/astra-embedding-id-e2e.log`). Its 105 generated observations were separately archived, hash-verified and restored; manifest `/home/ethan/.cache/tmp/astra-audit-20260905/embedding-id-runtime-observations/manifest.json`.

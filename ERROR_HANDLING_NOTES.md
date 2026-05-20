# Error Handling Cleanup Notes

## Baseline

- Validation baseline established on 2026-05-20:
  - `npm run build` passes.
  - `npm test` passes.
- Test output includes repeated MobX strict-mode warnings about `RouterStore.route` mutations. This is out of scope for the error-handling pass and should be investigated separately.
- The earlier build blocker reported at `src/components/editorial/ModelPopover.tsx:529` is not present in `HEAD`; the current code uses `normalizedQuery`.

## Operating Decisions

- Silent paths must be triaged before changing behavior. A silent catch, `null` return, or default fallback is not automatically a bug.
- Use three target categories:
  - `throw AppError`: unexpected invariant violation caught at a higher boundary.
  - `Result<T>`: expected recoverable outcome that the caller must branch on.
  - `logged-fallback`: intentional graceful degradation that returns the existing sentinel/default and emits structured diagnostics without user-facing surfacing.
- Previously silent failures must remain silent unless explicitly approved as a behavior change.
- Error kinds for the first pass: `network`, `auth`, `rate_limit`, `bridge_offline`, `storage`, `parse`, `validation`, `provider`, `tool`, `cancelled`, `invariant`, `unknown`.
- Logging should not be MobX-observable and should not trigger renders.

## Logger Proposal

- Proposed module: `src/services/diagnostics/logger.ts`.
- Proposed surface:
  - `logger.error({ action, kind, message, context, correlationId, cause })`
  - `logger.warn({ action, kind, message, context, correlationId, cause })`
  - `logger.fallback({ action, kind, reason, context, correlationId, cause })`
  - `logger.debug({ action, message, context, correlationId })`
- Proposed sinks:
  - Console in development.
  - Redacted console warnings/errors/fallbacks in production.
  - Existing JSONL chat logging when a thread/correlation anchor exists and the bridge is online.
- Existing `chatLog` and `toolFailureLog` should wrap or call the new logger rather than being replaced in a broad first diff.

## Correlation Proposal

- Chat turn boundary generates the primary correlation id from existing anchors: `turn:<threadId>:<assistantMessageId>`.
- Tool execution uses existing tool call ids as child anchors: `turn:<threadId>:<assistantMessageId>/tool:<toolCallId>`.
- Provider logs should include `threadId`, `assistantMessageId`, `providerId`, `modelId`, and the correlation id.
- Tool logs should include `threadId`, `toolCallId`, tool name, read-only state, bridge state, and the correlation id.
- Bridge logs may include `op`, request id, and caller-provided correlation id, but the bridge client should stay store-agnostic.

## Initial Triage

- Core turn boundaries:
  - `src/stores/ChatStore.ts` turn start and stream exception handling: keep user surfacing behavior, add typed/correlated diagnostics.
- Provider adapters:
  - `src/services/llm/openaiCompat.ts` and `src/services/llm/ollama.ts`: keep `done:error` stream semantics, add typed classification for `auth`, `rate_limit`, network, cancellation, and provider failures.
  - Malformed stream fragments remain logged-fallback, not user-facing errors.
- Bridge client:
  - Malformed inbound bridge envelopes remain ignored from the user's perspective, but should become logged-fallback diagnostics.
- Intentional graceful degradation:
  - Optional markdown renderer imports, HTML artifact partial inlining, attachment-byte reads, persistence parse fallback, and web-lite storage fallbacks should preserve current sentinel/default returns.

## Deferred / Out Of Scope

- Deciding which logged-fallback paths should become user-facing UI is a product UX decision and belongs in a later pass.
- MobX strict-mode warnings observed during tests are out of scope for this pass.
- Build chunk-size warnings observed during `npm run build` are out of scope for this pass.

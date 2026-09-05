# A38 spike correctness — pre-source design, 2026-09-05

## Decision and scope

Repair the existing spike's claimed behavior before drawing architectural
conclusions. No production `src/` edits, v5 adoption, provider calls, new persistence
framework, or new scorecard. Parent adopts this design before implementation.

Actual public-runtime baseline: `~/.cache/tmp/astra-d20-proof/results.json`, with
harness and source hashes beside it. Two concurrent sends produced two provider
calls and one completion overwrote the other. LF input worked; CRLF input returned
empty successful completion. HTTP-200 error events also returned success. EOF
without completion evidence retained partial text but called it complete.

## Runtime admission

The existing ChatRuntime module owns a private Set of active conversation IDs.
`send` tests/adds the ID synchronously before its first await, and rejects an
already-active ID with the existing `turn-in-flight` DomainError. It awaits
runChatTurn inside try/finally and removes only its own admission in finally.
Rejected sends must not load, save, allocate IDs, notify listeners or call the
transport. Different IDs may run concurrently. Load/save errors, plugin/listener
throws, aborts, transport failures and successful completion all release admission.

This is one runtime instance's invariant. Separate instances, multiple tabs,
direct runChatTurn calls and concurrent repository writers remain unprotected.
No CAS, global lock, or claim of cross-runtime durability is added. Replace the
misleading seeded-record concurrency test with two real sends against a blocked
first transport, rather than retaining it as proof of actual concurrency.

## Stream and completion semantics

Keep the same byte-stream -> SSE payload -> provider chunk -> domain interfaces.
The SSE reader becomes incremental line parsing for LF, CRLF and CR, including
CR/LF separated across byte chunks. Only blank lines dispatch events; comments
and non-data fields do not become payload. Join multiple data lines with LF and
remove only the optional single space after `data:`. Flush UTF-8 decoder state;
an unterminated SSE event at EOF is incomplete, not silently synthesized.

The OpenAI-compatible adapter recognizes explicit [DONE] or known finish reasons
(stop, length/max_tokens). Continue reading after a known finish to retain trailing
usage until [DONE] or EOF; an EOF after known finish is valid. Unknown non-null
finish reasons are refused rather than reinterpreted as complete. Malformed JSON,
non-object frames and provider `error` objects produce an error chunk. Empty
usage/heartbeat objects can be ignored but cannot supply completion evidence.
EOF without [DONE] or known finish yields an error, preserving partial text.
No provider payload is required in diagnostic messages.

The domain also tracks explicit terminal chunks: an arbitrary transport iterator
ending without done/error must stop with error, preserving partial text. Abort
wins over missing terminal evidence and remains cancelled. Existing stopped/usage
and final persistence behavior stays at the same seam.

Abort while reader.read() has no future chunk must settle. Observe AbortSignal
before starting and while waiting; initiate reader cancellation without awaiting
an unbounded underlying cancel callback. Consume cancellation/read rejections,
remove the abort listener and release reader ownership in cleanup. This is a
transport stream cancellation contract, not a timeout for arbitrary injected
transport implementations or stalled repository/plugin code.

## Evidence and findings correction

Preserve baseline source in campaign cache with hashes before editing. Replace
the false concurrency proof. Add public-seam probes for synchronous same-ID
refusal, different-ID progress, recovery after representative load/save/plugin
and transport failure, LF/CRLF/CR with split boundaries, valid terminal frames,
trailing usage, malformed/error/unsupported finish, partial EOF, generic-transport
EOF, and stalled read abort. Tests use controlled fake stores/transports only.

Run the existing spike suite and spike TypeScript check; retain before/after
results. Source/parent review and the existing tests provide independent acceptance;
new probes are diagnostic evidence, not sole authority. No full app suite unless
integration review requires it. No claim of production behavioral parity.

Correct FINDINGS and the README summary (additional exact ownership required):
53 -> 10 and line counts describe a smaller text-only implementation and the
chosen counting method. They do not establish equivalent feature coverage,
performance, migration/rewrite cost, or that extraction is impossible. Separate
measured static counts, baseline behavioral failures, verified repaired behavior,
and untested future tool/persistence/multi-runtime behavior. Do not recommend a
rewrite based on this spike. Changelog remains another lane's until released.

## Gate and stream lenses

Interaction: runtime admission wraps repository/transport/observers; SSE supplies
provider chunks; terminal chunks drive domain persistence. Deficient claims at
these seams explain the defects; no broader framework is needed. Adversarial:
seeded unfinished rows cannot stand in for concurrency, LF-only fixtures cannot
prove line-ending support, and empty EOF cannot satisfy completion. Running:
actual public-runtime probes and retained logs show gates fire; both accepted and
refused inputs must be observed. Multi-runtime coordination, descriptor-level
storage safety and full app parity remain explicit limits.

SSE line/event rules follow the [WHATWG parsing specification](https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream). This specifies framing, not the adopted chat terminal-evidence policy. Final spike suite: 22 passed; spike TypeScript check passed.

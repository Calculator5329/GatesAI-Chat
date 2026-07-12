# Offline Library cross-repository acceptance — 2026-07-12

Status: accepted for the read-only G0–G6 scope.

## Pinned components

- Offline Library host: `local-ai-lab` `083fef6`, plugin `1.3.0`, API schema 1.
- GatesAI consumer milestones: `10b9420` (G0), `0eddb00` (G1), `7bba7f0`
  (G2), `c442eae` (G3), `02b1db0` (G4), and `46434ca` (G5).
- Boundary: exact `127.0.0.1:8892/api/v1`, read-only fixed routes, no
  redirects, 1,000,000-byte response ceiling, public schemas only, Web Lite
  unavailable, no remote fallback.

## Verification evidence

| Gate | Result |
| --- | --- |
| Host library/Jarvis/Comfy tests | 15 + 16 + 11 passed; compileall and diff check passed |
| GatesAI frontend CI | 158 files / 1,146 tests; app+test TypeScript and ESLint passed |
| GatesAI browser acceptance | 25/25 desktop-mocked and Web Lite scenarios passed, serial/polling |
| GatesAI Rust boundary | 39 passed; two explicitly live-only tests ignored in the normal gate |
| Live trusted-backend contract | 1/1 passed against plugin 1.3.0 through the actual Tauri request code |
| Live offline degradation | 1/1 passed with the host briefly stopped; typed `unavailable`, then service restored |

The live host reported 774 trials, 258 cells, 30 tasks, three deterministic
repetitions, and zero errors. Benchmark projection contained model, strategy,
and dataset summaries and no raw-answer or evidence-passage fields.

The live cited search returned only approved evidence schemes. During the
first smoke, one legacy catalog result exposed an absolute library path; host
commit `083fef6` now converts library-root references to resolvable
`library://` identifiers and out-of-root legacy references to opaque digests.
The rerun passed through the trusted GatesAI backend with no `/home/` path.

## Safety disposition

- No OpenRouter, paid model, or remote fallback was used.
- No private/restricted database alias, row data, arbitrary SQL/path, mutation,
  raw answer, or evidence passage entered fixtures, UI, tools, or smoke output.
- Citation/support metrics remain labeled grounding proxies, not factual
  hallucination judgments.
- G7 management, private-data, row-query, and semantic-judging extensions
  remain separately gated.

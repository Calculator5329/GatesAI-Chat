# Consolidation Report

Date: 2026-05-20

## Cleanup Window

Heuristic used: commits since the visible cleanup sequence began on `3a25371` plus the uncommitted cleanup-agent work present in the worktree.

Recent cleanup commits reviewed:

| Hash | Subject |
| --- | --- |
| `f65537d` | Derive Ollama availability from runtime status |
| `d186d70` | Rename private UI helper types (no behavior change) |
| `a41f3cf` | Fix model picker query guard |
| `c5ce743` | Add error handling cleanup notes |
| `db65cff` | Document import cleanup decisions; no behavior change |
| `2e23c53` | Clarify model picker control flow |
| `993c572` | Add source navigation comments |
| `fc9394f` | Stabilize model popover callbacks |
| `1ccbae0` | Add bundle analyzer baseline tooling |
| `3a25371` | Move sidebar hover state into rows |

Consolidation commits created in this pass:

| Hash | Subject | Expected behavior change |
| --- | --- | --- |
| `e8775b9` | Consolidate dynamic model catalog ownership | No behavior change; provider model catalogs still surface through `ModelRegistry`. |
| `a8cc11b` | Consolidate lazy cleanup boundaries | No behavior change; lazy section/tool boundaries preserve prior UI and tool behavior. |
| `344253b` | Consolidate service parser hardening | No behavior change; malformed external payloads continue to follow existing fallback paths. |
| `e14fedd` | Consolidate render cost derivations | No behavior change beyond already-established cleanup UI/test coverage; render derivations stay store-backed. |
| `3e2caa7` | Stabilize ChatStore persistence test | No application behavior change; test isolation flushes deferred saves before clearing storage. |
| `00f84d1` | Consolidate OpenRouter compatibility store boundary | No behavior change; compatibility runs still lazy-load the heavyweight runner. |
| `014ba5b` | Add consolidation reference docs | Documentation only; no runtime behavior change. |
| `7681425` | Stabilize ChatStore persistence assertion | No application behavior change; test waits for the persisted snapshot condition instead of a fixed timer. |

Running notes cross-referenced:

| Notes doc | Status |
| --- | --- |
| `RENDER_PERF_NOTES.md` | Kept as active notes. Deferred virtualization, composer split, profiler traces, and TimeoutOverflowWarning remain out of scope. |
| `IMPORT_BUNDLE_CLEANUP_NOTES.md` | OpenRouter compatibility dynamic/static split is now resolved by `openRouterCompatibilityTargets.ts`; other deferred items remain active. |
| `ERROR_HANDLING_NOTES.md` | Parser hardening is present. Logger module and test-output noise remain deferred. |
| `STATE_OWNERSHIP_NOTES.md` | Ollama availability and dynamic catalog ownership are consolidated. Draft, route, and persistence ownership remain deferred. |
| `NAMING_CLEANUP_NOTES.md` | Naming decisions remain documented in `NAMING.md`; no additional naming batch was needed. |

## Files Touched In This Pass

| File | What changed |
| --- | --- |
| `src/stores/OllamaStore.ts` | Removed duplicate direct registry writes after the catalog setter became the single sync path. No behavior change. |
| `src/stores/OpenRouterStore.ts` | Removed duplicate direct registry writes after the models setter became the single sync path; `clearCache()` now clears through the setter. No behavior change. |
| `tests/stores/ChatStore.test.ts` | Flushes pending deferred snapshot saves before storage resets and waits for the exact persisted snapshot condition instead of a fixed timer. No application behavior change. |
| `CONSOLIDATION_REPORT.md` | Added this audit report. |
| `CODEBASE_OVERVIEW.html` | Added self-contained orientation snapshot for future contributors. |

The following cleanup-agent files were also reviewed and committed as part of this consolidation because they were coherent, validated, and in scope for the existing cleanup window:

| File | Consolidated change |
| --- | --- |
| `src/components/editorial/EditorialComposer.tsx` | Uses store-derived LLM spend and adds the context usage meter near model selection. |
| `src/components/menu/menuSectionMeta.ts` | Lazy-loads menu section components while preserving section metadata. |
| `src/index.css` | Adds styles for the long-history "show earlier" control. |
| `src/services/bridge/client.ts` | Parses bridge envelopes and error payloads from unknown JSON before dispatch. |
| `src/services/chat/toolFailureLog.ts` | Types the JSON preview replacer without changing redaction behavior. |
| `src/services/compat/openRouterCompatibility.ts` | Re-exports target selection from the lightweight target module and keeps the heavyweight runner separate. |
| `src/services/compat/openRouterCompatibilityTargets.ts` | New lightweight OpenRouter compatibility target selector used by the store and tests. |
| `src/services/image/comfyClient.ts` | Parses ComfyUI prompt/history responses from unknown JSON. |
| `src/services/image/imageBackend.ts` | Dynamically imports image backend clients during dispatch. |
| `src/services/imageGenStorage.ts` | Removes an unsafe preset cast while preserving legacy preset migration. |
| `src/services/imageJobsStorage.ts` | Validates persisted image jobs before rehydration. |
| `src/services/llm/ollama.ts` | Parses Ollama stream frames from unknown JSON and preserves malformed-line skipping. |
| `src/services/llm/openaiCompat.ts` | Parses SSE chat chunks and usage from unknown JSON; clarifies strict-schema gating. |
| `src/services/persistence.ts` | Validates chat snapshot, thread, message, tool call, and tool result shapes before migration. |
| `src/services/search/braveClient.ts` | Parses Brave Search grounding responses from unknown JSON. |
| `src/services/tools/describeImage.ts` | Parses local vision model responses from unknown JSON. |
| `src/services/tools/imageGenerate.ts` | Parses prompt-file JSON through narrow helpers before validation. |
| `src/services/tools/sourceBuild.ts` | Dynamically imports source-build service functions at execution time. |
| `src/services/tools/sourceWorkspace.ts` | Dynamically imports source-workspace service functions and uses explicit response types. |
| `src/services/tools/sqliteQuery.ts` | Parses sqlite JSON output into a narrow result shape. |
| `src/stores/ChatStore.ts` | Adds store-level LLM spend derivations and source comments for tool-call normalization. |
| `src/stores/ImageJobStore.ts` | Adds `costByThread` derivation and validates Comfy workflow JSON shape. |
| `src/stores/ModelRegistry.ts` | Adds `dynamicForProvider()` for provider-specific dynamic catalog reads. |
| `src/stores/OpenRouterCompatibilityStore.ts` | Imports lightweight target selection statically and lazy-loads the compatibility runner. |
| `src/stores/RootStore.ts` | Derives Ollama availability from runtime status and narrows the dev-window cast. |
| `tests/components/editorial/EditorialComposer.test.ts` | Covers the context usage meter. |
| `tests/components/editorial/EditorialChat.test.ts` | Covers long-history paging and visible-list render isolation during streaming. |
| `tests/components/editorial/EditorialSidebar.test.ts` | Covers debounced search and render capping. |
| `tests/components/menu/GatesMenu.test.ts` | Flushes/preloads lazy menu sections for stable assertions. |
| `tests/core/tokens.test.ts` | Covers token-estimate cache reuse for repeated selected tools. |
| `tests/perf/streaming.perf.test.ts` | Adds a ChatStore send-path startup perf smoke test on a 1000-turn thread. |

## Cross-Cutting Findings

| Finding | Resolution |
| --- | --- |
| Dynamic model catalogs now live in `ModelRegistry`, but `OllamaStore` and `OpenRouterStore` still had redundant direct registry writes alongside their setters. | Removed the redundant writes so the setter is the one local synchronization path. |
| Lazy imports for menu sections and heavyweight tool modules were introduced consistently. | Verified `GatesMenu` wraps lazy sections in `Suspense`; no code change needed. |
| Runtime JSON parsing was hardened across providers, bridge messages, persistence, search, and tools. | Reviewed parsers for shape preservation and validation. No additional parser changes needed. |
| Render-performance tests were added for long chat histories, sidebar search capping, context meter display, token cache reuse, and chat send startup. | Preserved tests and included them in full validation. |
| Full-suite validation exposed an intermittent ChatStore persistence assertion after cleanup commits and again after the first docs commit. | Fixed test isolation by flushing queued snapshot saves before clearing storage, then replaced the brittle fixed wait with a predicate wait for the actual persisted turn in `7681425`. |
| Console warnings/errors remain visible in tests. | Left unchanged because `ERROR_HANDLING_NOTES.md` explicitly defers a logger module and several warnings assert graceful degradation paths. |

## Decisions And Rationale

| Decision | Rationale | Alternatives considered |
| --- | --- | --- |
| Treat existing dirty cleanup-agent work as consolidation input. | The prompt describes multiple prior cleanup agents and asks for residue cleanup after those passes. The dirty worktree matched the cleanup themes and validated green. | Treat the dirty work as unrelated user edits; rejected because it would leave the requested consolidation incomplete. |
| Keep `threadLlmSpendUsd(thread)` export. | It is still imported by `tests/stores/ChatStore.test.ts`; removing it would risk a public-ish helper contract and was not needed. | Remove as dead code; rejected after reference search. |
| Do not replace `console.warn`/`console.error` calls. | The notes classify centralized logging as proposed/deferred, and several warnings preserve intentional fallback visibility. | Introduce a logger now; rejected as a new initiative. |
| Fix the ChatStore persistence test as test cleanup, not runtime cleanup. | Repeated full-suite failures pointed at deferred save/timer nondeterminism; the production code path was preserved and the test now waits for the persisted snapshot it asserts. | Change persistence timing in production; rejected as behavior risk and unnecessary. |
| Do not address virtualization, gallery pagination, draft ownership, route ownership, or persistence cleanup. | These are explicitly deferred or warrant dedicated prompts. | Fold them into consolidation; rejected as out of scope. |
| Document current architecture in HTML without generated diagrams or external libraries. | The deliverable requires a single self-contained reference artifact. | Mermaid or bundled script charts; rejected by constraint. |

## Items Not Addressed

| Item | Reason |
| --- | --- |
| Workspace virtualization | Explicitly deferred in render-performance notes. |
| Gallery pagination/virtualization | Explicitly deferred in render-performance notes. |
| Composer split | Deferred in render-performance notes; current pass only validated the context-meter addition. |
| Logger module for service/store diagnostics | Explicitly deferred in error-handling notes. |
| MobX strict-mode warnings in test output | Pre-existing/out of scope per error-handling notes. |
| `TimeoutOverflowWarning` during tests | Logged in render-performance notes as future cleanup. |
| User-guide asset fetch warning under jsdom | Existing test-environment noise; not part of cleanup window. |
| React duplicate-key warning in a duplicate id test | Test intentionally exercises duplicate tool result ids; changing behavior would be product/runtime work. |
| Markdown/Tauri adapter split | Deferred in import-bundle notes. |

## Validation Status

| Command | Status | Notes |
| --- | --- | --- |
| `npm.cmd run lint` | Passed | PowerShell blocks `npm.ps1`, so `npm.cmd` is the working invocation. |
| `npm test -- --reporter=dot` | Passed | 73 files, 611 tests. Earlier full-suite runs exposed the ChatStore persistence isolation race; the initial flush fix was insufficient, and the final predicate wait in `7681425` passed targeted and full suites. NPM reports `--reporter` as an unknown npm config; Vitest still ran. |
| `npm run build` | Passed | Vite still reports the known large-chunk warning. |
| `git diff --check` | Passed | Only Git line-ending notices were printed. |

Build baseline from the final validation:

| Chunk | Size | Gzip |
| --- | ---: | ---: |
| `index-DO4Nj6bz.js` | 588.80 kB | 179.04 kB |
| `chunk-K5T4RW27--k6b0qxn.js` | 474.39 kB | 102.28 kB |
| `cytoscape.esm-CM-WY83N.js` | 434.29 kB | 137.57 kB |
| `katex-BgoCriM6.js` | 257.04 kB | 76.96 kB |
| `rehype-highlight-DkGNdgSb.js` | 163.04 kB | 51.91 kB |
| `ApiSection-Ds1SJRdg.js` | 8.79 kB | 2.79 kB |
| `Gallery-C0G5BSak.js` | 4.80 kB | 2.17 kB |
| `Workspace-Cchn98ln.js` | 17.76 kB | 6.44 kB |
| `openRouterCompatibility-BD7nORDV.js` | 4.88 kB | 2.00 kB |
| `sourceWorkspace-B8x5DocZ.js` | 1.19 kB | 0.41 kB |
| `sourceBuild-C37FM63W.js` | 0.47 kB | 0.26 kB |

Profiler traces: not found in repo notes; left unknown.

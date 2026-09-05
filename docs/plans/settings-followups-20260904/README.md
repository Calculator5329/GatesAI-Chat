# Bounded settings follow-ups from C1

Source and evidence: `docs/audits/overnight-settings-20260904/README.md`, source fce9e603. These are repair specifications, not authorization to change visual direction or native runtime policy. Claim the exact paths through AO before implementation.

## C1-01 — Preserve the actual shortcut-unavailable reason

Confirmed: desktop browser Settings displays “in use by another app” while `src/services/desktop/ambient.ts` returns `desktop shell unavailable`. `DesktopBlock` in `src/components/menu/sections/Settings.tsx` collapses every nonempty `globalShortcutUnavailableReason` to collision text. The hook/store already retain the reason.

Scope: Settings.tsx and a focused component test. Render supported-shell absence distinctly, preserve genuine conflict wording, and give unknown failures neutral wording using the actual typed status. Do not assert the OS has a collision without evidence. Verify unavailable-shell, actual collision and available/no-warning cases; reload preference behavior remains intact. Native key registration behavior is unchanged. Existing CI and E2E gates must pass before committing.

## C1-02 — Distinguish a successful empty catalog from never fetched

Confirmed: Load models receiving HTTP200 with `{"data":[]}` returns to “Not loaded yet”; a nonempty synthetic response instead displays its count/time and survives reload. `src/components/menu/sections/api/OpenRouterCatalogRow.tsx` keys both wording and actions on `count > 0`, despite a separate fetchedAt field.

Scope: that row plus focused component/store tests only if persistence behavior needs correction. Display a completed zero-result fetch and its timestamp; keep refresh available and distinguish never fetched and failure. Preserve prior catalog on failure according to the existing store contract. Verify never-loaded, empty-success, nonempty-success and failed-refresh UI states. Optional singular “1 model” wording belongs to this same local row. Do not change provider endpoints or make live calls.

## C1-03 — Separate catalog reachability from native process status

Observed browser-only: alternate-address refresh received a synthetic `/api/tags` HTTP200, but Local models still displayed “Ollama not running — start it and refresh.” The card reads `local.runtimes.ollama.status`; `ollama.refresh()` updates catalog and lastRefreshAt, not native process status. An externally managed reachable server is not proven stopped by that native state.

Scope/design first: `LocalModelsCard` in ApiSection.tsx, existing Ollama/local-runtime state tests and a browser interaction test. Specify whether the card reports catalog connectivity or managed process status, retain them as distinct facts, and never infer successful inference from a catalog fetch. Reproduce a reachable custom address, failed catalog fetch and native managed online state before changing behavior. The present finding alone does not justify starting/stopping runtimes, changing service detection, or marking embeddings ready.

## C1-04 — Reconcile the inherited HTML presentation test contract

Full E2E is 38/39 because polish.spec.ts:115 requires `inline-html-document-card`; current MarkdownChunk renders Preview/Source. August26 changelog records this same failure and August15 merge d0d68df's selected toolbar. Existing taste prose and historic test disagree with that implementation. Gather the exact surviving owner ruling, then make only the compatible implementation/test/document correction. If authority remains contradictory, present that concrete divergence to Ethan. Do not delete the test, weaken its assertion, restore a rejected presentation, or declare this audit's source releasable meanwhile.

## Remaining runtime evidence

Native shortcut/tray effects require the desktop shell; live retrieval needs an approved synthetic source and real local embedding runtime; manual full-data download remains blocked by automatic approval review. These are explicit coverage gaps, not silently passing checks. Browser export/import core semantics already passed existing synthetic tests. No new gate lists, permanent data deletion, real credentials, publication, or deployment are part of these specs.

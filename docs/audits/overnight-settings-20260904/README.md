# C1 settings audit — 2026-09-04

Audit source: `fce9e603ca02d49a2997c18d8d3f4b43230fe659` (4.7.0), isolated AO lane `codex-settings-audit-20260904`. No production code changed. The current menu has Settings, Models and Agent; the older seven-section walkthrough is not the current inventory.

The supported browser checks below are complete with explicit gaps. Native shortcut/tray operation, live retrieval and full app-data download remain unverified. `npm run ci` passed 174 files / 1,263 tests plus typecheck and lint. Required E2E finished 38 passed / 1 failed in 46.1 seconds. The existing full-HTML-document announcement test at `tests/e2e/polish.spec.ts:115` still expects a card while the renderer uses Preview/Source. The same divergence is documented in the August 26 changelog and the August 15 merge d0d68df; this audit does not select a new visual contract. The repository requires both gates before any commit, so these audit artifacts are retained uncommitted until that existing gate is resolved.

## Environment and evidence

Cached Chromium 1234, headless 1280×720, fresh isolated profile, local Vite at 127.0.0.1:15475. The desktop browser build has no Tauri shell. Web Lite was covered by the existing E2E project, not a new manual native run. Manual observations were made between 03:41 and 04:04 UTC. Provider requests were blocked after the initial unconfigured local-service probes; exact model catalog routes returned authored synthetic responses. No live chat, model inference, search, native runtime start, external account, or source-library import was exercised.

Raw snapshots and console: `output/playwright/session/`. Three screenshots: `models-synthetic-catalog.png`, `agent-reload.png`, `settings-confirmation-cancelled.png`. Full gate logs are retained alongside them. `evidence-manifest.json` binds every retained artifact by SHA256. Screenshots show a viewport, not a claim of full-page or all-state coverage.

Manual console was not clean: expected offline bridge/probe failures remain. The full E2E mocks also emit workspace JSON and MobX warnings. A passing pageerror assertion is not equivalent to zero console errors.

## Controls and measured effects

| Area / control | Evidence and outcome | Remaining effect boundary |
|---|---|---|
| Color mode: Dark / Light / System | Existing settings walkthrough changes mode, reloads and checks document theme; passed | OS theme changes were not driven manually |
| Interface pack: Classic / Aurora | Manual Classic→Aurora survived reload; actual app root `data-ui-pack=aurora` and `pack-aurora` class changed | No visual redesign verdict |
| Automatic thread titles | Existing reload test passed | Model-generated naming request not exercised manually |
| Global summon | Switch exposed with checked state; unsupported-shell warning reproduced | Native registration / summon requires Tauri; warning reason is wrong (C1-01) |
| Summon chord / Reset | Manual Ctrl+Shift+Space→Ctrl+Shift+Y survived reload; recorder service tests passed | Actual OS binding and Reset click not manually exercised |
| Close button hides to tray | Existing reload test passed | Native close/tray process effect requires Tauri |
| Export JSON | Existing synthetic round-trip, secret-exclusion and citation-preservation tests passed | Manual full-data download was rejected by automatic approval review; no export ran |
| Merge / Replace import mode | Replace displays confirmation text and disables Choose JSON; exact phrase enables it; switching to Merge restores normal state | No manual import/replacement; existing data-import tests cover merge and round-trip |
| Delete all threads | Count/detail/button visible; source requires explicit confirm | No removal performed |
| Delete memories | Count/detail visible; opening confirmation and Cancel retained the synthetic fact | Confirmed deletion not manually performed; existing fact deletion/reload test passed |
| Remove provider keys | Visible and enabled after synthetic OpenRouter key was saved | No danger-zone removal performed; individual provider storage tests passed |
| OpenRouter key / Connect | Entering an authored synthetic value led to stored/connected state and masked field after reload | Connected means configured here, not independently authenticated; no live auth check |
| OpenRouter Reveal / Remove | Both appear for saved key; existing generic key masking coverage passed | Manual Reveal/Remove not exercised |
| OpenRouter Load / Refresh | Intercepted nonempty catalog produced 1 model and refresh timestamp, surviving reload | Empty successful response still says Not loaded yet (C1-02) |
| OpenRouter Clear cache | Appears after nonempty refresh; existing store clear-cache test passed | Manual clear not exercised |
| Ollama address / Refresh models | Manual alternate 127.0.0.1:11439 address survived reload; actual refresh response matched intercepted `/api/tags` 200 synthetic catalog | Browser label still says Offline because it uses native runtime state (C1-03); native online effect unverified |
| Brave key / Connect / Remove | Existing walkthrough set, persistence, masking and clear checks passed | No live Brave query or authentication |
| Agent instructions | Manual authored instruction survived reload; existing walkthrough also passed | Actual outbound chat payload not newly exercised |
| Saved fact Add / Edit / Save | Manual add then edit retained exact edited content after reload | Cancel-on-edit not newly exercised |
| Saved fact Delete / Clear all | Existing single-fact deletion/reload test passed; Clear all visible | Manual bulk removal not performed |
| Knowledge library Add source / Refresh / per-source toggle | Empty/offline Add disabled; source conditional controls reviewed | Requires online bridge and approved source fixture; not a dead-control claim |
| Semantic recall master | Checked but disabled with Ollama offline / 0 chunks | Actual embedding/retrieval not available in this runtime |
| Include Conversations / Notes / Saved facts / Library | Manual Notes/facts/library flips persisted across multiple reloads; Conversations retained true | Existing retrieval policy and source-chip exclusion/undo tests passed; no live corpus effectiveness measurement |
| Recall source group expansion / per-source exclusion | Existing desktop evidence test opens sources and excludes/undoes a source | Full library/nonempty-source state not manually exercised |
| Try recall / Preview | Input visible; Preview disabled offline | No semantic result manufactured |
| Rebuild index / Clear derived index | Both disabled offline | Rebuild and clear need an available embedding runtime |

The export refusal was explicit: automatic approval review could not establish that a full downloaded app payload contained only synthetic profile data. It rejected the command before execution. No alternate export path was attempted. A future manual export needs approved provenance of an isolated fixture or owner approval for the specific payload; unaffected checks continued.

## Findings and follow-up

Bounded repair specifications are in `docs/plans/settings-followups-20260904/README.md`. C1-01 and C1-02 have direct UI/source reproductions. C1-03 is confirmed for the browser mock with a successful catalog response; its native applicability remains unproven. The inherited HTML gate is a separately recorded contract divergence, not a new settings regression. No source, UI, test expectation, provider configuration, or owner ruling was changed to make this audit green.

## Follow-up authority check, 2026-09-04 05:30 UTC

The recorded owner answer in `/home/ethan/projects/planning/decisions/2026-08-15-forge-program-packet-answers.md` is `q-taste-pass-branch=merge-now`: verify green, merge the22-commit branch sight unseen, and fix forward. The merge commit itself records the agent's deliberate Preview/Source resolution. The answer summary does not explicitly choose that toolbar over the announcement card. Therefore the August26 changelog's claim that the card was ruled against is not independent evidence of that precise preference. Current taste, test and source still diverge; no test or visual direction was changed. Exact owner-turn mining is in progress using the existing redacting archive tools.

Existing archive tools completed the bounded wording check: census7245files,2057human-classified files (a lower bound); miner scanned43643user-role turns and emitted zero surviving owner matches for the four exact phrases. Its one regex match was filtered as agent-shaped. This cannot establish that no ruling exists: long turns, paraphrases, voice or other surfaces may be missed. No filtered raw content was inspected to defeat that filter. Source disagreement remains unresolved. Evidence: `/home/ethan/.cache/tmp/c1-owner-ruling-census-20260904.jsonl` and `/home/ethan/.cache/tmp/c1-owner-html-rulings-20260904.jsonl`.

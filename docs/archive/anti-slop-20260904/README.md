# Unused helper cleanup — 2026-09-04

Original source files are retained byte-for-byte as `.ts.txt` beneath this folder. Base: `655fd62bc98ef31fda9eaf85ce474cc2ef6ff797`.

The removed exports had no source or test callers: `formatImageElapsed`, `imageTerminalMessage`, `imageTerminalToolResult`, `imageTerminalKey`, `formatRecallResults`, and `formatSemanticContextBlock`. The latter two were the only consumers of the removed `RagFormatSources` and `sourceLabel` declarations. Active direct-image helpers and `formatStructuredRecallResults`, called by `RagStore`, are unchanged. No product feature or test was retired.

Validation recorded by terminal commands:

- Focused ChatStore, turnRunner and RAG tests: 118 passed.
- Full `npm test`: 176 files, 1307 tests passed.
- `npm run typecheck`, `npm run lint`, `git diff --check`: passed.
- First full Playwright run with four workers: 143 passed, one Web Lite status-label timeout. Targeted baseline with exact original formatter bytes: passed. The full two-worker recheck finished with 133 passed and 11 failed. That earlier run remained red and the cleanup was kept uncommitted. The continuation results below supersede this gate status.

Full logs are retained in [verification/](verification/): `vitest.log`, `e2e.log`, `e2e-baseline.log`, and `e2e-recheck.log`. Failure contexts are in `verification/e2e-recheck-results/`.

Playwright rewrites tracked journey observations. Final generated evidence is retained in `verification/runtime-observations/`; the cleanup does not change the repository's reference observations.

Continuation: a fresh whole-repository caller search confirmed `formatTokenCount`, `estimateMessageTokens`, `safeJsonObject`, and `localRuntimeDefaults` have no callers. These four exports are now archived too. The live token estimation, JSON validation, and runtime defaults remain unchanged. Independent review confirmed all six original files match HEAD byte-for-byte and found no over-removal. No architectural rewrite was justified by this bounded audit.

Earlier E2E recheck failures (all original test code retained):

- `journeys.generated.spec.ts:432`: exclude-memory-source-and-undo
- `journeys.generated.spec.ts:991`: markdown-links-open-workspace-path
- `journeys.generated.spec.ts:1019`: long-thread-show-earlier
- `journeys.generated.spec.ts:1032`: long-thread-jump-to-latest
- `journeys.generated.spec.ts:1284`: aurora-reply-footer
- `journeys.generated.spec.ts:2069`: whats-new-dismiss
- `multiTab.spec.ts:26`: second tab read-only while first owns persistence
- `multiTab.spec.ts:56`: closing leader refreshes follower and transfers persistence
- `settingsWalkthrough.spec.ts:59`: agent system prompt survives reload
- `settingsWalkthrough.spec.ts:77`: close-to-tray toggle survives reload
- `web-lite.spec.ts:13`: Web Lite status and disabled attachments

Several cases passed the first full run. The targeted original-code baseline passed. These results do not establish the cause of the intermittent failures. No assertions, fixtures, retries, or product behavior were changed to obtain a pass. The continuation investigated the empty-page failure contexts and reran the 19 reload, multi-tab, and Web Lite tests with browser traces: all passed unchanged in 33.7 seconds. The original failure cause remains unproven. Local Vite code confirms the two modes share a dependency cache; neither retained logs nor the diagnostic run establish cache interference. No speculative cache or timeout change was made.

## Completed verification

On 2026-09-04, `npm run ci` passed (176 unit files, 1307 tests, TypeScript and ESLint). The complete `npm run test:e2e -- --workers=2 --trace=retain-on-failure` passed all 144 cases in 2.5 minutes using dedicated ports 15373/15374. No test assertions, retry policy, timeout, or browser fixture was changed. Logs: `verification/ci-final.log`, `verification/e2e-final.log`, and the earlier focused `verification/e2e-diagnostic.log` (19 passed). Earlier failures remain preserved and unexplained; this pass does not claim the intermittent failure cause was repaired.

The cleanup removes 114 net production lines across six files, with no product feature retired. Working-feature retirement remains an owner decision.

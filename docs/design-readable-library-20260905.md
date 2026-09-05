# Readable library retention and incremental projection — 2026-09-05

## A34 design before source

The readable HTML/Markdown library is a best-effort derived projection. The privileged writer previously deleted every unexpected HTML/Markdown file in the conversations directory; the fake-bridge diagnostic confirmed this includes a foreign owner draft, not just old app mirrors. Bridge fs.delete permanently removes files. Root adopted removal of blanket pruning first, separately from A33 performance.

Retain all stale and unrecognized files in place. The current index still lists only active snapshot threads using current titles/paths. Existing current-path mirrors continue updating. No archive/move protocol, file ownership guess, canonical JSON change, or live-file operation. Previously exported retired content remains on disk intentionally; this is retention, not a promise of erasure.

Gate review: canonical snapshot produces the current index; file existence does not prove ownership. Adversarial fixture puts a foreign Markdown/HTML file beside old generated exports. Their exact bytes and paths must survive a save while old index links disappear and current outputs update. Existing roundtrip/render/deleted-thread coverage remains; the changed retention diagnostic expresses the explicitly adopted contract. No new surface or dependency.

## Archived original helper

The following exact helper was removed from src/services/chat/libraryExport.ts. SHA-256: 7d70edea23636c8cdd12fd85db07e937997a597860e53f8e447a5bae57b86ff2

```ts
async function pruneStaleConversationFiles(client: BridgeClientFacade, expectedPaths: Set<string>): Promise<void> {
  const resp = await client.request<FsListResp>('fs.list', {
    path: WORKSPACE_CHAT_LIBRARY_CONVERSATIONS_DIR,
  });
  const entries = Array.isArray(resp.entries) ? resp.entries : [];
  for (const entry of entries) {
    if (entry.kind !== 'file') continue;
    if (!/\.html?$/i.test(entry.path) && !/\.md$/i.test(entry.path)) continue;
    if (expectedPaths.has(entry.path)) continue;
    await client.request('fs.delete', { path: entry.path });
  }
}

```

A33 remains design-only until separate review: measured 100-thread corpus rewrites 201 files / about 3.13MB per unchanged save. Retention repair must not be folded into performance claims.

## A33 adopted design before source

Root adopted complete rendered-output comparison, with cache ownership in the existing workspace persistence instance and a readonly actual BridgeClient connection epoch. New successful socket opens advance the token; idempotent connect calls do not. Unknown facades stay uncached. A new persistence instance on a workspace-root switch starts cold. Canonical snapshot atomic-save/fallback behavior and existing coordinator serialization remain unchanged; no new queue or service.

Store the successful HTML/Markdown pair and its savedAt. Render current content using that previous timestamp, compare both complete strings, and skip only when a complete directory listing establishes both files still exist. This covers all renderer dependencies, including nested message/tool/attachment data and current day/locale formatting, without trusting updatedAt. Changed output rewrites the pair using the current snapshot timestamp. Index always updates. Per-conversation Saved means last successful pair write; index Saved means latest projection snapshot.

Clear all cached entries on failed, truncated, or malformed listing, and fall back to full writes of known current paths without cache promotion. Any partial write clears all entries. Only promote the completed export when the connection epoch is unchanged; missing files require a pair rewrite. Presence is not disk-integrity evidence: external edits are not imported and may remain until source/render changes or lifecycle invalidation rewrites that path. No automatic user-edit overwrite guarantee. A34 retention stays independent.

Acceptance measures bridge write calls/bytes, not rendering CPU or invented latency: unchanged save, same-updatedAt edit, nested data, rename/deletion, missing file, reconnect/new instance, unknown facade, failed/incomplete listing and partial writes, date rollover, plus actual client idempotence. Combined CI and full E2E gate A33 and A34 together.

## Measured acceptance

Actual exporter transpiled from baseline and candidate source, using a fake bridge Map only; no live files/providers. Corpus: 100 threads, four alternating user/assistant text messages each, 20 repetitions of `local fixture content ` per message. All timestamps unchanged for the single-message edit. `TZ=UTC node /home/ethan/.cache/tmp/astra-audit-20260905/library-export-probes/measure.mjs` reproduces baseline; sibling `library-export-candidate/measure.mjs` supplies complete listing and the lifecycle-backed cache. Cache directories retain scripts and JSON counts. Measurements include the global index and exclude canonical JSON persistence, which is unchanged.

| Save | Baseline writes / bytes | Candidate writes / bytes |
| --- | ---: | ---: |
| Initial | 201 / 3,134,818 | 201 / 3,134,818 |
| Unchanged, new save time | 201 / 3,134,818 | 1 / 319,098 |
| One message edited, same updatedAt | 201 / 3,134,852 | 3 / 347,264 |
| Unchanged, identical save time | 201 / 3,134,852 | 1 / 319,106 |

Candidate total bridge operations for these cases: 204, 4, 6, 4 (two mkdir, one list, remaining writes). Baseline: 204 each. No wall-latency or render-CPU claim; the index still renders/searches all text and full pair rendering establishes identity. Memory retains complete successful conversation outputs (about 2.8 MB of UTF-8 content in this fixture, not a JS heap measurement). Existing serialized persistence coordinator remains the concurrency authority; mirror pairs are still best-effort sequential writes, not an atomic filesystem transaction.

### Review correction: normalized filename collisions

Independent reviewer reproduced IDs `A` and `a` with the same title mapping to one filename. The first A33 cache implementation wrote the first thread then incorrectly skipped the second against a cached prior winner. Baseline regression failed on this exact content reversal. Rule: cache identity must respect output destination aliasing within the current save. Detect duplicate basenames and never cache or skip those pairs; preserve existing ordered last-write behavior. This repairs the optimization regression; it does not claim to solve the pre-existing filename collision design. Final gates rerun after correction.

Final acceptance after collision correction: `npm run ci` passed 1,358 tests, typecheck and lint (log `/home/ethan/.cache/tmp/astra-library-ci-collision-fixed.log`). `CI= TMPDIR=/home/ethan/.cache/tmp/astra-audit-20260905/library-e2e-tmp GATESAI_E2E_DESKTOP_PORT=15431 GATESAI_E2E_WEB_LITE_PORT=15432 npm run test:e2e -- --workers=2 --retries=0 --output=/home/ethan/.cache/tmp/astra-audit-20260905/library-e2e-collision-fixed` passed all 144 checks outside the sandbox (log `/home/ethan/.cache/tmp/astra-library-e2e-collision-fixed.log`). No tracked runtime-observation output changed. No Rust, deployment, live workspace files, or provider work.

# Preserve unreadable HTML artifact registries

A32 reproduces a destructive read-failure path: an unavailable index followed
by unavailable folder listing becomes a successful empty registry, then a
write replaces the old metadata. The root synthetic source probe reproduced
this without touching a real workspace.

## Design before source changes

Recurrence: inaccessible data is treated as absent, as in A29 save loading.
Spine: separate positively observed absence from failed acquisition.
Context: existing registry, tool outcomes and Bridge file operations; no schema
change, new service, live Bridge activation or file renaming.
Decision: require a complete nonrecursive listing before initializing metadata.

Bridge `server.go` emits operation_failed for all operation errors. No freeform
error string proves absence. `fsops.List` uses os.ReadDir for nonrecursive
requests and reports truncation; workspace-root responses use /workspace/.
If the HTML folder list fails, inspect only its fixed parents. An existing
child in a complete parent listing preserves the failure. Only a complete
listing omitting that child proves absence. Malformed/truncated responses
never authorize initialization. A visible index.json after a failed read
also refuses. Empty existing index content refuses; explicit versioned empty
JSON remains a valid registry.

Legacy migration formerly sanitized filenames into IDs without moving files,
while htmlArtifactPath always reads <id>.html. Preserve and refuse noncanonical
HTML filenames rather than create broken references or rename user files.
Canonical <valid-id>.html files migrate with their original identity.

Interaction lens: read failure must not turn list/create/update into writes.
Adversarial lens: permission errors, missing paths, partial listings, invalid
entries, unsafe legacy names and empty files must preserve metadata and files.
Running-system lens: use exact Bridge response shapes and production loader
and tool execution in fixtures; verify desktop-mocked and Web Lite suites.

The Bridge offers no conditional create/CAS operation: a concurrent external
writer racing a proved absence remains an existing limitation. This slice
makes no transactional-isolation claim.

## Execution corrections

Current session end releases that holder's leases. End both actual holders
with session end and inspect receipts; do not issue redundant lease release,
which may sweep unrelated parked branches. A31's unittest receipt was 1,504
run with one skip: 1,503 passed, not 1,504 passed plus a skip.

Root review adopts refusing empty existing indexes; prior blank-is-empty
behavior can erase interrupted-write evidence. Preserve explicit empty JSON.

## Verified candidate

Initial focused registry/tool tests passed 90 cases. Added three production
tool refusal cases for list/create/update; each proves fs.read was attempted
and no mutation followed. Final combined-tree `npm run ci` passed 1,347 tests,
typecheck and lint. Log: `/home/ethan/.cache/tmp/astra-registry-final-ci.log`.

`GATESAI_E2E_DESKTOP_PORT=15503 GATESAI_E2E_WEB_LITE_PORT=15504 npm run test:e2e -- --workers=2 --retries=0`
passed all 144 desktop-mocked and Web Lite checks with zero retries (2.5 minutes).
The mocked registry artifact opened from palette into dock. Existing blank
index scenarios now report the intended recovery error; they no longer claim
successful empty metadata. No live Bridge or user workspace was used.
Log: `/home/ethan/.cache/tmp/astra-registry-e2e.log`.

Root requested the CI-verified checkpoint before refreshing master. Commit
c66dbe5 preserves that candidate; normal merge 67a259b includes A30 master
f62f55b and retains both changelog entries. A30 generated journeys, vendor
package and lockfile remain byte-identical to that master. The only subsequent
source-test edit asserts the production tool reached fs.read before refusal.

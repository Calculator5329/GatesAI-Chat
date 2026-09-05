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

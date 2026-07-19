# ADR: Local-first persistence; Firestore / cloud sync parked behind a provider boundary

- Status: Accepted
- Date: 2026-07-18
- Scope: standing decision, retroactively recorded
- Related: `docs/architecture.md` (Persistence),
  `src/services/persistence/`, `docs/purpose.md`

## Context

GatesAI Chat is a **local-first** desktop workspace: chat state, secrets, and
workspace files live on the user's machine and never require a network. An
early and recurring temptation is to add cloud sync (historically framed as a
Firestore backend) so threads follow the user across devices. The product
direction (`docs/purpose.md`) treats cloud as strictly opt-in and local-only as
the permanent default, so a cloud store must never become load-bearing for the
base experience.

At the same time, the code should not calcify around browser storage. The
persistence stack already spans a hot `localStorage` snapshot
(`gatesai.state.v1`, `schemaVersion: 2`), an IndexedDB archive for overflow
threads (`gatesai-chat`/`threads`), versioned migrations
(`persistence/migrations.ts`), corruption quarantine, emergency compaction, and
a desktop bridge workspace mirror (`/workspace/.gatesai/chat/state.v1.json`
plus a readable `chat-history` export). A `PersistenceProvider<T>` boundary was
added specifically so a different repository (IndexedDB, or a cloud store) can
be swapped in without rewriting stores.

## Decision

Persistence stays **local-first and offline-complete**. A synchronizing cloud
backend — Firestore specifically, and hosted always-on sync generally — is
**parked**: intentionally not built now, but kept swappable.

Concretely:

1. Every store reads and writes through the `PersistenceProvider<T>` boundary
   (or the higher-level persistence services), never a concrete cloud client.
   No store may import or assume a network-backed repository.
2. The default and only shipping repositories are local: `localStorage`
   snapshot, IndexedDB archive, and — on desktop — the bridge workspace mirror.
   The full feature set must work with the network permanently off.
3. Any future cloud sync arrives as a **new provider implementation behind the
   existing boundary** and as an explicit, off-by-default opt-in — matching the
   roadmap's Cloud track (E2E-encrypted sync to user-owned storage). It must not
   become a prerequisite for any base feature, must not weaken the secrets model
   (`secretStorage.ts` keychain on desktop), and must ship with its own ADR.
4. "Firestore" is recorded here as the parked option, not a committed choice.
   The Cloud roadmap explicitly favors E2E-encrypted, user-owned storage
   (S3/Drive/WebDAV with a user-held key); a Google-hosted document store would
   have to re-clear that bar in its own ADR before adoption.

## Consequences

- No cross-device sync today; users move data via readable HTML/Markdown
  exports and (later) the opt-in Cloud track. This is an accepted trade for
  zero cloud dependency, zero server cost, and a genuinely private default.
- The `PersistenceProvider<T>` seam carries a small indirection cost that would
  otherwise be unnecessary for a purely-local app; it is retained deliberately
  as the option value that keeps cloud parked-but-reachable.
- Reviewers should reject any change that makes a network store load-bearing,
  that bypasses the provider boundary, or that routes secrets through a cloud
  path — those re-open a decision this ADR closes.
- Unparking requires a follow-up ADR covering the concrete backend, the
  encryption/ownership model, the opt-in UX, and migration.

## Rejected alternatives

- **Build Firestore sync now.** Adds a hosted dependency and a Google account
  coupling to a local-first product, contradicts the local-only default, and
  pre-commits to a backend the Cloud track's encryption/ownership requirements
  may rule out. Deferred, not designed in.
- **Drop the provider boundary and hard-code local storage.** Removes the small
  indirection cost but forecloses cloud/IndexedDB swaps and would force store
  rewrites later; the boundary is cheap insurance for a likely future.
- **Cloud-first with a local cache.** Inverts the product's privacy default and
  makes the network load-bearing — a non-starter for this app.

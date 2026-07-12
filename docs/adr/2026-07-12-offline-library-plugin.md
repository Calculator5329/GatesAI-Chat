# ADR: Offline Library desktop plugin boundary

- Status: Accepted
- Date: 2026-07-12
- Host contract: `local.offline-library` 1.3.0 / schema 1

## Context

GatesAI needs optional read-only access to the sibling Offline Library host for
cited local search, public database schemas, task-aware profiles, and sanitized
Knowledge Arena summaries. The host listens on loopback, but allowing the
WebView to fetch an arbitrary loopback URL would turn browser code into a local
network proxy and would make Web Lite behavior ambiguous.

The integration must stay swappable, offline-graceful, citation-preserving,
and incapable of database mutation, arbitrary SQL, arbitrary filesystem reads,
or remote-model fallback.

## Decision

GatesAI will use a dedicated Tauri module for Offline Library. It will not use
the Go workspace bridge, the model-facing `fetch_page` command, direct WebView
HTTP, or an automatically discovered MCP server.

The desktop command surface will expose two typed operations:

1. A read operation whose resource is an enum covering plugin metadata,
   health/status, sources, public database catalog, one approved public schema,
   profiles, and Knowledge Arena summaries.
2. A search operation with a bounded query, result limit, declared retrieval
   mode, and Kiwix inclusion flag.

Neither operation accepts a URL, path, HTTP method, header map, SQL statement,
or filesystem path. The Rust client owns the only base URL:
`http://127.0.0.1:8892/api/v1`. It will reject redirects, cap each response at
1,000,000 bytes, apply finite connect/total timeouts, require JSON, validate
public-schema aliases, and map host absence/version errors into typed states.
Only endpoints declared by the validated plugin manifest are reachable.

The TypeScript service will call these commands only when `isTauri` is true.
Web Lite returns a stable desktop-only unavailable state and never attempts a
loopback request. The addon starts disabled until the user explicitly enables
it; enabling performs manifest discovery and requires schema 1 plus a
compatible 1.x plugin version. It stores no secret and creates no cloud
dependency.

Citation identifiers returned by the host—including `kiwix://`, `library://`,
`man:`, and `db://`—are opaque evidence references. GatesAI must preserve their
exact strings through tool results, message content parts, persistence, export,
and rendering. Benchmark trust values remain labeled grounding proxies; the
consumer must not relabel them as factual hallucination rates.

## Threat model and invariants

- The WebView cannot choose a host, port, route, method, or redirect target.
- Only `127.0.0.1:8892` is used; hostname resolution and LAN access are absent.
- Private and restricted database aliases are indistinguishable from missing
  aliases to the consumer.
- Search and schema access are read-only and bounded; management and row-query
  operations are outside this decision.
- Raw benchmark answers, evidence passages, filesystem paths, and private data
  never enter GatesAI fixtures or summaries.
- Offline, disabled, incompatible, and healthy are distinct user-visible
  states. No failure silently routes to a remote provider.
- Profiles are task-aware suggestions with evidence, limitations, and explicit
  user override—not a universal default-model claim.

## Contract fixture

The sanitized fixture under `tests/fixtures/offline-library/v1.3/` is copied
from local-ai-lab host commit `6be9fb6`. It pins the manifest, profile, and
Knowledge Arena shapes used to build the consumer. Static contract tests guard
the version, transport constraints, task-aware selections, and publication-safe
exclusions. A live matching-host smoke remains required for final acceptance.

## Consequences

The dedicated module duplicates a small amount of HTTP plumbing, but gives the
desktop integration a narrower authority than existing generic facilities.
Adding a host operation requires coordinated manifest, Rust enum, TypeScript
type, test-fixture, and UI/tool changes. Web Lite remains fully usable without
the addon. Rust unit tests, frontend tests, desktop/Web Lite E2E, and a live
local smoke are required before the integration is declared complete.

## Rejected alternatives

- **Direct WebView fetch:** exposes loopback networking to browser code and
  complicates Web Lite/CORS behavior.
- **`fetch_page`:** accepts model-supplied URLs and permits validated redirects;
  that authority is intentionally broader than this plugin needs.
- **Go workspace bridge:** its responsibility is jailed workspace and command
  access, not a fixed desktop-host plugin transport.
- **Auto-discovered MCP:** adds process/configuration authority and duplicates
  a versioned local manifest without improving this read-only boundary.

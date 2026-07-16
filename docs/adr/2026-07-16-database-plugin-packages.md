# ADR: data-only database plugin packages

- Status: proposed contract, review branch
- Date: 2026-07-16
- Decision owner: GatesAI maintainers
- Scope: schema 1 package and trust boundary only

## Context

GatesAI needs installable reference data that agents can query without gaining
code execution, arbitrary SQL, network, filesystem, provider-routing, or prompt
authority. The accepted Offline Library integration already demonstrates a
fixed-authority, read-only evidence boundary, but its loopback service is not a
portable package format and must not be weakened or auto-discovered.

This ADR defines the contract consumed by later installer, store, and UI work.
It does not install packages, open SQLite, invoke Tauri, add a catalog, or wire
data into a model prompt.

## Decision

### Package shape

A `.gatesdb` file is a data-only archive with this logical structure:

```text
plugin.json                  required canonical schema-1 manifest
checksums.json               required digest of every payload file
data/<dataset>.sqlite        immutable SQLite data
indexes/...                  optional declared indexes
LICENSES/...                 required license and provenance material
SIGNATURES/...               optional detached publisher signature
```

The installer defined by later work must reject missing required files,
absolute paths, `..`, empty/dot path segments, backslash paths, duplicate
paths, symlinks, device files, executable payloads, digest mismatches, and
archives whose actual counts or expanded size differ from the manifest. It
must stream extraction under hard limits rather than trust archive headers.

Schema 1 permits no scripts, native libraries, HTML, migrations, triggers,
arbitrary SQL/query templates, secrets, package-supplied network endpoints,
or executable lifecycle hooks. `update.url` is catalog metadata for a future
host-controlled HTTPS downloader; it is never an endpoint callable by package
content or a model.

### Manifest and query contract

`src/core/databasePlugins.ts` is the canonical schema-1 parser. It accepts only
the declared keys and pins:

- immutable plugin identity and semantic version;
- minimum host and schema versions;
- publisher and provenance display metadata;
- compressed, expanded, and file-count declarations;
- one or more SQLite datasets under `data/`;
- declared scalar fields and stable record-ID field;
- named lookup/search projections with typed, bounded scalar parameters;
- an explicit projection of result fields, result count, and transcript size;
- citation namespace, SPDX/license notice, catalog identity, and HTTPS update
  metadata;
- `local_only` or `cloud_allowed` as the author's maximum data policy;
- only `catalog.read`, `schema.read`, `lookup.read`, and `search.read`.

No runtime SQL appears in the manifest. A later immutable SQLite engine owns
the query builders and may expose only the named projections. Package rows are
untrusted evidence, not instructions, and cannot grant tools, install another
package, create a schedule, select a provider, write memory, or edit prompts.

### Bounds

The host maximums are:

| Boundary | Maximum |
| --- | ---: |
| Compressed archive | 256 MiB |
| Expanded archive | 1 GiB |
| Files | 100 |
| Results per lookup/search | 50 |
| Transcript characters per query | 32,000 |

Manifest declarations may be stricter but never looser. String query
parameters require a maximum length; numeric parameters require finite lower
and upper bounds. Result fields must be declared dataset fields. These checks
are necessary but not sufficient: the future Tauri installer and query engine
must independently enforce actual archive, row, and transcript limits.

### Transport and data policy

Install, update, enable, and archive remain explicit user actions. An agent or
catalog result may create a visible proposal but cannot download or enable a
package. A future downloader must use a host-controlled allowlist of shipped or
user-added HTTPS catalogs, reject redirects and credentials, stage content,
verify it, and atomically promote a version under app data. The WebView cannot
select an arbitrary host, path, method, destination, or redirect.

`local_only` content may enter only a local-model request. `cloud_allowed`
means the publisher permits cloud use; it does not opt the user in. Users may
tighten a package to local-only but cannot loosen the publisher's declaration.
A route/data-policy mismatch is a visible blocked state and never triggers a
provider fallback. Web Lite cannot install or query desktop packages.

### Checksums, signatures, and trust labels

Checksums prove payload integrity relative to `checksums.json`; they do not
prove publisher identity. A detached Ed25519 signature may identify a signer
fingerprint after cryptographic verification, but the package cannot declare
itself trusted.

The UI contract has four honest states: unsigned, invalid signature,
signature verified but signer not trusted, and signature verified by an
explicitly trusted signer. Only a separately persisted user/catalog trust
decision may produce the last state. Mandatory trust roots, revocation, and
signed catalogs are later scope. An invalid signature fails installation;
unsigned and verified-untrusted policy remains a future lifecycle decision and
must be displayed before approval.

## Consequences

- The parser is pure and usable by tests, author tooling, and later service
  boundaries without importing React, MobX, Tauri, or network code.
- Strict schema-1 keys fail closed against executable hooks and undeclared
  authority. A future schema change requires a new parser/ADR decision.
- Later archive validation must compare declared metadata with actual staged
  bytes; parsing `plugin.json` alone never makes a package safe.
- Later SQLite access must be immutable/read-only with defensive settings and
  host-defined query builders. The generic workspace `sqlite_query` tool is
  not reused.
- The existing Offline Library remains its accepted fixed-host
  `loopback_service` adapter and is not repackaged or auto-discovered.

## Verification

`tests/core/databasePlugins.test.ts` covers a valid manifest plus hostile
unknown hooks, schema drift, capabilities, credentialed/non-HTTPS URLs, path
traversal, executable dataset paths, undeclared result fields, unbounded
parameters, duplicates, size/result/transcript limits, capability mismatch,
and signature trust labels. Tauri/archive/SQLite tests belong to the dependent
engine Item, not this contract lane.

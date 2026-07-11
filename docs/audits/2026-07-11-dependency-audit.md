# Dependency audit — 2026-07-11 (overnight loop)

## npm — CLEAN after `npm audit fix`
Before: 10 vulnerabilities (2 low, 4 moderate, 3 high, 1 critical — the
critical/high were dev-dependency chains; prod exposure was 2 moderate).
`npm audit fix` (non-breaking) cleared everything: **0 vulnerabilities**.
Full `npm run ci` (1,040 tests + typecheck + lint) green after the fix.
Note: npm flagged esbuild@0.28.1's postinstall for allow-scripts review.

## cargo — 3 advisories, all transitive via tauri stack (follow-up needed)
- RUSTSEC-2026-0194 / 0195 — quick-xml 0.38.4 (quadratic dup-attr check;
  NsReader namespace-alloc DoS). Bump via `cargo update -p quick-xml` if the
  tauri tree permits ≥ the patched release.
- RUSTSEC-2026-0185 — quinn-proto 0.11.14 (remote memory exhaustion,
  out-of-order stream reassembly). Same treatment.
- Plus ~20 unmaintained-crate warnings (atk/gtk3 bindings — inherent to
  tauri v2 GTK3 on Linux; no action available upstream yet).

Follow-up: attempt targeted `cargo update` for the three RUSTSECs and rerun
`cargo audit` + the tauri build; do NOT jump major versions of the tauri
stack for this.

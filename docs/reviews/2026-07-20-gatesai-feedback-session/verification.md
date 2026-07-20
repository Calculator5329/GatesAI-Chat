# Verification record

Prepared 2026-07-20 for the GatesAI owner feedback session.

## Forge lifecycle

- Registered task: `gatesai-owner-feedback-session-20260720`.
- The initial isolated Claude split-plan run failed closed on the plan-structure
  verifier: `Signatures section must contain a non-trivial list`. It wrote no
  product changes and was not integrated.
- A bounded reply was attempted, then correctly safety-blocked because the
  parent environment could not authorize sending more private workspace context
  to the external provider.
- The local interactive session held explicit leases for every changed path and
  used Forge's versioned externally-managed plan/result contract to attach Git
  and command evidence without launching or claiming a provider process.
- External plan digest:
  `sha256:7acfde807577a712543409fe2230ef349f16447f6d4c3029c568ee918604538f`.
- The first attachment also failed closed because its signed base used the
  movable `master` name, which advanced on commit. Version 2 pins the original
  commit through `codex/gatesai-owner-review-base-20260720`; no history was
  rewritten and the superseded cancelled record remains visible as friction.

This failure is intentionally preserved as part of the dogfood session. The
review system should make a failed planner understandable without making the
owner reconstruct the implementation history.

## Mechanical verification

- all six registered acceptance commands: passed;
- `artifacts.json`: valid Forge `{ "items": [...] }` schema, three items in
  the `review-flow` choice group, every referenced file present;
- every HTML mode: all seven required `data-area` sections present;
- offline guard: no network APIs, external assets, submitting forms, or remote
  addresses in the HTML artifacts;
- change scope: only the four claimed path prefixes changed.

## Browser verification

Local Chromium opened each HTML file directly from disk and exercised its real
interaction path at desktop size, then checked mobile width at 390 × 844.

| Artifact | Areas | Interaction exercised | Script errors | Mobile overflow |
| --- | ---: | --- | ---: | ---: |
| Guided missions | 7 | complete mission + build transcript | 0 | no |
| Evidence board | 7 | rate card + build evidence review | 0 | no |
| Speech-first deck | 7 | advance card + build transcript | 0 | no |

The first guided-missions browser pass found a too-wide comparison table on
mobile. The rubric now scrolls inside its own region, and the repeated browser
check reports no page overflow.

## Live-system uncertainty

- Visions was not listening on its normal local address during preparation, so
  the runbook documents the route but tomorrow's session remains the real test
  of structured write-back.
- No paid model-compat probe or live Brave research was launched for this docs
  package. Their existing durable reports and product tests are the evidence;
  live credentials and provider behavior still need hands-on confirmation.
- The HTML files intentionally do not save or submit notes. This makes the
  experiment honest, but means closing the page loses uncopied reactions.

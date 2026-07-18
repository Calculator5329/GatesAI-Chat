# Follow-up source task

## title

Use registry titles for HTML artifact preview accessibility names

## goal

Fix the pre-existing `artifactContract.spec.ts` desktop-mocked E2E failure by making `HtmlArtifactPreview` use its supplied human label for inline and fullscreen accessibility names while retaining the path-derived filename for downloads and as the no-label fallback. Keep the existing E2E selector and iframe security policy unchanged. Add focused component assertions for label propagation and verify the named E2E outside the port-restricted sandbox.

## owns

- `src/components/editorial/HtmlArtifactPreview.tsx`
- `tests/components/editorial/HtmlArtifactPreview.test.ts`

## context

- `docs/plans/unblock-fix-pre-existing-e2e-failure-artifactcon-20260718/PLAN.md`
- `tests/e2e/artifactContract.spec.ts` (read-only acceptance test; do not change)

## implementation

1. Preserve the path-derived filename for download behavior.
2. Derive a display name from `label || filename`.
3. Use that display name in the preview bar, inline iframe title, fullscreen dialog label, and fullscreen iframe title.
4. Add unit assertions proving a supplied label controls inline and fullscreen accessibility names. Preserve existing filename fallback behavior.
5. Do not touch registry, dock, bridge, CSP/sandbox, roadmap, or changelog files.

## test-cmd

```sh
NODE_ENV=test npm test -- --run tests/components/editorial/HtmlArtifactPreview.test.ts && npm run typecheck && npx playwright test tests/e2e/artifactContract.spec.ts --project=desktop-mocked
```

Run additionally before integration:

```sh
NODE_ENV=test npm run ci && npm run test:e2e
```

Playwright verification must run in an environment allowed to bind the configured Vite ports.

## acceptance

- The unchanged E2E finds `iframe[title="Preview of Status board"]` after opening the registry artifact from the palette.
- A labelled component preview uses the label for inline and fullscreen accessibility names.
- An unlabelled component preview still falls back to its filename.
- Download naming and `HTML_ARTIFACT_IFRAME_SANDBOX` behavior remain unchanged.

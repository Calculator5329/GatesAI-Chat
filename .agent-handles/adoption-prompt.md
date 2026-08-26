# Agent Handles adoption prompt — gatesai-chat

You are the project-specific editor. Deterministic Agent Handles code owns
detection and verification; you own source inspection, identity naming, and
journey authoring. Never edit generated evidence to manufacture success.

Measured project facts:
- framework: react
- Vite: ^8.0.9
- source root: src
- detected routes: /workspace
- existing identity areas: dock-media-viewer-notice (5), task-center-panel (2), aurora-diff-card (1), command-palette-backdrop (1), dock-file-explorer (1), dock-file-viewer-html (1), dock-file-viewer-json (1), dock-file-viewer-markdown (1)
- wrapper candidates for review: AttachButton, ComposerInput, GridTile, SkillRow
- control candidates: 223 total, 195 definite, 28 review-required, 223 unresolved
- invalid or legacy identities requiring migration: 27

## Phase 1 — identity

Edit vite.config.ts:
- import { agentHandles } from "agent-handles/vite";
- agentHandles(),
- Add the import with the other imports, then add agentHandles() to the existing plugins array. Preserve every existing plugin and option.

Migrate every invalid or legacy identity below. Replace it with a stable
area.component.element[.qualifier] identity, update every source/test/journey
reference, and record the relationship in agent-handles.json under
identityRenames as either "old-id": "area.component.element" or an object
with target and reason. When one reused legacy selector must split into several
unique identities, use an object with targets and a reason. If the addressed surface was deliberately removed,
record identityTombstones with a non-empty reason instead. Never silently
delete or reuse an old identity, and never edit the generated registry to hide
one. Renames and tombstones are verified against the prior registry.

Invalid or legacy identities:
- src/components/dock/DockPanel.tsx:68 data-testid="dock-collapsed-rail" (literal)
- src/components/dock/DockPanel.tsx:68 data-testid="dock-panel" (literal)
- src/components/dock/DockPanel.tsx:102 data-testid="dock-cell-*" (pattern)
- src/components/dock/FileExplorerPanel.tsx:89 data-testid="dock-file-explorer" (literal)
- src/components/dock/FileViewerPanel.tsx:51 data-testid="dock-file-viewer-notice" (literal)
- src/components/dock/FileViewerPanel.tsx:60 data-testid="dock-file-viewer-markdown" (literal)
- src/components/dock/FileViewerPanel.tsx:72 data-testid="dock-file-viewer-json" (literal)
- src/components/dock/FileViewerPanel.tsx:79 data-testid="dock-file-viewer-html" (literal)
- src/components/dock/FileViewerPanel.tsx:85 data-testid="dock-file-viewer-text" (literal)
- src/components/dock/HtmlArtifactPanel.tsx:18 data-testid="dock-html-artifact" (literal)
- src/components/dock/MediaViewerPanel.tsx:14 data-testid="dock-media-viewer-notice" (literal)
- src/components/dock/MediaViewerPanel.tsx:26 data-testid="dock-media-viewer-notice" (literal)
- src/components/dock/MediaViewerPanel.tsx:29 data-testid="dock-media-viewer-notice" (literal)
- src/components/dock/MediaViewerPanel.tsx:32 data-testid="dock-media-viewer-image" (literal)
- src/components/dock/MediaViewerPanel.tsx:60 data-testid="dock-media-viewer-notice" (literal)
- src/components/dock/MediaViewerPanel.tsx:63 data-testid="dock-media-viewer-notice" (literal)
- src/components/dock/MediaViewerPanel.tsx:66 data-testid="dock-media-viewer-*" (pattern)
- src/components/dock/TaskCenterPanel.tsx:25 data-testid="task-center-panel" (literal)
- src/components/dock/TaskCenterPanel.tsx:33 data-testid="task-center-panel" (literal)
- src/components/editorial/aurora/DiffCard.tsx:20 data-testid="aurora-diff-card" (literal)
- src/components/editorial/aurora/FineTuneCard.tsx:44 data-testid="finetune-card" (literal)
- src/components/editorial/HtmlArtifactPreview.tsx:26 data-testid="inline-html-preview" (literal)
- src/components/editorial/HtmlArtifactPreview.tsx:63 data-testid="inline-html-document-card" (literal)
- src/components/editorial/PromptCards.tsx:19 data-testid="prompt-cards" (literal)
- src/components/menu/sections/api/ApiSection.tsx:44 data-testid="search-card" (literal)
- src/components/palette/CommandPalette.tsx:229 data-testid="command-palette-backdrop" (literal)
- src/components/palette/CommandPalette.tsx:290 data-testid="palette-empty" (literal)

Inspect every definite and review-required candidate. Give every actual control
a stable identity using area.component.element[.qualifier]. A shared wrapper must
forward a testId prop, and each call site must provide the distinct identity.
For a review-required site that is not a control or is unreachable in the
declared journey scope, add a structured controlJudgments entry to
agent-handles.json with judgment, evidence, at least two options, and a
proposal. Such a scope reduction remains needs-owner-verdict until the owner
records a choice.

Review-required candidates:
- candidate:06856809e99ebf09 — src/components/dock/DockPanel.tsx:87 <div> (handler:onPointerDown)
- candidate:f8652316cd16ec28 — src/components/dock/DockPanel.tsx:106 <div> (handler:onPointerDown)
- candidate:c897fe674ea75351 — src/components/dock/TaskCenterPanel.tsx:80 <article> (tabIndex, handler:onClick, handler:onKeyDown)
- candidate:6ea5145af0fbea78 — src/components/editorial/BridgeStatusPill.tsx:51 <div> (tabIndex, handler:onClick, handler:onKeyDown)
- candidate:20fa72c70f84ccc8 — src/components/editorial/composer/ComposerInput.tsx:74 <AttachButton> (handler:onClick)
- candidate:051da806b6368e3f — src/components/editorial/composer/SkillPopover.tsx:48 <SkillRow> (handler:onClick)
- candidate:ad6ed8e830da209c — src/components/editorial/composer/SkillPopover.tsx:56 <SkillRow> (handler:onClick)
- candidate:aa670016417f9500 — src/components/editorial/EditorialComposer.tsx:238 <ComposerInput> (handler:onKeyDown)
- candidate:9c20d38c378f3c97 — src/components/editorial/EditorialMessage.tsx:191 <div> (handler:onClick)
- candidate:3d9a5205562012c7 — src/components/editorial/EditorialMessage.tsx:225 <div> (handler:onClick)
- candidate:6c29291ada8edb4d — src/components/editorial/EditorialMessage.tsx:270 <div> (handler:onClick)
- candidate:26c5a378b22eb01b — src/components/editorial/EditorialMessage.tsx:307 <div> (handler:onClick)
- candidate:609772c70f598469 — src/components/editorial/EditorialSidebar.tsx:277 <div> (role:button, tabIndex, handler:onClick, handler:onKeyDown)
- candidate:e5600e3f9be0de48 — src/components/editorial/EditorialSidebar.tsx:448 <div> (role:button, tabIndex, handler:onClick, handler:onKeyDown)
- candidate:1d03a94aff783269 — src/components/editorial/EditorialSidebar.tsx:575 <div> (handler:onClick)
- candidate:846e1589569e340f — src/components/editorial/EditorialSidebar.tsx:619 <div> (handler:onClick)
- candidate:405530ea36bdaa37 — src/components/editorial/HtmlArtifactPreview.tsx:170 <span> (role:button, tabIndex, handler:onClick, handler:onKeyDown)
- candidate:3fdb1da7f7d72cfe — src/components/editorial/ImageJobCard.tsx:282 <GridTile> (handler:onClick)
- candidate:5d38b206a4783f6d — src/components/editorial/ModelPopover.tsx:226 <div> (role:option, handler:onClick)
- candidate:2e1bd7333d815317 — src/components/editorial/ModelPopover.tsx:386 <div> (handler:onKeyDown)
- candidate:0c8a1b5395761d75 — src/components/editorial/PromptCards.tsx:71 <form> (handler:onSubmit)
- candidate:194be6858582aef4 — src/components/editorial/SidebarSettingsButton.tsx:45 <span> (tabIndex, handler:onClick, handler:onKeyDown)
- candidate:2ff88ac3bc6ecd0d — src/components/editorial/UpdatePill.tsx:46 <span> (tabIndex, handler:onClick, handler:onKeyDown)
- candidate:a20b6b158501520b — src/components/media/Lightbox.tsx:57 <div> (handler:onClick)
- candidate:a0b1c1d9a2e1276a — src/components/media/Lightbox.tsx:122 <div> (handler:onClick)
- candidate:567d4ff2d1e9c073 — src/components/palette/CommandPalette.tsx:227 <div> (handler:onClick, legacy-id:command-palette-backdrop)
- candidate:bde9964b1d1e5842 — src/components/palette/CommandPalette.tsx:235 <div> (handler:onClick, handler:onKeyDown)
- candidate:585aa3d5bf5451c8 — src/components/whats-new/WhatsNewPanel.tsx:50 <div> (handler:onMouseDown)

Run npx agent-handles scan check and npx agent-handles ratchet check
until every candidate is resolved. Do not remove handlers, roles, routes, or
controls to improve the denominator. Do not weaken the predicate or raise a
ratchet floor.

## Phase 2 — journeys

Start only after phase 1 is clean. Explore the running app and author meaningful
control-path journeys plus any explicitly labeled URL-path journeys. Runtime
observation is path-bound evidence: report “N controls observed during M
journeys, zero unidentified,” never an exhaustive runtime percentage. Compile
the manifest and run the configured journey verification twice.

Finish with npx agent-handles adopt verify. A narrated claim is never a
measurement; the durable adoption receipt is the handoff.

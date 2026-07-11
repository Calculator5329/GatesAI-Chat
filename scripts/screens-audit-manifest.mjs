/**
 * Source-audited screenshot corpus. Keep this list in sync with routes in
 * src/services/router.ts and overlays/panels under src/components.
 */
export const SCREEN_AUDIT_MANIFEST = [
  { file: 'screen-chat-onboarding.png', surface: 'Chat — first-run onboarding' },
  { file: 'screen-chat-empty.png', surface: 'Chat — empty conversation' },
  { file: 'screen-chat-active.png', surface: 'Chat — populated conversation' },
  { file: 'screen-chat-tool-activity.png', surface: 'Chat — tool activity panel' },
  { file: 'screen-chat-message-edit.png', surface: 'Chat — edit message panel' },
  { file: 'screen-chat-regenerate-confirm.png', surface: 'Chat — regenerate confirmation panel' },
  { file: 'screen-sidebar-mobile-open.png', surface: 'Sidebar — mobile drawer open' },
  { file: 'screen-menu-settings.png', surface: 'Menu route — Settings' },
  { file: 'screen-menu-usage.png', surface: 'Menu route — Usage' },
  { file: 'screen-menu-agent.png', surface: 'Menu route — Agent' },
  { file: 'screen-menu-models.png', surface: 'Menu route — Models' },
  { file: 'screen-menu-local.png', surface: 'Menu route — Local' },
  { file: 'screen-menu-workspace.png', surface: 'Menu route — Workspace' },
  { file: 'screen-menu-gallery.png', surface: 'Menu route — Gallery' },
  { file: 'screen-palette-default.png', surface: 'Command palette — default results' },
  { file: 'screen-palette-empty.png', surface: 'Command palette — no results' },
  { file: 'screen-picker-model.png', surface: 'Model picker popover' },
  { file: 'screen-picker-skill.png', surface: 'Workspace skill picker popover' },
  { file: 'screen-modal-gallery-lightbox.png', surface: 'Gallery image lightbox' },
  { file: 'screen-modal-html-artifact.png', surface: 'HTML artifact full-screen preview' },
  { file: 'screen-modal-whats-new.png', surface: 'What’s New modal' },
  { file: 'screen-panel-settings-confirm.png', surface: 'Settings danger-zone confirmation' },
];

// Structured, version-keyed release notes for the in-app what's-new panel.
// Kept as app data rather than parsing the Markdown changelog at runtime.

export interface WhatsNewItem {
  title: string;
  detail: string;
}

export interface WhatsNewRelease {
  version: string;
  items: readonly WhatsNewItem[];
}

export const WHATS_NEW_RELEASES: readonly WhatsNewRelease[] = [
  {
    version: '4.6.0',
    items: [
      {
        title: 'The app updates itself now',
        detail: 'When a new version ships, a pill appears in the sidebar — one click downloads it in the background and a restart finishes the job. No more manual downloads.',
      },
      {
        title: 'A right dock for your files',
        detail: 'Open workspace files beside the chat: rendered markdown, collapsible JSON, sandboxed HTML, images, and media in up to two stacked, resizable panels. Try “Open file in dock…” in the command palette (Ctrl+K).',
      },
      {
        title: 'True fullscreen',
        detail: 'Press F11 (or use the command palette) to take the whole screen, on Linux and Windows alike.',
      },
      {
        title: 'Smoother, sturdier chat',
        detail: 'Scroll-follow no longer gets stuck, code blocks keep their copy/preview state while a reply streams, and image-generation failures now explain what went wrong — and are recorded to a persistent error log for diagnosis.',
      },
    ],
  },
  {
    version: '4.5.0',
    items: [
      {
        title: 'A sturdier bridge connection',
        detail: 'The desktop bridge now uses its v2 handshake, making local workspace connection checks more reliable.',
      },
      {
        title: 'A faster chat turn',
        detail: 'Wave D performance work trims the work around streaming, tool calls, and message rendering.',
      },
      {
        title: 'History organized by date',
        detail: 'The sidebar groups conversations into Today, Yesterday, recent weeks, and monthly sections.',
      },
    ],
  },
];

export function whatsNewForVersion(version: string): WhatsNewRelease | undefined {
  return WHATS_NEW_RELEASES.find(release => release.version === version);
}

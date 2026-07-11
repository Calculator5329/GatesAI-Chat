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

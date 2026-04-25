/**
 * Typography & layout tokens reused across surfaces.
 * Anything that has a "component shape" (button, toggle, card, …) lives in
 * `src/components/ui/` instead — these are the leftover bare style objects.
 */
export const tokens = {
  h1: {
    fontFamily: '"Source Serif 4", Iowan Old Style, Georgia, serif',
    fontSize: 28, fontWeight: 400, margin: '0 0 4px',
    color: 'var(--text)', letterSpacing: '-0.02em',
  },

  kicker: {
    fontSize: 10.5, color: 'var(--text-faint)',
    letterSpacing: '0.14em', textTransform: 'uppercase',
    marginBottom: 28,
    fontFamily: '"Geist Mono", monospace',
  },

  section: { marginBottom: 36 },

  sectionTitle: {
    fontSize: 11, color: 'var(--text-faint)',
    letterSpacing: '0.14em', textTransform: 'uppercase',
    marginBottom: 14,
    paddingBottom: 8, borderBottom: '1px solid var(--border)',
  },

  mono: { fontFamily: '"Geist Mono", monospace', fontSize: 12 },

  number: {
    fontFamily: '"Source Serif 4", Georgia, serif',
    fontSize: 34, fontWeight: 400,
    color: 'var(--text)',
    letterSpacing: '-0.02em',
    lineHeight: 1,
  },

  numberLabel: {
    fontSize: 10.5, color: 'var(--text-faint)',
    letterSpacing: '0.14em', textTransform: 'uppercase',
    marginTop: 6,
    fontFamily: '"Geist Mono", monospace',
  },
} as const;

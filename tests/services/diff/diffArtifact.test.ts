import { describe, expect, it } from 'vitest';
import { buildDiffArtifact } from '../../../src/services/diff/diffArtifact';

function diff(before: string, after: string, maxRows?: number) {
  const artifact = buildDiffArtifact('/workspace/notes/plan.md', before, after, maxRows);
  if (!artifact || artifact.kind !== 'diff') throw new Error('expected a diff artifact');
  return artifact;
}

describe('buildDiffArtifact', () => {
  it('returns null when the write changed nothing', () => {
    expect(buildDiffArtifact('/workspace/a.md', 'same\n', 'same\n')).toBeNull();
  });

  it('counts every changed line, not just the ones it kept', () => {
    const before = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
    const after = before.replace('line 5', 'LINE FIVE').replace('line 30', 'LINE THIRTY');
    const artifact = diff(before, after);
    expect(artifact.added).toBe(2);
    expect(artifact.removed).toBe(2);
    expect(artifact.path).toBe('/workspace/notes/plan.md');
  });

  it('keeps changed lines with context and drops untouched runs', () => {
    const before = Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n');
    const after = before.replace('line 30', 'CHANGED');
    const artifact = diff(before, after);
    const texts = artifact.rows.map(row => row.text);
    expect(texts).toContain('CHANGED');
    expect(texts).toContain('line 28');
    expect(texts).not.toContain('line 0');
    expect(artifact.truncated).toBe(true);
  });

  it('does not truncate a small edit it could show in full', () => {
    const artifact = diff('alpha\nbeta\n', 'alpha\ngamma\n');
    expect(artifact.truncated).toBe(false);
    expect(artifact.rows.some(row => row.type === 'added' && row.text === 'gamma')).toBe(true);
    expect(artifact.rows.some(row => row.type === 'removed' && row.text === 'beta')).toBe(true);
  });

  it('caps the row count so a whole-file rewrite stays cheap to persist', () => {
    const before = Array.from({ length: 200 }, (_, i) => `old ${i}`).join('\n');
    const after = Array.from({ length: 200 }, (_, i) => `new ${i}`).join('\n');
    const artifact = diff(before, after, 20);
    expect(artifact.rows).toHaveLength(20);
    expect(artifact.truncated).toBe(true);
    expect(artifact.added).toBe(200);
  });

  it('elides a pathologically long line instead of storing it whole', () => {
    const artifact = diff('short\n', `${'x'.repeat(5_000)}\n`);
    const longest = Math.max(...artifact.rows.map(row => row.text.length));
    expect(longest).toBeLessThan(500);
  });
});

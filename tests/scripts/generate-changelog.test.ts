import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

type ParsedCommit = {
  hash: string;
  type: string;
  scope: string | null;
  area: string;
  description: string;
  breaking: boolean;
};

type ChangelogModule = {
  parseGitLog(output: string): ParsedCommit[];
  groupCommits(commits: ParsedCommit[]): Array<{
    type: string;
    heading: string;
    commits: ParsedCommit[];
  }>;
  findLatestDatedHeading(changelog: string): { date: string; heading: string };
  formatDraftSection(commits: ParsedCommit[], date?: string): string;
  insertDraftSection(changelog: string, section: string): string;
  mapScopeToArea(scope: string | null): string;
};

const modulePromise = import('../../scripts/generate-changelog.mjs') as Promise<ChangelogModule>;
const fixturePath = path.resolve('tests/scripts/fixtures/git-log.txt');

describe('changelog generator', () => {
  it('parses supported conventional commits from fixture git-log output', async () => {
    const [{ parseGitLog }, fixture] = await Promise.all([
      modulePromise,
      readFile(fixturePath, 'utf8'),
    ]);

    const commits = parseGitLog(fixture);

    expect(commits).toHaveLength(5);
    expect(commits.map(commit => commit.type)).toEqual([
      'feat', 'fix', 'docs', 'style', 'refactor',
    ]);
    expect(commits[0]).toMatchObject({
      hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      scope: 'chat',
      area: 'Chat & conversations',
      description: 'add jump-to-latest control',
      breaking: false,
    });
    expect(commits[4]).toMatchObject({
      scope: 'bridge',
      area: 'Desktop app',
      breaking: true,
    });
  });

  it('groups parsed commits in the supported type order', async () => {
    const [{ groupCommits, parseGitLog }, fixture] = await Promise.all([
      modulePromise,
      readFile(fixturePath, 'utf8'),
    ]);

    const groups = groupCommits(parseGitLog(fixture));

    expect(groups.map(group => [group.type, group.heading, group.commits.length])).toEqual([
      ['feat', 'Features', 1],
      ['fix', 'Fixes', 1],
      ['docs', 'Documentation', 1],
      ['style', 'Visual polish', 1],
      ['refactor', 'Refactors', 1],
    ]);
  });

  it('maps composite and unknown scopes without exposing implementation labels', async () => {
    const { mapScopeToArea } = await modulePromise;

    expect(mapScopeToArea('composer/ui')).toBe('Chat & conversations');
    expect(mapScopeToArea('ollama')).toBe('Models & providers');
    expect(mapScopeToArea('internal-cache')).toBe('General');
    expect(mapScopeToArea(null)).toBe('General');
  });

  it('formats a clearly marked draft with grouped entries and short hashes', async () => {
    const [{ formatDraftSection, parseGitLog }, fixture] = await Promise.all([
      modulePromise,
      readFile(fixturePath, 'utf8'),
    ]);

    const draft = formatDraftSection(parseGitLog(fixture), '2026-07-16');

    expect(draft).toContain('## DRAFT — 2026-07-16');
    expect(draft).toContain('### Features');
    expect(draft).toContain('- **Chat & conversations:** add jump-to-latest control (`aaaaaaa`)');
    expect(draft).toContain('**BREAKING:** replace the legacy request envelope (`eeeeeee`)');
    expect(draft).not.toContain('chore(deps)');
  });

  it('finds the newest displayed dated heading', async () => {
    const { findLatestDatedHeading } = await modulePromise;
    const changelog = '# Changelog\n\n## 2026-07-16 — Newest\n\n- Entry\n\n## 2026-07-15 — Older\n';

    expect(findLatestDatedHeading(changelog)).toEqual({
      date: '2026-07-16',
      heading: '## 2026-07-16 — Newest',
    });
  });

  it('inserts a draft below the title without overwriting existing entries', async () => {
    const { insertDraftSection } = await modulePromise;
    const original = '# Changelog\n\n## 2026-07-15 — Existing\n\n- Keep this exactly.\n';
    const draft = '## DRAFT — 2026-07-16\n\n- New draft.\n';

    const updated = insertDraftSection(original, draft);

    expect(updated).toBe(
      '# Changelog\n\n## DRAFT — 2026-07-16\n\n- New draft.\n\n## 2026-07-15 — Existing\n\n- Keep this exactly.\n',
    );
    expect(() => insertDraftSection(updated, draft)).toThrow(/already exists/);
  });
});

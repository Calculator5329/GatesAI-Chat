#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFile = promisify(execFileCallback);
const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');

export const CHANGE_TYPES = [
  { type: 'feat', heading: 'Features' },
  { type: 'fix', heading: 'Fixes' },
  { type: 'docs', heading: 'Documentation' },
  { type: 'style', heading: 'Visual polish' },
  { type: 'refactor', heading: 'Refactors' },
];

const AREA_SCOPES = [
  ['Chat & conversations', [
    'chat', 'chats', 'composer', 'conversation', 'conversations', 'markdown',
    'message', 'messages', 'thread', 'threads',
  ]],
  ['Models & providers', [
    'inference', 'local', 'model', 'models', 'ollama', 'openai', 'openrouter',
    'provider', 'providers',
  ]],
  ['Workspace & tools', [
    'artifact', 'artifacts', 'dock', 'file', 'files', 'imagegen', 'mcp',
    'search', 'terminal', 'tool', 'tools', 'workspace',
  ]],
  ['Settings & appearance', [
    'appearance', 'onboarding', 'preference', 'preferences', 'prefs', 'settings',
    'theme',
  ]],
  ['Interface & navigation', [
    'a11y', 'accessibility', 'menu', 'navigation', 'palette', 'shortcut',
    'shortcuts', 'sidebar', 'ui',
  ]],
  ['Desktop app', [
    'bridge', 'desktop', 'installer', 'release', 'sidecar', 'tauri', 'updater',
  ]],
  ['Web Lite', ['browser', 'pwa', 'web', 'web-lite', 'weblite']],
  ['Documentation', ['changelog', 'docs', 'handbook', 'readme']],
  ['Developer experience', [
    'build', 'ci', 'dev', 'test', 'tests', 'tooling',
  ]],
];

const AREA_BY_SCOPE = new Map(
  AREA_SCOPES.flatMap(([area, scopes]) => scopes.map(scope => [scope, area])),
);

/** Map a conventional-commit scope to a stable, user-facing product area. */
export function mapScopeToArea(scope) {
  if (!scope) return 'General';

  const normalized = scope.trim().toLowerCase();
  if (AREA_BY_SCOPE.has(normalized)) return AREA_BY_SCOPE.get(normalized);

  // Composite scopes such as "chat/ui" should still land in a useful area.
  const parts = normalized.split(/[\/,:+\s]+/).filter(Boolean);
  for (const part of parts) {
    if (AREA_BY_SCOPE.has(part)) return AREA_BY_SCOPE.get(part);
  }

  return 'General';
}

/** Parse one supported conventional-commit subject. */
export function parseConventionalSubject(subject) {
  const match = /^(feat|fix|docs|style|refactor)(?:\(([^)]+)\))?(!)?:\s+(.+)$/.exec(subject.trim());
  if (!match) return null;

  const [, type, rawScope, breakingMarker, description] = match;
  const scope = rawScope?.trim() || null;
  return {
    type,
    scope,
    area: mapScopeToArea(scope),
    description: description.trim(),
    breaking: breakingMarker === '!',
  };
}

/**
 * Parse output produced by:
 *   git log --format=%H%x09%aI%x09%s
 *
 * A line-based format keeps fixtures readable. Git commit subjects cannot
 * contain newlines; any tabs in a subject are retained.
 */
export function parseGitLog(output) {
  const commits = [];

  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [hash, authoredAt, ...subjectParts] = line.split('\t');
    const subject = subjectParts.join('\t');
    if (!hash || !authoredAt || !subject) continue;

    const conventional = parseConventionalSubject(subject);
    if (!conventional) continue;
    commits.push({ hash, authoredAt, subject, ...conventional });
  }

  return commits;
}

/** Group commits in the fixed changelog type order. */
export function groupCommits(commits) {
  return CHANGE_TYPES.map(({ type, heading }) => ({
    type,
    heading,
    commits: commits.filter(commit => commit.type === type),
  })).filter(group => group.commits.length > 0);
}

export function findLatestDatedHeading(changelog) {
  const match = /^##[ \t]+(\d{4}-\d{2}-\d{2})(?:[ \t]+—[^\r\n]*)?[ \t]*$/m.exec(changelog);
  if (!match) {
    throw new Error('No dated "## YYYY-MM-DD" heading found in docs/changelog.md');
  }
  return { date: match[1], heading: match[0].trim() };
}

export function formatDraftSection(commits, date = localDate()) {
  const lines = [
    `## DRAFT — ${date}`,
    '',
    '<!-- Generated from conventional commits. Edit this draft before publishing. -->',
  ];

  const groups = groupCommits(commits);
  if (groups.length === 0) {
    lines.push('', '_No matching conventional commits found._');
  }

  for (const group of groups) {
    lines.push('', `### ${group.heading}`, '');
    for (const commit of group.commits) {
      const breaking = commit.breaking ? ' **BREAKING:**' : '';
      lines.push(`- **${commit.area}:**${breaking} ${commit.description} (\`${commit.hash.slice(0, 7)}\`)`);
    }
  }

  return `${lines.join('\n')}\n`;
}

/** Insert without changing or replacing any existing changelog content. */
export function insertDraftSection(changelog, section) {
  if (/^##\s+DRAFT(?:\s|—|$)/mi.test(changelog)) {
    throw new Error('A DRAFT changelog section already exists; edit or publish it before generating another');
  }

  const heading = /^# Changelog[ \t]*$/m.exec(changelog);
  if (!heading) throw new Error('Missing "# Changelog" heading');

  const insertionPoint = heading.index + heading[0].length;
  const before = changelog.slice(0, insertionPoint);
  const after = changelog.slice(insertionPoint).replace(/^\r?\n*/, '');
  return `${before}\n\n${section.trimEnd()}\n\n${after}`;
}

function localDate(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function git(args, cwd) {
  const { stdout } = await execFile('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

async function findHeadingCommit(heading, cwd) {
  const stdout = await git([
    'log', '-n', '1', '--format=%H', `-S${heading}`, '--', 'docs/changelog.md',
  ], cwd);
  return stdout.trim() || null;
}

export async function generateChangelog({ cwd = repoRoot, write = false } = {}) {
  const changelogPath = path.join(cwd, 'docs', 'changelog.md');
  const changelog = await readFile(changelogPath, 'utf8');
  const latest = findLatestDatedHeading(changelog);
  const headingCommit = await findHeadingCommit(latest.heading, cwd);
  const rangeArgs = headingCommit
    ? [`${headingCommit}..HEAD`]
    : [`--since=${latest.date}T00:00:00`];
  const log = await git([
    'log', ...rangeArgs, '--format=%H%x09%aI%x09%s',
  ], cwd);
  const commits = parseGitLog(log);
  const section = formatDraftSection(commits);

  if (write) {
    if (commits.length === 0) {
      throw new Error('No matching conventional commits found; changelog was not changed');
    }
    await writeFile(changelogPath, insertDraftSection(changelog, section), 'utf8');
  }

  return { section, commits, since: latest.date, headingCommit };
}

function printHelp() {
  process.stdout.write([
    'Usage: node scripts/generate-changelog.mjs [--write]',
    '',
    'Print a draft changelog section from supported conventional commits.',
    '--write inserts the draft immediately below "# Changelog".',
    '',
  ].join('\n'));
}

async function main(args) {
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  const unknown = args.filter(arg => arg !== '--write');
  if (unknown.length > 0) throw new Error(`Unknown argument: ${unknown[0]}`);

  const result = await generateChangelog({ write: args.includes('--write') });
  process.stdout.write(result.section);
}

if (path.resolve(process.argv[1] ?? '') === scriptPath) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`generate-changelog: ${error.message}\n`);
    process.exitCode = 1;
  });
}

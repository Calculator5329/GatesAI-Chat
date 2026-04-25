import type { ExecRunResp } from '../../core/workspace';
import { BridgeOfflineError } from '../bridge/client';
import type { Tool } from './types';

const VALID_ACTIONS = [
  'status',
  'diff',
  'log',
  'show',
  'branch_list',
  'add',
  'commit',
  'branch_create',
  'branch_switch',
  'restore',
  'restore_staged',
] as const;

const VALID_ACTIONS_TEXT = VALID_ACTIONS.join(', ');
const RESTORE_CONFIRM = 'restore local changes';

type GitAction = typeof VALID_ACTIONS[number];

/**
 * git — local-only Git porcelain over the bridge.
 *
 * This is intentionally narrower than terminal({ cmd: "git" }). It exposes
 * common status/history/staging/commit/branch actions while omitting all
 * network operations and high-risk history rewrites.
 */
export const gitTool: Tool = {
  def: {
    name: 'git',
    description: [
      'Run safe local Git operations in the bridge workspace. No network operations are exposed.',
      '',
      'Read-only actions:',
      '• `status` — `git status --short --branch`.',
      '• `diff` — show unstaged changes, or staged changes with `staged: true`. Optional `paths`.',
      '• `log` — recent commits, one per line. Optional `limit` (default 10, max 50).',
      '• `show` — show a commit/ref summary. Optional `ref` (default HEAD).',
      '• `branch_list` — list local branches.',
      '',
      'Safe local write actions:',
      '• `add` — stage explicit `paths`.',
      '• `commit` — create a local commit with `message`.',
      '• `branch_create` — create `branch`.',
      '• `branch_switch` — switch to `branch`.',
      '',
      'Guarded actions:',
      '• `restore` — restore local file changes. Requires `paths` and `confirm: "restore local changes"`.',
      '• `restore_staged` — unstage files. Requires `paths` and `confirm: "restore local changes"`.',
      '',
      'Deliberately not supported: push, pull, fetch, remote, reset, rebase, merge, or force operations.',
      'Requires gatesai-bridge and a bridge allowlist that permits the `git` binary.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: [...VALID_ACTIONS] },
        paths: { type: 'array', items: { type: 'string' }, description: 'File paths for add/diff/restore.' },
        message: { type: 'string', description: 'Commit message for commit.' },
        branch: { type: 'string', description: 'Branch name for branch_create / branch_switch.' },
        ref: { type: 'string', description: 'Commit-ish for show. Defaults to HEAD.' },
        staged: { type: 'boolean', description: 'For diff, show staged changes.' },
        cwd: { type: 'string', description: 'Workspace-relative directory. Defaults to workspace root.' },
        limit: { type: 'number', description: 'For log, number of commits. Default 10, max 50.' },
        confirm: { type: 'string', description: 'Required confirmation for restore actions.' },
      },
      required: ['action'],
    },
  },
  meta: {
    category: 'git',
    isReadOnly: args => ['status', 'diff', 'log', 'show', 'branch_list'].includes(String(args.action ?? '')),
    hasSideEffects: args => !['status', 'diff', 'log', 'show', 'branch_list'].includes(String(args.action ?? '')),
    resultPolicy: { maxChars: 12_000, summarizeLargeOutput: true },
  },

  async execute(args, ctx) {
    if (!ctx.bridge) return 'Error: bridge unavailable in this context.';
    if (!ctx.bridge.isOnline) return 'Error: bridge offline. Start gatesai-bridge.';

    const action = typeof args.action === 'string' ? args.action.trim() : '';
    if (!action) return `Error: \`action\` is required for git. Valid: ${VALID_ACTIONS_TEXT}.`;
    if (!isGitAction(action)) return `Error: unknown action "${action}". Valid: ${VALID_ACTIONS_TEXT}.`;

    const cwd = typeof args.cwd === 'string' ? args.cwd : undefined;
    const planned = planGitCommand(action, args);
    if (typeof planned === 'string') return planned;

    try {
      const resp = await ctx.bridge.client.request<ExecRunResp>('exec.run', {
        cmd: 'git',
        args: planned,
        cwd,
        timeout_ms: 10000,
      });
      return formatResult(planned, resp);
    } catch (err) {
      const message = err instanceof BridgeOfflineError ? err.message : (err as Error).message;
      return `Error: ${message}`;
    }
  },
};

function isGitAction(action: string): action is GitAction {
  return (VALID_ACTIONS as readonly string[]).includes(action);
}

function planGitCommand(action: GitAction, args: Record<string, unknown>): string[] | string {
  const paths = stringArray(args.paths);
  switch (action) {
    case 'status':
      return ['status', '--short', '--branch'];
    case 'diff':
      return ['diff', ...(args.staged === true ? ['--staged'] : []), ...pathArgs(paths)];
    case 'log': {
      const limit = clampLimit(args.limit);
      return ['log', '--oneline', `-${limit}`];
    }
    case 'show':
      return ['show', '--stat', '--oneline', str(args.ref) || 'HEAD'];
    case 'branch_list':
      return ['branch', '--list'];
    case 'add':
      if (paths.length === 0) return 'Error: `paths` is required for git add.';
      return ['add', '--', ...paths];
    case 'commit': {
      const message = str(args.message);
      if (!message) return 'Error: `message` is required for git commit.';
      return ['commit', '-m', message];
    }
    case 'branch_create': {
      const branch = str(args.branch);
      if (!branch) return 'Error: `branch` is required for branch_create.';
      return ['branch', branch];
    }
    case 'branch_switch': {
      const branch = str(args.branch);
      if (!branch) return 'Error: `branch` is required for branch_switch.';
      return ['switch', branch];
    }
    case 'restore':
      if (paths.length === 0) return 'Error: `paths` is required for restore.';
      if (str(args.confirm) !== RESTORE_CONFIRM) return `Error: restore requires confirm: "${RESTORE_CONFIRM}".`;
      return ['restore', '--', ...paths];
    case 'restore_staged':
      if (paths.length === 0) return 'Error: `paths` is required for restore_staged.';
      if (str(args.confirm) !== RESTORE_CONFIRM) return `Error: restore_staged requires confirm: "${RESTORE_CONFIRM}".`;
      return ['restore', '--staged', '--', ...paths];
  }
}

function pathArgs(paths: string[]): string[] {
  return paths.length > 0 ? ['--', ...paths] : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(v => typeof v === 'string' ? v.trim() : '').filter(Boolean)
    : [];
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function clampLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 10;
  return Math.max(1, Math.min(50, Math.floor(value)));
}

function formatResult(args: string[], resp: ExecRunResp): string {
  const header = `$ git ${args.join(' ')}`;
  const meta = `[exit ${resp.exit_code}, ${resp.duration_ms}ms${resp.truncated ? ', truncated' : ''}]`;
  const parts: string[] = [header, meta];
  if (resp.stdout.trim()) parts.push('--- stdout ---', compact('stdout', resp.stdout));
  if (resp.stderr.trim()) parts.push('--- stderr ---', compact('stderr', resp.stderr));
  return parts.join('\n');
}

function compact(label: string, value: string): string {
  const text = value.trimEnd();
  if (text.length <= 12_000) return text;
  return [
    `[${label} compacted: ${text.length} chars]`,
    text.slice(0, 5_000),
    `\n... omitted ${text.length - 10_000} chars ...\n`,
    text.slice(-5_000),
  ].join('');
}

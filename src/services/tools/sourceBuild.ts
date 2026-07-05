// Defines the sourceBuild tool contract, validation, execution, or display formatting.
// Called by ChatStore tool rounds via the registry; depends on ToolContext facades and bridge/store services.
// Invariant: tools validate inputs first and return deterministic, user-readable results.
import type { SourceBuildCommand, SourceBuildStatus } from '../sourceBuild';
import type { Tool } from './types';

export const sourceBuildTool: Tool = {
  def: {
    name: 'source_build',
    description: [
      'Run approved validation/package jobs in the prepared duplicate GatesAI Chat source workspace.',
      'Recommended self-improvement workflow: edit the source copy, run source_build start/test, fix failures, run tests again, then tell the user it is ready to build. Build only after tests pass unless the user explicitly chooses otherwise.',
      '',
      'Actions:',
      '- `status` - read the current/last build or test job status, step summary, and tail logs.',
      '- `start` - start one approved job: test, install, build, package.',
      '- `clear` - clear the last completed/failed active job status while preserving last build/test summaries.',
      '',
      'Command mapping:',
      '  install -> npm install',
      '  test -> npm ci when node_modules is absent, then npm test, npm run typecheck, npm run lint',
      '  build -> npm run build',
      '  package -> npm run tauri:build',
      '',
      'Only one job can run at a time across build and test. This does not install the generated installer or modify the live app.',
      'The user can watch live logs in the Workspace menu. On build success, hand off by opening the output folder; the user must choose and approve any install/update.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'start', 'clear'] },
        command: { type: 'string', enum: ['install', 'test', 'build', 'package'] },
      },
      required: ['action'],
      additionalProperties: false,
    },
    strict: true,
  },
  meta: {
    category: 'source',
    isReadOnly: args => String(args.action ?? '') === 'status',
    hasSideEffects: args => ['start', 'clear'].includes(String(args.action ?? '')),
    resultPolicy: { maxChars: 12_000, summarizeLargeOutput: true },
    validate: validateSourceBuildArgs,
  },

  async execute(args, ctx) {
    const {
      clearSourceBuild,
      getSourceBuildStatus,
      startSourceBuild,
    } = await import('../sourceBuild');
    const action = typeof args.action === 'string' ? args.action : '';
    switch (action) {
      case 'status':
        return refreshAfter(ctx, formatStatus(await getSourceBuildStatus()));
      case 'start':
        return refreshAfter(ctx, formatStatus(await startSourceBuild(args.command as SourceBuildCommand)));
      case 'clear':
        return refreshAfter(ctx, formatStatus(await clearSourceBuild()));
      default:
        return 'Error: `action` is required for source_build. Valid: status, start, clear.';
    }
  },
};

function validateSourceBuildArgs(args: Record<string, unknown>) {
  if (args.action === 'start' && typeof args.command !== 'string') {
    return {
      errorCode: 'missing_required_argument',
      summary: '`command` is required for source_build action "start".',
      fix: 'Retry with { "action": "start", "command": "test" } using one of: install, test, build, package.',
      retryable: true,
    };
  }
  return null;
}

function refreshAfter(ctx: Parameters<Tool['execute']>[1], result: string): string {
  void ctx.sourceWorkspace?.refreshRuntimeContext?.();
  return result;
}

export function formatStatus(status: SourceBuildStatus): string {
  const lines = [
    `status: ${status.status}`,
    status.jobKind ? `job_kind: ${status.jobKind}` : '',
    status.command ? `command: ${status.command}` : '',
    status.cmdline ? `cmdline: ${status.cmdline}` : '',
    status.sourceRoot ? `source_root: ${status.sourceRoot}` : '',
    status.startedAtUnix ? `started_at: ${new Date(status.startedAtUnix * 1000).toISOString()}` : '',
    status.finishedAtUnix ? `finished_at: ${new Date(status.finishedAtUnix * 1000).toISOString()}` : '',
    status.exitCode != null ? `exit_code: ${status.exitCode}` : '',
    status.installerPath ? `installer_path: ${status.installerPath}` : '',
    status.installerBytes != null ? `installer_bytes: ${status.installerBytes}` : '',
    status.lastError ? `last_error: ${status.lastError}` : '',
  ].filter(Boolean);
  const steps = status.steps ?? [];
  if (steps.length > 0) {
    lines.push('', '--- steps ---', ...steps.map(step => {
      const exit = step.exitCode != null ? ` exit=${step.exitCode}` : '';
      const duration = step.startedAtUnix ? ` ${formatDuration(step.startedAtUnix, step.finishedAtUnix)}` : '';
      return `${step.id}: ${step.status}${exit}${duration} (${step.cmdline})`;
    }));
  }
  if (status.lastTest) {
    lines.push('', '--- last test ---', ...formatJobSummary(status.lastTest));
  }
  if (status.lastBuild) {
    lines.push('', '--- last build ---', ...formatJobSummary(status.lastBuild));
  }
  const tail = status.logs.slice(-80);
  if (tail.length > 0) {
    lines.push('', '--- log tail ---', ...tail);
  }
  return lines.join('\n');
}

function formatJobSummary(summary: NonNullable<SourceBuildStatus['lastTest']>): string[] {
  const lines = [
    `status: ${summary.status}`,
    `command: ${summary.command}`,
    summary.startedAtUnix ? `started_at: ${new Date(summary.startedAtUnix * 1000).toISOString()}` : '',
    summary.finishedAtUnix ? `finished_at: ${new Date(summary.finishedAtUnix * 1000).toISOString()}` : '',
    summary.exitCode != null ? `exit_code: ${summary.exitCode}` : '',
    ...summary.steps.map(step => `${step.id}: ${step.status}${step.exitCode != null ? ` exit=${step.exitCode}` : ''}`),
  ].filter(Boolean);
  if (summary.failureTail) lines.push('failure_tail:', capTail(summary.failureTail, 8_000));
  return lines;
}

function capTail(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : value.slice(value.length - maxChars);
}

function formatDuration(startedAtUnix: number, finishedAtUnix?: number): string {
  const end = finishedAtUnix ?? Math.floor(Date.now() / 1000);
  const seconds = Math.max(0, end - startedAtUnix);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

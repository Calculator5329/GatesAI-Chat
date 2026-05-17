import {
  clearSourceBuild,
  getSourceBuildStatus,
  startSourceBuild,
  type SourceBuildCommand,
  type SourceBuildStatus,
} from '../sourceBuild';
import type { Tool } from './types';

export const sourceBuildTool: Tool = {
  def: {
    name: 'source_build',
    description: [
      'Run approved validation/package commands in the prepared duplicate GatesAI Chat source workspace.',
      '',
      'Actions:',
      '• `status` — read the current/last build job status and tail logs.',
      '• `start` — start one approved command: install, test, build, package.',
      '• `clear` — clear the last completed/failed job status.',
      '',
      'Command mapping:',
      '  install -> npm install',
      '  test -> npm test',
      '  build -> npm run build',
      '  package -> npm run tauri:build',
      '',
      'Only one job can run at a time. This does not install the generated installer or modify the live app.',
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

  async execute(args) {
    const action = typeof args.action === 'string' ? args.action : '';
    switch (action) {
      case 'status':
        return formatStatus(await getSourceBuildStatus());
      case 'start':
        return formatStatus(await startSourceBuild(args.command as SourceBuildCommand));
      case 'clear':
        return formatStatus(await clearSourceBuild());
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

export function formatStatus(status: SourceBuildStatus): string {
  const lines = [
    `status: ${status.status}`,
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
  const tail = status.logs.slice(-80);
  if (tail.length > 0) {
    lines.push('', '--- log tail ---', ...tail);
  }
  return lines.join('\n');
}

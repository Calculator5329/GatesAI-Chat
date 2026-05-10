import type { Tool } from './types';

const FALLBACK_MAX_OUTPUT_BYTES = 5 * 1024 * 1024;
const FALLBACK_MAX_FILE_BYTES = 50 * 1024 * 1024;

export const workspaceTool: Tool = {
  def: {
    name: 'workspace',
    description: [
      'Inspect the local gatesai-bridge workspace runtime contract.',
      '',
      'Actions:',
      '• `info` — platform, workspace root, command allowlist, and path semantics.',
      '• `limits` — known output and file caps.',
      '• `how_to_run_scripts` — artifact-first recipe for query scripts under notes/query_scripts and outputs under artifacts.',
      '',
      'Use this when you need runtime facts instead of guessing from the static prompt.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['info', 'limits', 'how_to_run_scripts'] },
      },
      required: ['action'],
    },
  },
  meta: {
    category: 'workspace',
    isReadOnly: () => true,
    hasSideEffects: () => false,
    resultPolicy: { maxChars: 2_000, summarizeLargeOutput: false },
  },

  async execute(args, ctx) {
    const action = typeof args.action === 'string' ? args.action : '';
    switch (action) {
      case 'info':
        return formatInfo(ctx);
      case 'limits':
        return formatLimits();
      case 'how_to_run_scripts':
        return [
          'Artifact-first query script workflow:',
          '1. Use inspect_file({ action: "workspace_profile" }) to check /workspace/artifacts before raw attachments.',
          '2. Use inspect_file profile/preview/search/extract/aggregate on CSV/JSON/text sources instead of fs.read dumps.',
          '3. Use query_script templates for repeatable work.',
          '4. Use fs.write to create scripts under /workspace/notes/query_scripts/<topic>.py.',
          '5. In Python use Path.cwd(); in Node use process.cwd(); in either case use relative paths like attachments/source.csv and artifacts/output.json.',
          '6. Run the script with terminal from the workspace root, passing cmd plus argv directly.',
          '7. Write final reusable data under /workspace/artifacts/<topic>.json and validate counts, schema checks, ranges, or spot checks before summarizing.',
          '',
          'Do not use /workspace/... as an absolute OS path inside the script.',
        ].join('\n');
      default:
        return 'Error: `action` is required for workspace. Valid: info, limits, how_to_run_scripts.';
    }
  },
};

function formatInfo(ctx: Parameters<Tool['execute']>[1]): string {
  const bridge = ctx.bridge;
  return [
    `state: ${bridge?.state ?? (bridge?.isOnline ? 'online' : 'unknown')}`,
    `version: ${bridge?.version ?? 'unknown'}`,
    `platform: ${bridge?.platform ?? 'unknown'}`,
    `workspace_root: ${bridge?.workspaceRoot ?? 'unknown'}`,
    `allowlist: ${(bridge?.allowlist ?? []).join(', ') || '(unknown)'}`,
    '',
    'Path contract:',
    '- /workspace/... is model-facing for fs paths, attachments, and artifact references.',
    '- Scripts and terminal commands run from the real bridge workspace root.',
    '- Inside scripts, use cwd/relative paths rather than /workspace as an OS path.',
    '- The terminal tool passes cmd + argv directly; shell syntax only works through an allowlisted shell.',
    '- Default docs: /workspace/README.md points to /workspace/notes/GatesAI-AI-Operating-Context.md for app/tool/user-visible environment details.',
  ].join('\n');
}

function formatLimits(): string {
  return [
    'Known fallback limits:',
    `max_output_bytes: ${FALLBACK_MAX_OUTPUT_BYTES}`,
    `max_file_bytes: ${FALLBACK_MAX_FILE_BYTES}`,
    '',
    'If the bridge reports newer limits in a future health payload, prefer those runtime values.',
  ].join('\n');
}

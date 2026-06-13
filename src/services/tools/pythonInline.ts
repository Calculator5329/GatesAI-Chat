// Defines the pythonInline tool contract, validation, execution, or display formatting.
// Called by ChatStore tool rounds via the registry; depends on ToolContext facades and bridge/store services.
// Invariant: tools validate inputs first and return deterministic, user-readable results.
import type { ExecRunResp } from '../../core/workspace';
import { describeBridgeError, requireBridge } from './requireBridge';
import { denyIfReferencesProtectedChatHistory } from './protectedWorkspacePaths';
import type { Tool } from './types';

const MAX_INLINE_CODE_CHARS = 8_000;

export const pythonInlineTool: Tool = {
  def: {
    name: 'python_inline',
    description: [
      'Run a short Python snippet inside the bridge workspace without a shell.',
      '',
      'Use this for quick data checks, small transformations, and one-off calculations.',
      'For reusable or multi-step work, write a script under /workspace/notes/query_scripts/ and run it with terminal.',
      '',
      'Execution contract:',
      '  Runs cmd "python" with args ["-c", code]. No shell, pipes, redirects, glob expansion, PowerShell, or cmd.exe.',
      '  Commands run from the bridge workspace root. Use cwd-relative paths like attachments/file.csv.',
      '  Optional stdin is passed directly to Python stdin.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Python source passed to python -c. Keep it short and self-contained.' },
        stdin: { type: 'string', description: 'Optional stdin payload.' },
        timeout_ms: { type: 'number', description: 'Kill the process after this many ms. Default 10000.' },
      },
      required: ['code'],
    },
  },
  meta: {
    category: 'shell',
    isReadOnly: () => false,
    hasSideEffects: () => true,
    resultPolicy: { maxChars: 12_000, summarizeLargeOutput: true },
  },

  async execute(args, ctx) {
    const guard = requireBridge(ctx);
    if (!guard.ok) return guard.error;

    const code = typeof args.code === 'string' ? args.code : '';
    if (!code.trim()) return 'Error: `code` is required.';
    if (code.length > MAX_INLINE_CODE_CHARS) {
      return `Error: inline Python is too long (${code.length} chars). Write a script under /workspace/notes/query_scripts/ instead.`;
    }

    const stdin = typeof args.stdin === 'string' ? args.stdin : undefined;
    const timeout_ms = typeof args.timeout_ms === 'number' ? args.timeout_ms : 10_000;

    // Audit C3 — scan inline Python for protected chat-history paths before exec.
    const protectedDenial = denyIfReferencesProtectedChatHistory([code, stdin ?? ''], 'python_inline');
    if (protectedDenial) return protectedDenial;

    try {
      const resp = await guard.bridge.client.request<ExecRunResp>('exec.run', {
        cmd: 'python',
        args: ['-c', code],
        cwd: undefined,
        stdin,
        timeout_ms,
      });
      return formatPythonInlineResult(resp);
    } catch (err) {
      return describeBridgeError(err);
    }
  },
};

function formatPythonInlineResult(resp: ExecRunResp): string {
  const parts = [
    '$ python -c <inline>',
    `[exit ${resp.exit_code}, ${resp.duration_ms}ms${resp.truncated ? ', truncated' : ''}]`,
  ];
  const stdout = compactStream(resp.stdout);
  const stderr = compactStream(resp.stderr);
  if (stdout.trim()) parts.push('--- stdout ---', stdout);
  if (stderr.trim()) parts.push('--- stderr ---', stderr);
  return parts.join('\n');
}

function compactStream(value: string): string {
  const text = value.trimEnd();
  const lines = text.split('\n');
  if (text.length <= 8_000 && lines.length <= 60) return text;
  return [
    `[output compacted: ${lines.length} lines, ${text.length} chars]`,
    ...lines.slice(0, 12),
    `... omitted ${Math.max(0, lines.length - 24)} lines ...`,
    ...lines.slice(-12),
  ].join('\n');
}

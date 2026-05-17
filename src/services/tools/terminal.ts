import type { ExecRunResp, ExecEvent } from '../../core/workspace';
import { BridgeOfflineError } from '../bridge/client';
import type { Tool } from './types';

/**
 * terminal — run real shell commands inside the workspace via the bridge.
 *
 * The bridge enforces an allowlist defined in `~/.gatesai/bridge.json`
 * (`exec_allowlist`). Anything not on it is rejected before fork. Add
 * binaries by editing the file and restarting the bridge.
 *
 * Streaming: the bridge emits `event` envelopes with stdout/stderr lines
 * as the process runs. The tool feeds these into ExecStreamStore so the
 * UI can show a live tail. The model only sees the final result string
 * (full stdout + stderr + exit code) — it doesn't see the live stream,
 * which keeps token cost down for noisy commands.
 */
export const terminalTool: Tool = {
  def: {
    name: 'terminal',
    description: [
      'Run an allowlisted command inside the bridge workspace folder.',
      '',
      'Execution contract:',
      '  `cmd` is the binary basename (e.g. "git", "python", "node"). `args` is a string array of arguments.',
      '  The bridge invokes the binary directly with argv; shell-only syntax such as heredocs, pipes, redirects, and glob expansion will not work unless you explicitly run an allowlisted shell.',
      '  Optional `cwd` is workspace-relative and defaults to the workspace root.',
      '  Scripts should use Path.cwd(), process.cwd(), or relative paths. Do not assume /workspace exists as an absolute OS path inside Python/Node/etc.',
      '',
      'Workflow guidance:',
      '  For multiline programs or bulk conversions, write a script under /workspace/notes/ or /workspace/artifacts/ with `fs`, then run it from the workspace root.',
      '  Do not run a script in parallel with the write that creates or updates it. Wait for dependent writes before executing reads/runs.',
      '',
      'Output is captured (stdout + stderr) and returned with the exit code. Long-running commands (npm install, test suites) stream live to the user\'s UI as they run; you receive the full output in the tool result.',
      'Use `timeout_ms` for commands that may hang, and wait for the final result before claiming success.',
      '',
      'Use this for: running tests, git operations, building projects, running scripts you wrote into /workspace/notes/ or /workspace/artifacts/.',
      '',
      'Requires the gatesai-bridge companion process. If you get a "bridge offline" error, ask the user to start it.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        cmd: { type: 'string', description: 'Binary to run (basename only, e.g. "python").' },
        args: { type: 'array', items: { type: 'string' }, description: 'Arguments.' },
        cwd: { type: 'string', description: 'Working directory (workspace-relative). Defaults to /workspace.' },
        stdin: { type: 'string', description: 'Optional stdin payload.' },
        timeout_ms: { type: 'number', description: 'Kill the process after this many ms. Default: no timeout.' },
      },
      required: ['cmd'],
    },
  },
  meta: {
    category: 'shell',
    isReadOnly: () => false,
    hasSideEffects: () => true,
    resultPolicy: { maxChars: 12_000, summarizeLargeOutput: true },
  },

  async execute(args, ctx) {
    if (!ctx.bridge) return 'Error: bridge unavailable in this context.';
    if (!ctx.bridge.isOnline) return 'Error: bridge offline. Start gatesai-bridge.';

    const cmd = typeof args.cmd === 'string' ? args.cmd : '';
    if (!cmd) return 'Error: `cmd` is required.';

    const cmdArgs = Array.isArray(args.args)
      ? args.args.filter((a): a is string => typeof a === 'string')
      : [];
    const cwd = typeof args.cwd === 'string' ? args.cwd : undefined;
    const stdin = typeof args.stdin === 'string' ? args.stdin : undefined;
    const timeout_ms = typeof args.timeout_ms === 'number' ? args.timeout_ms : undefined;

    const jobId = ctx.toolCallId
      ? `terminal:${ctx.threadId}:${ctx.toolCallId}`
      : `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    ctx.execStream?.start(jobId, cmd, cmdArgs, { threadId: ctx.threadId, toolCallId: ctx.toolCallId });

    try {
      const resp = await ctx.bridge.client.request<ExecRunResp>(
        'exec.run',
        { cmd, args: cmdArgs, cwd, stdin, timeout_ms },
        (data) => {
          const ev = data as ExecEvent | undefined;
          if (ev?.stream && typeof ev.chunk === 'string') {
            ctx.execStream?.appendChunk(jobId, ev.stream, ev.chunk);
          }
        },
      );
      ctx.execStream?.finish(jobId, resp.exit_code, resp.duration_ms);
      return formatResult(cmd, cmdArgs, resp);
    } catch (err) {
      const message = err instanceof BridgeOfflineError ? err.message : (err as Error).message;
      ctx.execStream?.fail(jobId, message);
      return `Error: ${message}`;
    }
  },
};

function formatResult(cmd: string, args: string[], resp: ExecRunResp): string {
  const cmdline = [cmd, ...args].join(' ');
  const header = `$ ${cmdline}`;
  const meta = `[exit ${resp.exit_code}, ${resp.duration_ms}ms${resp.truncated ? ', truncated' : ''}]`;
  const parts: string[] = [header, meta];
  const stdout = compactStream('stdout', resp.stdout);
  const stderr = compactStream('stderr', resp.stderr);
  if (stdout.trim()) parts.push('--- stdout ---', stdout);
  if (stderr.trim()) parts.push('--- stderr ---', stderr);
  return parts.join('\n');
}

function compactStream(label: string, value: string): string {
  const text = value.trimEnd();
  const lines = text.split('\n');
  if (text.length <= 8_000 && lines.length <= 60) return text;
  if (lines.length <= 24) {
    return [
      `[${label} compacted: ${text.length} chars]`,
      text.slice(0, 3_500),
      `\n... omitted ${Math.max(0, text.length - 7_000)} chars ...\n`,
      text.slice(-3_500),
    ].join('');
  }
  return [
    `[${label} compacted: ${lines.length} lines, ${text.length} chars]`,
    ...lines.slice(0, 12),
    `... omitted ${Math.max(0, lines.length - 24)} lines ...`,
    ...lines.slice(-12),
  ].join('\n');
}

// Runs OpenRouter compatibility checks against representative models and tool/image paths.
// Called by OpenRouterCompatibilityStore and API settings UI; depends on provider configs, LLM clients, and target fixtures.
// Invariant: checks report structured outcomes and must not persist provider state themselves.
import type { LlmProvider, LlmUsage, ToolCall, ToolDef } from '../../src/core/llm';
import type { Model } from '../../src/core/types';
import type { LlmRouter } from '../../src/services/llm/router';
import { resolveModelFormatProfile } from '../../src/services/llm/modelFormatProfiles';
import type { BridgeClientFacade } from '../../src/services/tools/types';
import {
  selectOpenRouterCompatibilityTargets,
  type OpenRouterCompatibilityMode,
} from './openRouterCompatibilityTargets';

export { selectOpenRouterCompatibilityTargets };
export type { OpenRouterCompatibilityMode };

export interface OpenRouterCompatibilityProgress {
  completed: number;
  total: number;
  model?: string;
  line: string;
}

export interface OpenRouterCompatibilityResult {
  modelId: string;
  providerModelId: string;
  name: string;
  vendor: string;
  profileId: string;
  text: ProbeResult;
  tool: ProbeResult;
  usage: LlmUsage[];
}

export interface OpenRouterCompatibilityRun {
  id: string;
  startedAt: string;
  finishedAt: string;
  mode: OpenRouterCompatibilityMode;
  reportPath: string;
  jsonlPath: string;
  total: number;
  passed: number;
  failed: number;
  results: OpenRouterCompatibilityResult[];
}

interface ProbeResult {
  ok: boolean;
  durationMs: number;
  finishReason?: string;
  textChars: number;
  chunks: number;
  firstChunkMs?: number;
  toolCall?: Pick<ToolCall, 'name' | 'arguments' | 'argumentsError' | 'rawArguments'>;
  error?: string;
  sample?: string;
}

interface RunOpenRouterCompatibilityArgs {
  mode: OpenRouterCompatibilityMode;
  models: Model[];
  router: LlmRouter;
  bridge: BridgeClientFacade;
  signal?: AbortSignal;
  onProgress?: (progress: OpenRouterCompatibilityProgress) => void;
}

const TEXT_SENTINEL = 'GATESAI_COMPAT_OK';
const TOOL_SENTINEL = 'openrouter-compat-ping';
const COMPAT_TOOL: ToolDef = {
  name: 'compat_echo',
  description: 'Echo a short compatibility probe payload. Use only when the user asks for OpenRouter compatibility testing.',
  parameters: {
    type: 'object',
    properties: {
      message: { type: 'string' },
    },
    required: ['message'],
    additionalProperties: false,
  },
  strict: true,
};

export async function runOpenRouterCompatibility(
  args: RunOpenRouterCompatibilityArgs,
): Promise<OpenRouterCompatibilityRun> {
  const targets = selectOpenRouterCompatibilityTargets(args.models, args.mode);
  if (!targets.length) throw new Error('No OpenRouter models are available to test.');

  const runId = compactTimestamp(new Date());
  const reportPath = `/workspace/artifacts/reports/openrouter-compat/openrouter-compat-${runId}.md`;
  const jsonlPath = `/workspace/artifacts/data/openrouter-compat/openrouter-compat-${runId}.jsonl`;
  await ensureLogDirs(args.bridge);
  await args.bridge.request('fs.write', {
    path: reportPath,
    content: markdownHeader(runId, args.mode, targets),
  });
  await args.bridge.request('fs.write', {
    path: jsonlPath,
    content: '',
  });

  const results: OpenRouterCompatibilityResult[] = [];
  const startedAt = new Date().toISOString();
  for (const [index, model] of targets.entries()) {
    if (args.signal?.aborted) break;
    args.onProgress?.({
      completed: index,
      total: targets.length,
      model: model.name,
      line: `Testing ${model.name} (${model.providerModelId})`,
    });

    const resolved = args.router.resolve(model.id);
    const result = await testOneModel(model, resolved.providerModelId, resolved.provider, args.signal);
    results.push(result);
    await args.bridge.request('fs.write', {
      path: jsonlPath,
      content: `${JSON.stringify(result)}\n`,
      encoding: 'utf8',
      append: true,
    });
    await args.bridge.request('fs.write', {
      path: reportPath,
      content: markdownResult(result),
      encoding: 'utf8',
      append: true,
    });

    args.onProgress?.({
      completed: index + 1,
      total: targets.length,
      model: model.name,
      line: `${result.text.ok && result.tool.ok ? 'PASS' : 'FAIL'} ${model.name}`,
    });
  }

  const finishedAt = new Date().toISOString();
  const passed = results.filter(result => result.text.ok && result.tool.ok).length;
  const run: OpenRouterCompatibilityRun = {
    id: runId,
    startedAt,
    finishedAt,
    mode: args.mode,
    reportPath,
    jsonlPath,
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
  };
  await args.bridge.request('fs.write', {
    path: reportPath,
    content: markdownSummary(run),
    encoding: 'utf8',
    append: true,
  });
  return run;
}

async function testOneModel(
  model: Model,
  providerModelId: string,
  provider: LlmProvider,
  outerSignal: AbortSignal | undefined,
): Promise<OpenRouterCompatibilityResult> {
  const profile = resolveModelFormatProfile(providerModelId);
  const usage: LlmUsage[] = [];
  const text = await runProbe(provider, {
    modelId: providerModelId,
    maxTokens: profile.maxTokens ?? 512,
    systemPrompt: 'You are a compatibility probe. Follow the requested output exactly.',
    messages: [{ role: 'user', content: `Reply with exactly ${TEXT_SENTINEL} and no other text.` }],
  }, outerSignal, usage);
  const tool = await runProbe(provider, {
    modelId: providerModelId,
    maxTokens: profile.maxTokens ?? 512,
    systemPrompt: 'You are a tool compatibility probe. Use the supplied tool when requested.',
    messages: [{ role: 'user', content: `Call compat_echo with message "${TOOL_SENTINEL}". Do not answer in prose.` }],
    tools: [COMPAT_TOOL],
  }, outerSignal, usage);

  return {
    modelId: model.id,
    providerModelId,
    name: model.name,
    vendor: model.vendor,
    profileId: profile.id,
    text: {
      ...text,
      ok: text.ok && (text.sample ?? '').includes(TEXT_SENTINEL),
    },
    tool: {
      ...tool,
      ok: tool.ok
        && tool.toolCall?.name === 'compat_echo'
        && tool.toolCall.arguments?.message === TOOL_SENTINEL
        && !tool.toolCall.argumentsError,
    },
    usage,
  };
}

async function runProbe(
  provider: LlmProvider,
  req: Parameters<LlmProvider['stream']>[0],
  outerSignal: AbortSignal | undefined,
  usage: LlmUsage[],
): Promise<ProbeResult> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 45_000);
  const abortOuter = () => controller.abort();
  outerSignal?.addEventListener('abort', abortOuter, { once: true });
  const started = performance.now();
  let firstChunkMs: number | undefined;
  let text = '';
  let chunks = 0;
  let finishReason: string | undefined;
  let toolCall: ProbeResult['toolCall'];
  try {
    for await (const chunk of provider.stream(req, controller.signal)) {
      if (firstChunkMs == null) firstChunkMs = Math.round(performance.now() - started);
      chunks += 1;
      if (chunk.type === 'text') text += chunk.delta;
      if (chunk.type === 'tool_call') {
        toolCall = {
          name: chunk.call.name,
          arguments: chunk.call.arguments,
          argumentsError: chunk.call.argumentsError,
          rawArguments: chunk.call.rawArguments,
        };
      }
      if (chunk.type === 'usage') usage.push(chunk.usage);
      if (chunk.type === 'done') {
        finishReason = chunk.finishReason;
        if (chunk.error) throw new Error(chunk.error);
      }
    }
    return {
      ok: Boolean(text.trim()) || Boolean(toolCall),
      durationMs: Math.round(performance.now() - started),
      finishReason,
      textChars: text.length,
      chunks,
      firstChunkMs,
      toolCall,
      sample: text.trim().slice(0, 240),
    };
  } catch (err) {
    return {
      ok: false,
      durationMs: Math.round(performance.now() - started),
      finishReason: controller.signal.aborted ? 'cancelled' : finishReason,
      textChars: text.length,
      chunks,
      firstChunkMs,
      toolCall,
      sample: text.trim().slice(0, 240),
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    globalThis.clearTimeout(timeout);
    outerSignal?.removeEventListener('abort', abortOuter);
  }
}

async function ensureLogDirs(bridge: BridgeClientFacade): Promise<void> {
  await bridge.request('fs.mkdir', { path: '/workspace/artifacts/reports/openrouter-compat' });
  await bridge.request('fs.mkdir', { path: '/workspace/artifacts/data/openrouter-compat' });
}

function compactTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

function markdownHeader(runId: string, mode: OpenRouterCompatibilityMode, targets: Model[]): string {
  return [
    `# OpenRouter Compatibility Run ${runId}`,
    '',
    `mode: ${mode}`,
    `models: ${targets.length}`,
    `started_at: ${new Date().toISOString()}`,
    '',
    'Each model gets a text streaming probe and a tool-call probe. Paste this file back into chat when compatibility changes.',
    '',
    '## Results',
    '',
  ].join('\n');
}

function markdownResult(result: OpenRouterCompatibilityResult): string {
  const ok = result.text.ok && result.tool.ok ? 'PASS' : 'FAIL';
  return [
    `### ${ok} ${result.name}`,
    '',
    `model_id: ${result.modelId}`,
    `provider_model_id: ${result.providerModelId}`,
    `vendor: ${result.vendor}`,
    `format_profile: ${result.profileId}`,
    `text: ${formatProbe(result.text)}`,
    `tool: ${formatProbe(result.tool)}`,
    result.tool.toolCall ? `tool_call: ${JSON.stringify(result.tool.toolCall)}` : '',
    result.text.sample ? `sample: ${JSON.stringify(result.text.sample)}` : '',
    '',
  ].filter(Boolean).join('\n');
}

function markdownSummary(run: OpenRouterCompatibilityRun): string {
  return [
    '## Summary',
    '',
    `finished_at: ${run.finishedAt}`,
    `passed: ${run.passed}`,
    `failed: ${run.failed}`,
    `jsonl: ${run.jsonlPath}`,
    '',
  ].join('\n');
}

function formatProbe(probe: ProbeResult): string {
  const parts = [
    probe.ok ? 'ok' : 'error',
    `${probe.durationMs}ms`,
    `chunks=${probe.chunks}`,
    `chars=${probe.textChars}`,
    probe.finishReason ? `finish=${probe.finishReason}` : '',
    probe.firstChunkMs != null ? `first=${probe.firstChunkMs}ms` : '',
    probe.error ? `error=${JSON.stringify(probe.error)}` : '',
  ].filter(Boolean);
  return parts.join(' ');
}

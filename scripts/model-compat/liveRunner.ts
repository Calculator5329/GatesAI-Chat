import type { LlmMessage, LlmProvider, LlmUsage, ThinkingEffort, ToolCall, ToolDef } from '../../src/core/llm';
import { OpenRouterProvider } from '../../src/services/llm/openrouter';
import type { OpenRouterCatalogModel } from './catalog';
import { modelSupportsTools } from './policy';

const TEXT_SENTINEL = 'GATESAI_COMPAT_OK';
const TOOL_SENTINEL = 'openrouter-compat-ping';
const COMPAT_TOOL: ToolDef = {
  name: 'compat_echo',
  description: 'Echo the compatibility payload exactly.',
  strict: true,
  parameters: {
    type: 'object',
    properties: { message: { type: 'string' } },
    required: ['message'],
    additionalProperties: false,
  },
};

export interface LiveProbeResult {
  modelId: string;
  ok: boolean;
  supportsTools: boolean;
  durationMs: number;
  costUsd: number;
  text: ProbeOutput;
  tool?: ProbeOutput;
  continuation?: ProbeOutput;
}

export interface LiveCompatibilityRun {
  startedAt: string;
  finishedAt: string;
  maxCostUsd: number;
  estimatedCostUsd: number;
  actualCostUsd: number;
  passed: number;
  failed: number;
  stoppedForBudget: boolean;
  results: LiveProbeResult[];
}

export interface LiveRunOptions {
  apiKey: string;
  targets: OpenRouterCatalogModel[];
  maxCostUsd: number;
  timeoutMs?: number;
  probeModel?: (model: OpenRouterCatalogModel) => Promise<LiveProbeResult>;
  onProgress?: (message: string) => void;
}

interface ProbeOutput {
  ok: boolean;
  text: string;
  toolCalls: ToolCall[];
  usage: LlmUsage[];
  finishReason?: string;
  error?: string;
}

export async function runLiveCompatibility(options: LiveRunOptions): Promise<LiveCompatibilityRun> {
  if (!options.apiKey.trim()) throw new Error('OPENROUTER_API_KEY is required for live compatibility probes.');
  if (!Number.isFinite(options.maxCostUsd) || options.maxCostUsd <= 0) {
    throw new Error('--max-cost-usd must be a positive number.');
  }
  const estimatedCostUsd = estimateCompatibilityCost(options.targets);
  if (estimatedCostUsd > options.maxCostUsd) {
    throw new Error(
      `Estimated live probe cost $${estimatedCostUsd.toFixed(4)} exceeds the $${options.maxCostUsd.toFixed(2)} cap. `
      + 'Increase --max-cost-usd or narrow the family selection.',
    );
  }

  const provider = new OpenRouterProvider(options.apiKey);
  const probe = options.probeModel ?? (model => probeOneModel(provider, model, options.timeoutMs ?? 60_000));
  const startedAt = new Date().toISOString();
  const results: LiveProbeResult[] = [];
  let actualCostUsd = 0;
  let stoppedForBudget = false;

  for (const [index, model] of options.targets.entries()) {
    if (actualCostUsd >= options.maxCostUsd) {
      stoppedForBudget = true;
      break;
    }
    options.onProgress?.(`[${index + 1}/${options.targets.length}] ${model.id}`);
    const result = await probe(model);
    results.push(result);
    actualCostUsd += result.costUsd;
  }

  const passed = results.filter(result => result.ok).length;
  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    maxCostUsd: options.maxCostUsd,
    estimatedCostUsd,
    actualCostUsd,
    passed,
    failed: results.length - passed,
    stoppedForBudget,
    results,
  };
}

export function estimateCompatibilityCost(targets: OpenRouterCatalogModel[]): number {
  return targets.reduce((total, model) => {
    const requestCount = modelSupportsTools(model) ? 3 : 1;
    const prompt = finitePrice(model.pricing?.prompt);
    const completion = finitePrice(model.pricing?.completion);
    const request = finitePrice(model.pricing?.request);
    return total + requestCount * (request + prompt * 320 + completion * 160);
  }, 0);
}

async function probeOneModel(
  provider: LlmProvider,
  model: OpenRouterCatalogModel,
  timeoutMs: number,
): Promise<LiveProbeResult> {
  const started = performance.now();
  const thinkingEffort = chooseThinkingEffort(model);
  const text = await runProbe(provider, model.id, {
    systemPrompt: 'You are a compatibility probe. Follow the requested output exactly.',
    messages: [{ role: 'user', content: `Reply with exactly ${TEXT_SENTINEL} and no other text.` }],
    ...(thinkingEffort ? { thinkingEffort } : {}),
  }, timeoutMs);
  text.ok = text.ok && text.text.includes(TEXT_SENTINEL);

  let tool: ProbeOutput | undefined;
  let continuation: ProbeOutput | undefined;
  if (modelSupportsTools(model)) {
    tool = await runProbe(provider, model.id, {
      systemPrompt: `Call compat_echo exactly once with {"message":"${TOOL_SENTINEL}"}. Do not answer in prose.`,
      messages: [{ role: 'user', content: 'Use the required compatibility tool now.' }],
      tools: [COMPAT_TOOL],
    }, timeoutMs);
    const call = tool.toolCalls[0];
    tool.ok = tool.ok
      && call?.name === COMPAT_TOOL.name
      && call.arguments.message === TOOL_SENTINEL
      && !call.argumentsError;

    if (call) {
      const messages: LlmMessage[] = [
        { role: 'user', content: 'Use the required compatibility tool now.' },
        { role: 'assistant', content: '', toolCalls: [call] },
        { role: 'tool', toolCallId: call.id, toolName: call.name, content: TOOL_SENTINEL },
        { role: 'user', content: 'Reply with exactly CONTINUATION_OK.' },
      ];
      continuation = await runProbe(provider, model.id, { messages }, timeoutMs);
      continuation.ok = continuation.ok && continuation.text.includes('CONTINUATION_OK');
    }
  }

  const outputs = [text, tool, continuation].filter((item): item is ProbeOutput => item != null);
  return {
    modelId: model.id,
    ok: outputs.every(output => output.ok),
    supportsTools: modelSupportsTools(model),
    durationMs: Math.round(performance.now() - started),
    costUsd: outputs.flatMap(output => output.usage).reduce((sum, usage) => sum + (usage.costUsd ?? 0), 0),
    text,
    tool,
    continuation,
  };
}

async function runProbe(
  provider: LlmProvider,
  modelId: string,
  request: {
    messages: LlmMessage[];
    systemPrompt?: string;
    tools?: ToolDef[];
    thinkingEffort?: ThinkingEffort;
  },
  timeoutMs: number,
): Promise<ProbeOutput> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('model compatibility timeout'), timeoutMs);
  const toolCalls: ToolCall[] = [];
  const usage: LlmUsage[] = [];
  let text = '';
  let finishReason: string | undefined;
  let error: string | undefined;
  try {
    for await (const chunk of provider.stream({
      modelId,
      messages: request.messages,
      systemPrompt: request.systemPrompt,
      tools: request.tools,
      thinkingEffort: request.thinkingEffort,
      maxTokens: 160,
    }, controller.signal)) {
      if (chunk.type === 'text') text += chunk.delta;
      if (chunk.type === 'tool_call') toolCalls.push(chunk.call);
      if (chunk.type === 'usage') usage.push(chunk.usage);
      if (chunk.type === 'done') {
        finishReason = chunk.finishReason;
        error = chunk.error;
      }
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    clearTimeout(timer);
  }
  return {
    ok: !error && (text.trim().length > 0 || toolCalls.length > 0),
    text: text.trim().slice(0, 400),
    toolCalls,
    usage,
    finishReason,
    error: controller.signal.aborted ? 'Timed out.' : error,
  };
}

function chooseThinkingEffort(model: OpenRouterCatalogModel): ThinkingEffort | undefined {
  const efforts = model.reasoning?.supported_efforts ?? [];
  if (efforts.includes('low')) return 'low';
  return undefined;
}

function finitePrice(value: string | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

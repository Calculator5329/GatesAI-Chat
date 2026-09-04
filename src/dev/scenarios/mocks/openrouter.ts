// OpenRouter mocks: the models catalog, the chat-completions SSE stream (text
// deltas, tool-call deltas, usage, finish reasons, [DONE]) and the image
// generation reply that shares the chat-completions URL.
import type { ImagePlan, MockRequest, MockRoute, OpenRouterPlan, OpenRouterTurn } from '../types';
import { jsonResponse, hostMatches, networkFailure, streamedResponse, textResponse } from './http';

export const OPENROUTER_HOST = 'openrouter.ai';
const CHAT_PATH = '/api/v1/chat/completions';
const MODELS_PATH = '/api/v1/models';
const FALLBACK_REPLY = 'Mock reply from the assistant.';
export const TITLE_REPLY = 'Mocked conversation title';
const TITLE_PROMPT_PREFIX = 'You name conversations';

export function openRouterRoutes(plan: OpenRouterPlan | 'offline' | undefined, image: ImagePlan | 'error' | undefined): MockRoute[] {
  if (!plan) return [];
  if (plan === 'offline') {
    return [{ name: 'openrouter.offline', matches: req => hostMatches(req, OPENROUTER_HOST), respond: req => networkFailure(req.url) }];
  }
  let turnIndex = 0;
  const nextTurn = (): OpenRouterTurn => {
    const turn = plan.turns[turnIndex] ?? lastRepeatableTurn(plan.turns);
    turnIndex += 1;
    return turn;
  };
  return [
    {
      name: 'openrouter.models',
      matches: req => hostMatches(req, OPENROUTER_HOST) && req.url.pathname === MODELS_PATH,
      respond: () => jsonResponse({ data: plan.catalog ?? [] }),
    },
    {
      name: 'openrouter.image',
      matches: req => hostMatches(req, OPENROUTER_HOST) && req.url.pathname === CHAT_PATH && isImageRequest(req),
      respond: async () => {
        const delayMs = image && image !== 'error' ? image.delayMs ?? 0 : 0;
        if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs));
        return imageResponse(image);
      },
    },
    {
      // Conversation naming runs as a side request after the first reply; it
      // must never consume a scripted turn, so it gets a fixed title.
      name: 'openrouter.title',
      matches: req => hostMatches(req, OPENROUTER_HOST) && req.url.pathname === CHAT_PATH && isTitleRequest(req),
      respond: () => chatResponse({ kind: 'text', text: TITLE_REPLY }, { turns: [] }),
    },
    {
      name: 'openrouter.chat',
      matches: req => hostMatches(req, OPENROUTER_HOST) && req.url.pathname === CHAT_PATH,
      respond: () => chatResponse(nextTurn(), plan),
    },
  ];
}

function isImageRequest(req: MockRequest): boolean {
  if (!req.body) return false;
  try {
    const parsed = JSON.parse(req.body) as { modalities?: unknown };
    return Array.isArray(parsed.modalities) && parsed.modalities.includes('image');
  } catch {
    return false;
  }
}

/** Once the script is used up, text and error turns repeat; a tool call never does, or the loop would not end. */
function isTitleRequest(req: MockRequest): boolean {
  if (!req.body) return false;
  try {
    const parsed = JSON.parse(req.body) as { messages?: Array<{ role?: string; content?: unknown }> };
    const system = parsed.messages?.find(message => message.role === 'system');
    return typeof system?.content === 'string' && system.content.startsWith(TITLE_PROMPT_PREFIX);
  } catch {
    return false;
  }
}

function lastRepeatableTurn(turns: OpenRouterTurn[]): OpenRouterTurn {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turns[i].kind !== 'tool_call') return turns[i];
  }
  return { kind: 'text', text: FALLBACK_REPLY };
}

function chatResponse(turn: OpenRouterTurn, plan: OpenRouterPlan): Response {
  if (turn.kind === 'error') {
    return jsonResponse({ error: { message: turn.message, code: turn.status } }, turn.status);
  }
  const frames = turn.kind === 'tool_call' ? toolCallFrames(turn) : textFrames(turn, plan.chunkSize ?? 24);
  return streamedResponse(frames, { delayMs: plan.chunkDelayMs ?? 0, contentType: 'text/event-stream' });
}

function sse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export function textFrames(turn: Extract<OpenRouterTurn, { kind: 'text' }>, chunkSize: number): string[] {
  const frames: string[] = [];
  for (let i = 0; i < turn.text.length; i += chunkSize) {
    frames.push(sse({ id: 'gen-mock', choices: [{ index: 0, delta: { role: 'assistant', content: turn.text.slice(i, i + chunkSize) } }] }));
  }
  if (frames.length === 0) frames.push(sse({ id: 'gen-mock', choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] }));
  const usage = turn.usage ?? { prompt_tokens: 512, completion_tokens: Math.max(8, Math.round(turn.text.length / 4)), cost: 0.0009 };
  frames.push(sse({
    id: 'gen-mock',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    usage: { ...usage, total_tokens: usage.total_tokens ?? usage.prompt_tokens + usage.completion_tokens },
  }));
  frames.push('data: [DONE]\n\n');
  return frames;
}

export function toolCallFrames(turn: Extract<OpenRouterTurn, { kind: 'tool_call' }>): string[] {
  const id = turn.id ?? `call_${turn.name}_mock`;
  const args = JSON.stringify(turn.args);
  const half = Math.ceil(args.length / 2);
  return [
    sse({ id: 'gen-mock', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id, type: 'function', function: { name: turn.name, arguments: args.slice(0, half) } }] } }] }),
    sse({ id: 'gen-mock', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(half) } }] } }] }),
    sse({ id: 'gen-mock', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 640, completion_tokens: 32, total_tokens: 672, cost: 0.0004 } }),
    'data: [DONE]\n\n',
  ];
}

function imageResponse(image: ImagePlan | 'error' | undefined): Response {
  if (!image || image === 'error') {
    return textResponse(JSON.stringify({ error: { message: 'Image generation is unavailable in this scenario.' } }), 502, 'application/json');
  }
  return jsonResponse({
    id: 'gen-image-mock',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: '',
        images: [{ type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.base64}` } }],
      },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 20, completion_tokens: 0, total_tokens: 20, cost: image.costUsd ?? 0.04 },
  });
}

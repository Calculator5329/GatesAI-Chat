import { OpenAiCompatProvider } from './openaiCompat';
import type { LlmMessage, LlmRequest } from '../../core/llm';

export class OpenRouterProvider extends OpenAiCompatProvider {
  constructor(apiKey?: string) {
    super({
      id: 'openrouter',
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey,
      extraHeaders: {
        'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'http://localhost',
        'X-Title': 'GatesAI Chat',
      },
    });
  }

  protected override normalizeMessages(req: LlmRequest): LlmMessage[] {
    if (!req.modelId.startsWith('anthropic/')) return req.messages;

    const out: LlmMessage[] = [];
    for (const message of req.messages) {
      if (message.role !== 'tool') {
        out.push(message);
        continue;
      }

      const content = formatToolResultAsUserText(message);
      const last = out[out.length - 1];
      if (last?.role === 'user') {
        out[out.length - 1] = { ...last, content: `${last.content}\n\n${content}` };
      } else {
        out.push({ role: 'user', content });
      }
    }
    return out;
  }
}

function formatToolResultAsUserText(message: LlmMessage): string {
  const name = message.toolName ?? 'tool';
  const id = message.toolCallId ? ` (${message.toolCallId})` : '';
  return `[tool result: ${name}${id}]\n${message.content}`;
}

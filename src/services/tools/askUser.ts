// Defines the ask_user tool contract, validation, execution, and display text.
// Called by ChatStore tool rounds via the registry; depends on the prompts
// facade backed by PromptStore.
// Invariant: the tool blocks until the user answers or declines, and reports
// a decline honestly rather than inventing an answer.
import type { AssistantPromptOption } from '../../core/prompts';
import type { Tool } from './types';

const MAX_OPTIONS = 5;
const MAX_QUESTION_CHARS = 300;

export const askUserTool: Tool = {
  def: {
    name: 'ask_user',
    description: [
      'Ask the user a short multiple-choice question and wait for their answer.',
      '',
      'Use it when the next step depends on a decision only they can make:',
      '• `approval` — you are about to do something consequential and want a yes/no or a choice of scope.',
      '• `recommendation` — you have a preferred course of action and want them to accept it or pick an alternative.',
      '',
      'Rules:',
      '• Ask ONE question, with 2-5 concrete options. Put your preferred option first.',
      '• Never use it for something you can determine yourself, and never for a question the conversation already answered.',
      '• `grounds` should list what you are basing the suggestion on (tool results, sources, prior turns).',
      '  Do not state a confidence percentage — report what you actually know instead.',
      '• The user may decline. If they do, respect it: do not re-ask the same question.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['approval', 'recommendation'],
          description: 'approval = permission to act; recommendation = a proposal with alternatives.',
        },
        question: { type: 'string', description: 'The question, one sentence.' },
        context: { type: 'string', description: 'Optional: what exactly happens next, in plain language.' },
        options: {
          type: 'array',
          description: '2-5 options. Preferred option first. Each: { label, detail? }.',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              detail: { type: 'string' },
            },
            required: ['label'],
          },
        },
        grounds: {
          type: 'array',
          description: 'What this is based on — sources, tool results, prior turns.',
          items: { type: 'string' },
        },
        allow_free_text: {
          type: 'boolean',
          description: 'Whether the user may answer in their own words. Default false.',
        },
      },
      required: ['question', 'options'],
    },
  },

  meta: {
    category: 'thread',
    risk: 'low',
    selectionHints: ['ask the user', 'confirm before acting', 'offer a choice', 'approval'],
    // Asking a question changes nothing on its own; the *acting* happens in a
    // later tool call that the batch executor sequences normally.
    isReadOnly: () => true,
    hasSideEffects: () => false,
    validate: (args: Record<string, unknown>) => {
      const question = typeof args.question === 'string' ? args.question.trim() : '';
      if (!question) {
        return { errorCode: 'missing_question', summary: '`question` is required.', retryable: true };
      }
      if (question.length > MAX_QUESTION_CHARS) {
        return {
          errorCode: 'question_too_long',
          summary: `\`question\` must be ${MAX_QUESTION_CHARS} characters or fewer.`,
          fix: 'Ask one short question; put the detail in `context`.',
          retryable: true,
        };
      }
      const options = parseOptions(args.options);
      if (options.length < 2) {
        return {
          errorCode: 'too_few_options',
          summary: 'Provide at least two options.',
          fix: 'Give the user a real choice, e.g. the action and a decline.',
          retryable: true,
        };
      }
      if (options.length > MAX_OPTIONS) {
        return {
          errorCode: 'too_many_options',
          summary: `Provide at most ${MAX_OPTIONS} options.`,
          retryable: true,
        };
      }
      return null;
    },
  },

  ui: {
    verb: () => 'Asked',
    target: args => (typeof args.question === 'string' ? args.question : undefined),
  },

  async execute(args, ctx) {
    if (!ctx.prompts) {
      return 'Error: this runtime cannot ask the user questions. Decide yourself, or state the options in your reply.';
    }
    const question = typeof args.question === 'string' ? args.question.trim() : '';
    // Sliced here rather than in the parser so validation can still see (and
    // reject) an overlong list instead of silently dropping its tail.
    const options = parseOptions(args.options).slice(0, MAX_OPTIONS);
    const kind = args.kind === 'recommendation' ? 'recommendation' : 'approval';
    const grounds = Array.isArray(args.grounds)
      ? args.grounds.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      : undefined;

    const answer = await ctx.prompts.ask(
      {
        kind,
        question,
        context: typeof args.context === 'string' ? args.context : undefined,
        options,
        grounds,
        allowFreeText: args.allow_free_text === true,
      },
      { threadId: ctx.threadId, toolCallId: ctx.toolCallId, signal: ctx.signal },
    );

    if (answer.declined) {
      return [
        'status: declined',
        `summary: ${answer.text}`,
        'next: Do not ask this again. Continue with what you can do without an answer, or say what you need.',
      ].join('\n');
    }
    return [
      'status: answered',
      `answer: ${answer.text}`,
      answer.optionId ? `option_id: ${answer.optionId}` : '',
    ].filter(Boolean).join('\n');
  },
};

function parseOptions(value: unknown): AssistantPromptOption[] {
  if (!Array.isArray(value)) return [];
  const options: AssistantPromptOption[] = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry === 'string') {
      if (entry.trim()) options.push({ id: `option-${index}`, label: entry.trim() });
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const label = typeof record.label === 'string' ? record.label.trim() : '';
    if (!label) continue;
    options.push({
      id: `option-${index}`,
      label,
      detail: typeof record.detail === 'string' && record.detail.trim() ? record.detail.trim() : undefined,
    });
  }
  return options;
}

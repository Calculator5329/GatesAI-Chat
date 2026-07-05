import type { Tool } from './types';

export const spawnTaskTool: Tool = {
  def: {
    name: 'spawn_task',
    description: 'Start one scoped background task in a separate agent thread. Only one background task can run at a time; this tool is unavailable while one is running.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Short title for the background task.',
        },
        instructions: {
          type: 'string',
          description: 'Complete instructions for the background agent. Include all context it needs because it cannot ask the user questions.',
        },
        model: {
          type: 'string',
          description: 'Optional GatesAI model id to use. If unavailable, the origin thread model is used.',
        },
      },
      required: ['title', 'instructions'],
      additionalProperties: false,
    },
    strict: true,
  },
  meta: {
    category: 'thread',
    risk: 'medium',
    hasSideEffects: () => true,
    validate: args => {
      const title = typeof args.title === 'string' ? args.title.trim() : '';
      const instructions = typeof args.instructions === 'string' ? args.instructions.trim() : '';
      if (!title) {
        return {
          errorCode: 'missing_required_argument',
          summary: '`title` is required for spawn_task.',
          fix: 'Retry with a short non-empty task title.',
          retryable: true,
        };
      }
      if (!instructions) {
        return {
          errorCode: 'missing_required_argument',
          summary: '`instructions` is required for spawn_task.',
          fix: 'Retry with complete task instructions.',
          retryable: true,
        };
      }
      return null;
    },
  },
  ui: {
    verb: () => 'Started background task',
    target: args => typeof args.title === 'string' ? args.title : undefined,
    summary: result => result.summary,
  },
  async execute(args, ctx) {
    if (!ctx.chat.spawnTask) {
      return {
        content: 'Unable to start background task: this chat runtime does not support background tasks.',
        summary: 'Background tasks are unavailable.',
        ok: false,
        errorCode: 'agent_task_unavailable',
        retryable: false,
      };
    }
    const result = ctx.chat.spawnTask({
      title: String(args.title ?? ''),
      instructions: String(args.instructions ?? ''),
      model: typeof args.model === 'string' ? args.model : undefined,
    }, ctx.threadId);
    return {
      content: result.message,
      summary: result.message,
      ok: result.ok,
      ...(result.ok ? {} : { errorCode: 'agent_task_unavailable', retryable: true }),
    };
  },
};

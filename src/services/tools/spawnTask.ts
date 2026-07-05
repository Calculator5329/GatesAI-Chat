import type { Tool } from './types';
import { spawnTaskDescription } from '../chat/agentTasks';

export { spawnTaskDescription } from '../chat/agentTasks';

export const spawnTaskTool: Tool = {
  def: {
    name: 'spawn_task',
    description: spawnTaskDescription(),
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
        system_prompt: {
          type: 'string',
          description: 'Optional replacement for the default task system prompt body. The app keeps a non-interactive background-task prefix and caps this at 4000 characters.',
        },
        max_rounds: {
          type: 'number',
          description: 'Optional tool-round budget for the agent task, clamped to 1 through 10. Defaults to 6.',
        },
        start_delay_minutes: {
          type: 'number',
          description: 'Optional delay before starting the task, from 0 through 720 minutes. Delayed tasks appear immediately as scheduled and report results back to the origin thread when complete.',
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
      system_prompt: typeof args.system_prompt === 'string' ? args.system_prompt : undefined,
      max_rounds: typeof args.max_rounds === 'number' ? args.max_rounds : undefined,
      start_delay_minutes: typeof args.start_delay_minutes === 'number' ? args.start_delay_minutes : undefined,
    }, ctx.threadId);
    return {
      content: result.message,
      summary: result.message,
      ok: result.ok,
      ...(result.ok ? {} : { errorCode: 'agent_task_unavailable', retryable: true }),
    };
  },
};

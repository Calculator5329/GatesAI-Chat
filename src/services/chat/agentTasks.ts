// Shared constants and prompt helpers for background agent tasks.
// Called by ChatStore, TurnRunner, and the spawn_task tool.

export const MAX_CONCURRENT_AGENT_TASKS = 2;
export const DEFAULT_AGENT_TASK_MAX_ROUNDS = 6;
export const MAX_AGENT_TASK_MAX_ROUNDS = 10;
export const MAX_AGENT_TASK_SYSTEM_PROMPT_CHARS = 4000;
export const MAX_AGENT_TASK_START_DELAY_MINUTES = 720;
export const AGENT_TASK_SLOT_RETRY_MS = 60_000;

export const AGENT_TASK_SYSTEM_PROMPT_PREFIX =
  'You are a background task agent. Work non-interactively and do not ask the user questions.';

const DEFAULT_AGENT_TASK_SYSTEM_PROMPT_BODY =
  'Complete the task, then produce a concise final summary.';

export function clampAgentTaskMaxRounds(value: unknown): number {
  const numeric = typeof value === 'number' && Number.isFinite(value)
    ? Math.floor(value)
    : DEFAULT_AGENT_TASK_MAX_ROUNDS;
  return Math.min(MAX_AGENT_TASK_MAX_ROUNDS, Math.max(1, numeric));
}

export function clampAgentTaskStartDelayMinutes(value: unknown): number {
  const numeric = typeof value === 'number' && Number.isFinite(value)
    ? value
    : 0;
  return Math.min(MAX_AGENT_TASK_START_DELAY_MINUTES, Math.max(0, numeric));
}

export function normalizeAgentTaskSystemPromptBody(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, MAX_AGENT_TASK_SYSTEM_PROMPT_CHARS);
}

export function buildAgentTaskSystemPrompt(body?: string): string {
  return `${AGENT_TASK_SYSTEM_PROMPT_PREFIX}\n\n${body?.trim() || DEFAULT_AGENT_TASK_SYSTEM_PROMPT_BODY}`;
}

export function spawnTaskDescription(usedSlots?: number): string {
  const usage = typeof usedSlots === 'number'
    ? `${usedSlots} of ${MAX_CONCURRENT_AGENT_TASKS} slots in use`
    : `up to ${MAX_CONCURRENT_AGENT_TASKS} concurrent slots`;
  return [
    `Start a scoped background task in a separate agent thread (${usage}).`,
    'Results are posted back to the origin thread as a completion event with a link to the agent thread.',
    'Optional model chooses a GatesAI model id and falls back to the origin thread model if unavailable.',
    'Optional system_prompt replaces the default task instructions while keeping the non-interactive background-task prefix; it is capped at 4000 characters.',
    `Optional max_rounds sets the tool-round budget from 1 to ${MAX_AGENT_TASK_MAX_ROUNDS}; the default is ${DEFAULT_AGENT_TASK_MAX_ROUNDS}.`,
    `Optional start_delay_minutes schedules the task to start later from 0 to ${MAX_AGENT_TASK_START_DELAY_MINUTES} minutes; scheduled tasks are visible immediately and do not consume a running slot until they start.`,
  ].join(' ');
}

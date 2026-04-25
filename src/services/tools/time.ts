import type { Tool } from './types';

/**
 * The world's simplest tool: tell the model what time it is.
 *
 * Models don't know "now" — their training data has a cutoff and they
 * routinely hallucinate dates. This is a single deterministic call that
 * returns ISO + human-readable + day-of-week + the user's timezone, so
 * the model can format whatever shape it needs without asking us follow-up
 * questions.
 *
 * No arguments, one action. Costs nothing to expose; the model only calls
 * it when "what's the date?" / "what day is it?" comes up.
 */
export const timeTool: Tool = {
  def: {
    name: 'time',
    description: [
      'Get the current date and time in the user\'s local timezone.',
      'Use this whenever the user asks anything time-sensitive ("what day is it",',
      '"how long until X", "what year is it"), or when you need a timestamp for',
      'a note / memory you\'re saving. No arguments — just call it.',
    ].join('\n'),
    parameters: { type: 'object', properties: {} },
  },
  meta: {
    category: 'time',
    isReadOnly: () => true,
    hasSideEffects: () => false,
    resultPolicy: { maxChars: 1_000, summarizeLargeOutput: false },
  },

  async execute() {
    const now = new Date();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const human = now.toLocaleString(undefined, {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    });
    return [
      `iso: ${now.toISOString()}`,
      `local: ${human}`,
      `timezone: ${tz}`,
      `unix_ms: ${now.getTime()}`,
    ].join('\n');
  },
};

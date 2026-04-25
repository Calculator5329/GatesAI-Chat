import type { ToolDef } from '../../core/llm';
import type { UserProfileStore } from '../../stores/UserProfileStore';
import type { ChatStore } from '../../stores/ChatStore';
import type { NotesStore } from '../../stores/NotesStore';
import type { SummaryStore } from '../../stores/SummaryStore';
import type { BridgeStore } from '../../stores/BridgeStore';
import type { ExecStreamStore } from '../../stores/ExecStreamStore';

/**
 * Runtime context passed to every tool. Add fields here as tools need them
 * (e.g. an HTTP client, a fetcher for `web_search`). Keep this surface
 * minimal — tools should only depend on what they actually use.
 */
export interface ToolContext {
  profile: UserProfileStore;
  chat: ChatStore;
  notes: NotesStore;
  summary: SummaryStore;
  bridge: BridgeStore;
  execStream: ExecStreamStore;
  /** The thread the tool was called from. Useful for thread-scoped writes. */
  threadId: string;
}

export type ToolCategory = 'memory' | 'workspace' | 'filesystem' | 'shell' | 'git' | 'thread' | 'notes' | 'time';

export interface ToolResultPolicy {
  /** Default max chars returned to the model before compaction. */
  maxChars?: number;
  /** Whether large results should be compacted before the next model round. */
  summarizeLargeOutput?: boolean;
}

export interface ToolMetadata {
  category: ToolCategory;
  resultPolicy?: ToolResultPolicy;
  isReadOnly?: (args: Record<string, unknown>) => boolean;
  hasSideEffects?: (args: Record<string, unknown>) => boolean;
}

/**
 * A registered tool. `def` is what the model sees (sent in `LlmRequest.tools`);
 * `execute` runs locally with the parsed args and returns a string the model
 * gets back as a tool-result message.
 *
 * The string return is intentional — every provider serializes tool results
 * as a string. If your tool wants to return JSON, stringify it.
 */
export interface Tool {
  def: ToolDef;
  meta?: ToolMetadata;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

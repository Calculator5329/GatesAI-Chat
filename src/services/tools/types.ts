import type { LlmMessage, ToolDef } from '../../core/llm';
import type { Note } from '../../core/notes';
import type { Thread, ToolResultArtifact } from '../../core/types';

/**
 * Runtime context passed to every tool. Add fields here as tools need them
 * (e.g. an HTTP client, a fetcher for `web_search`). Keep this surface
 * minimal — tools should only depend on what they actually use.
 */
export interface ProfileFacade {
  readonly facts: string[];
  addFact(fact: string): boolean;
  removeFactAt(index: number): string | null;
  removeFactMatching(match: string): string | null;
  updateFactAt(index: number, next: string): string | null;
  updateFactMatching(match: string, next: string): string | null;
}

export interface ChatFacade {
  readonly threads: Thread[];
  selectThread(id: string): void;
  renameThread(id: string, title: string): void;
  setThreadContext(id: string, context: string): void;
  llmComplete(messages: Pick<LlmMessage, 'role' | 'content'>[], systemPrompt?: string): Promise<string>;
}

export interface NotesFacade {
  readonly sortedByRecency: Note[];
  create(input: { title: string; body: string; tags?: string[] }): Note;
  findById(id: string): Note | null;
  update(id: string, patch: { title?: string; body?: string; tags?: string[] }): Note | null;
  remove(id: string): Note | null;
  search(query: string): Note[];
}

export interface SummaryFacade {
  summarizeNow(threadId: string): Promise<boolean>;
}

export interface BridgeClientFacade {
  request<T = unknown>(
    op: string,
    data: unknown,
    onEvent?: (data: unknown) => void,
  ): Promise<T>;
}

export interface BridgeFacade {
  readonly isOnline: boolean;
  readonly state?: string;
  readonly version?: string;
  readonly platform?: string;
  readonly workspaceRoot?: string;
  readonly allowlist?: string[];
  readonly client: BridgeClientFacade;
  readAttachmentBase64(path: string): Promise<{ base64: string; mime: string; size: number } | null>;
}

import type { ImageBackendId, ImageBackendSnapshot } from '../image/types';
export type { ImageBackendId, ImageBackendSnapshot };

export interface ImageGenFacade {
  readonly backend: ImageBackendId;
  getCredential(backend?: ImageBackendId): string | null;
  /** Plain snapshot consumed by the dispatcher. */
  toBackendConfig(): ImageBackendSnapshot;
  /** User-configured /workspace/ path to a ComfyUI workflow override. */
  readonly comfyWorkflowPath?: string;
}

export interface LocalRuntimeFacade {
  readonly ollamaBaseUrl: string;
  readonly comfyBaseUrl?: string;
  readonly visionModel?: string;
}

export interface ExecStreamFacade {
  start(jobId: string, command: string, args: string[]): void;
  appendChunk(jobId: string, stream: 'stdout' | 'stderr', chunk: string): void;
  finish(jobId: string, exitCode: number, durationMs: number): void;
  fail(jobId: string, message: string): void;
}

export interface ToolContext {
  profile: ProfileFacade;
  chat: ChatFacade;
  notes?: NotesFacade;
  summary?: SummaryFacade;
  bridge?: BridgeFacade;
  imageGen?: ImageGenFacade;
  localRuntime?: LocalRuntimeFacade;
  execStream?: ExecStreamFacade;
  /** The thread the tool was called from. Useful for thread-scoped writes. */
  threadId: string;
}

export type ToolCategory = 'memory' | 'workspace' | 'filesystem' | 'shell' | 'git' | 'thread' | 'notes' | 'time' | 'vision';

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
 * Structured tool output. Tools may return either a bare string (the common
 * case) or this shape when they also need to surface UI artifacts. The
 * model only ever sees `content`; `artifacts` is a side-channel for the UI.
 */
export interface ToolExecuteResult {
  content: string;
  artifacts?: ToolResultArtifact[];
}

/**
 * A registered tool. `def` is what the model sees (sent in `LlmRequest.tools`);
 * `execute` runs locally with the parsed args and returns either a string the
 * model gets back as a tool-result message, or a structured result with
 * optional artifacts the UI can render directly.
 *
 * Every provider serializes tool results as a string — if a tool wants to
 * return JSON to the model, stringify it into `content`.
 */
export interface Tool {
  def: ToolDef;
  meta?: ToolMetadata;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string | ToolExecuteResult>;
}

// Defines the types tool contract, validation, execution, or display formatting.
// Called by ChatStore tool rounds via the registry; depends on ToolContext facades and bridge/store services.
// Invariant: tools validate inputs first and return deterministic, user-readable results.
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
  selectThread(id: string): boolean;
  renameThread(id: string, title: string): void;
  setThreadContext(id: string, context: string): void;
  llmComplete(messages: Pick<LlmMessage, 'role' | 'content'>[], systemPrompt?: string): Promise<string>;
  hasRunningAgentTask?(): boolean;
  spawnTask?(input: {
    title: string;
    instructions: string;
    model?: string;
    system_prompt?: string;
    max_rounds?: number;
    start_delay_minutes?: number;
  }, originThreadId: string): { ok: boolean; message: string; threadId?: string };
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
    options?: { privileged?: boolean; timeoutMs?: number | null; resetTimeoutOnEvent?: boolean },
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

import type { ImageBackendId, ImageBackendSnapshot, LocalComfyMode } from '../image/types';
import type { CompletedJob, ImageJob } from '../image/jobs/types';
import type { BraveFreshness, BraveSearchQueryResult } from '../search/types';
export type { ImageBackendId, ImageBackendSnapshot, LocalComfyMode };

export interface ImageGenFacade {
  readonly backend: ImageBackendId;
  getCredential(backend?: ImageBackendId): string | null;
  /** Plain snapshot consumed by the dispatcher. */
  toBackendConfig(): ImageBackendSnapshot;
  /** User-configured /workspace/ path to a ComfyUI workflow override. */
  readonly comfyWorkflowPath?: string;
}

export interface ImageJobsFacade {
  findById?(jobId: string): ImageJob | CompletedJob | null;
  enqueue(input: {
    threadId: string;
    prompt: string;
    count: number;
    width: number;
    height: number;
    seed?: number;
    backend: ImageBackendId;
    /** Direct-image ComfyUI mode override, independent from Local defaults. */
    comfyMode?: LocalComfyMode;
    /** Slug used by local backends to control where the file lands. */
    filenamePrefix?: string;
    /** Whether the chat should post a terminal follow-up when this job ends. */
    notifyOnTerminal?: boolean;
  }): { jobId: string; count: number };
}

export interface LocalRuntimeFacade {
  readonly ollamaBaseUrl: string;
  readonly comfyBaseUrl?: string;
  readonly comfyReady: boolean;
  readonly visionModel?: string;
}

export interface ExecStreamFacade {
  readonly jobs?: Record<string, {
    id: string;
    threadId?: string;
    toolCallId?: string;
    cmd: string;
    args: string[];
    startedAt: number;
    tail: Array<{ stream: 'stdout' | 'stderr'; text: string }>;
    status: 'running' | 'done' | 'error';
    exitCode?: number;
    durationMs?: number;
  }>;
  start(jobId: string, command: string, args: string[], meta?: { threadId?: string; toolCallId?: string }): void;
  appendChunk(jobId: string, stream: 'stdout' | 'stderr', chunk: string): void;
  finish(jobId: string, exitCode: number, durationMs: number): void;
  fail(jobId: string, message: string): void;
}

export interface SearchFacade {
  readonly braveReady: boolean;
  searchBraveContext(input: {
    queries: string[];
    freshness?: BraveFreshness;
    country?: string;
    searchLang?: string;
    signal?: AbortSignal;
  }): Promise<BraveSearchQueryResult[]>;
}

export interface RagFacade {
  readonly active: boolean;
  recall(query: string, k?: number): Promise<string>;
}

export interface ArtifactValidationFacade {
  smokeRender(html: string, options?: { signal?: AbortSignal }): Promise<{
    ok: boolean;
    errors: string[];
  }>;
}

export interface ArtifactRegistryFacade {
  refresh(): Promise<void>;
}

export interface ArtifactSurfaceFacade {
  openArtifact(id: string, cell?: 0 | 1): void;
}

export interface ToolContext {
  profile: ProfileFacade;
  chat: ChatFacade;
  notes?: NotesFacade;
  summary?: SummaryFacade;
  bridge?: BridgeFacade;
  imageGen?: ImageGenFacade;
  imageJobs?: ImageJobsFacade;
  localRuntime?: LocalRuntimeFacade;
  execStream?: ExecStreamFacade;
  search?: SearchFacade;
  rag?: RagFacade;
  artifactValidation?: ArtifactValidationFacade;
  artifacts?: ArtifactRegistryFacade;
  artifactSurface?: ArtifactSurfaceFacade;
  /** The thread the tool was called from. Useful for thread-scoped writes. */
  threadId: string;
  /** The provider tool-call id that triggered this execution. */
  toolCallId?: string;
  /** Aborts when the calling assistant turn is interrupted. */
  signal?: AbortSignal;
}

export type ToolCategory = 'memory' | 'workspace' | 'filesystem' | 'shell' | 'git' | 'thread' | 'notes' | 'time' | 'vision' | 'web' | 'diagnostics' | 'mcp';

export interface ToolResultPolicy {
  /** Default max chars returned to the model before compaction. */
  maxChars?: number;
  /** Whether large results should be compacted before the next model round. */
  summarizeLargeOutput?: boolean;
}

export interface ToolMetadata {
  category: ToolCategory;
  /** Capability id used by runtime/tool gating and UI copy as the manifest consolidates. */
  capabilityId?: string;
  /** Short hints for deciding when the model should see this tool. */
  selectionHints?: string[];
  /** Coarse side-effect risk for policy/UI grouping. */
  risk?: 'low' | 'medium' | 'high';
  resultPolicy?: ToolResultPolicy;
  isReadOnly?: (args: Record<string, unknown>) => boolean;
  hasSideEffects?: (args: Record<string, unknown>) => boolean;
  validate?: (args: Record<string, unknown>) => ToolValidationIssue | null;
}

export interface ToolValidationIssue {
  errorCode: string;
  summary: string;
  fix?: string;
  retryable?: boolean;
}

export type ToolOutcome =
  | {
      ok: true;
      summary: string;
      data?: unknown;
      artifacts?: ToolResultArtifact[];
    }
  | {
      ok: false;
      errorCode: string;
      summary: string;
      fix?: string;
      retryable: boolean;
      data?: unknown;
    };

/**
 * Structured tool output. Tools may return either a bare string (the common
 * case) or this shape when they also need to surface UI artifacts. The
 * model only ever sees `content`; `artifacts` is a side-channel for the UI.
 */
export interface ToolExecuteResult {
  content: string;
  summary?: string;
  artifacts?: ToolResultArtifact[];
  ok?: boolean;
  errorCode?: string;
  retryable?: boolean;
  data?: unknown;
}

export interface ToolActivityUi {
  verb: (args: Record<string, unknown>) => string;
  target?: (args: Record<string, unknown>) => string | undefined;
  summary?: (result: ToolExecuteResult) => string | undefined;
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
  ui?: ToolActivityUi;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string | ToolExecuteResult | ToolOutcome>;
}

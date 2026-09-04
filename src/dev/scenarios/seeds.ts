// Seed data for scenarios: persisted threads, profile, image jobs, workspace
// files. Ported from tests/e2e/screensTour.spec.ts so both harnesses show the
// same conversations.
import appPackage from '../../../package.json';
import type { BridgeFile } from './types';

export const STORAGE_KEYS = {
  uiPrefs: 'gatesai.uiprefs.v1',
  providers: 'gatesai.providers.v1',
  search: 'gatesai.search.v1',
  state: 'gatesai.state.v1',
  profile: 'gatesai.profile.v1',
  imageJobs: 'gatesai.imagejobs.v1',
  ragSettings: 'gatesai.rag.settings.v2',
  userGuideOpened: 'gatesai.userGuide.opened.v1',
  menuHintSeen: 'gatesai.menuHintSeen.v1',
  whatsNew: 'gatesai.whatsNew.v1',
  library: 'gatesai.library.v1',
  ollama: 'gatesai.ollama.v1',
} as const;

/** The version the running app reports; whats-new compares against it. */
export const APP_VERSION: string = appPackage.version;

export const CLOUD_MODEL_ID = 'or-gemini-3-flash';
export const LOCAL_MODEL_ID = 'ollama-qwen2.5:7b';
export const LOCAL_IMAGE_MODEL_ID = 'image-direct-comfy';
export const LOCAL_PROVIDER_MODEL_ID = 'qwen2.5:7b';
export const CLOUD_PROVIDER_MODEL_ID = 'openrouter/google/gemini-3-flash-preview';

export const CLOUD_REPLY = [
  'Here is a short implementation note for the tour.',
  '',
  '1. Seed a deterministic starting state before the stores boot.',
  '2. Answer every network seam from a local mock so no key or bridge is needed.',
  '3. Drive the UI through identified controls only, and record what was observed.',
  '',
  'The mocked reply is intentionally plain so the layout, not the prose, is under review.',
].join('\n');

/** What the mocked OpenRouter stream answers for a fresh turn; distinct from the seeded transcript so a journey can tell them apart. */
export const STREAMED_REPLY = 'The mocked OpenRouter stream answered this turn. Nothing left the machine, and every replay reads the same.';

export const LOCAL_REPLY = 'Mock local reply from Ollama. This turn never left the machine.';

interface SeedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  model?: string;
  workNotes?: string[];
  attachments?: Array<{ id: string; path: string; name: string; mime: string; size: number }>;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  toolResults?: Array<{
    toolCallId: string;
    toolName: string;
    content: string;
    summary: string;
    ok: boolean;
    durationMs: number;
    outputChars: number;
    ranAt: number;
    artifacts?: Array<Record<string, unknown>>;
  }>;
  usage?: Array<Record<string, unknown>>;
  retrievalTrace?: Record<string, unknown>;
}

export interface SeedThread {
  id: string;
  title: string;
  subtitle: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  modelId: string;
  contextMode?: string;
  summary?: string;
  summaryUpdatedAt?: number;
  summaryMessageCount?: number;
  agentTask?: boolean;
  agentTaskOriginThreadId?: string;
  agentTaskStatus?: 'scheduled' | 'running' | 'done' | 'error' | 'interrupted';
  agentTaskScheduledStartAt?: number;
  messages: SeedMessage[];
}

function cloudUsage(promptTokens: number, completionTokens: number, costUsd: number) {
  return {
    providerId: 'openrouter',
    modelId: CLOUD_PROVIDER_MODEL_ID,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    costUsd,
    costSource: 'pricing',
  };
}

function localUsage(promptTokens: number, completionTokens: number) {
  return {
    providerId: 'ollama',
    modelId: LOCAL_PROVIDER_MODEL_ID,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    costUsd: 0,
    costSource: 'local',
  };
}

export function readyThreads(now: number): SeedThread[] {
  const userAt = now - 600_000;
  const assistantAt = now - 590_000;
  return [
    {
      id: 'active',
      title: 'Screenshot tour planning',
      subtitle: 'Realistic chat content for UX audit screenshots',
      createdAt: now - 3_600_000,
      updatedAt: now - 580_000,
      pinned: true,
      modelId: CLOUD_MODEL_ID,
      summary: 'Defines the screenshot corpus needed for future design and UX reviews.',
      summaryUpdatedAt: now - 300_000,
      summaryMessageCount: 2,
      messages: [
        { id: 'active-user', role: 'user', content: 'Can you outline the screenshot tour harness and what it should cover?', createdAt: userAt },
        {
          id: 'active-assistant',
          role: 'assistant',
          content: CLOUD_REPLY,
          createdAt: assistantAt,
          model: CLOUD_MODEL_ID,
          usage: [cloudUsage(1180, 420, 0.0021)],
          retrievalTrace: {
            version: 1,
            purpose: 'automatic_context',
            usedAt: assistantAt - 1_000,
            generationId: 'tour-generation',
            model: 'nomic-embed-text',
            rankingPolicyVersion: 1,
            items: [{
              reference: 'message:tool-user',
              sourceType: 'message',
              sourceId: 'tool-user',
              threadId: 'tool',
              role: 'user',
              title: 'Tool activity example',
              sourceTimestamp: now - 2_780_000,
              excerpt: 'Run the test suite and summarize the result.',
              denseRank: 2,
              lexicalRank: 1,
              fusedRank: 1,
            }, {
              reference: 'note:audit-plan',
              sourceType: 'note',
              sourceId: 'audit-plan',
              title: 'Audit plan',
              sourceTimestamp: now - 2_000_000,
              excerpt: 'Review open models first, then inspect each active menu surface.',
              denseRank: 3,
              fusedRank: 2,
            }],
          },
        },
      ],
    },
    {
      id: 'tool',
      title: 'Tool activity example',
      subtitle: 'Assistant turn with a terminal timeline row',
      createdAt: now - 2_800_000,
      updatedAt: now - 2_700_000,
      pinned: false,
      modelId: CLOUD_MODEL_ID,
      summary: 'Shows how terminal activity appears above the final answer.',
      summaryUpdatedAt: now - 2_650_000,
      summaryMessageCount: 2,
      messages: [
        { id: 'tool-user', role: 'user', content: 'Run the test suite and summarize the result.', createdAt: now - 2_780_000 },
        {
          id: 'tool-assistant',
          role: 'assistant',
          content: 'The unit tests passed. I would still run the normal e2e suite after regenerating screenshots.',
          createdAt: now - 2_770_000,
          model: CLOUD_MODEL_ID,
          workNotes: ['Checking the project scripts before running validation.'],
          toolCalls: [{ id: 'call-terminal-tests', name: 'terminal', arguments: { cmd: 'npm', args: ['test'], cwd: '/workspace' } }],
          toolResults: [{
            toolCallId: 'call-terminal-tests',
            toolName: 'terminal',
            content: '$ npm test\n[exit 0, 1843ms]\n--- stdout ---\nPASS tests/chat/screenshotTour.test.ts\nTests: 42 passed',
            summary: 'Ran npm test',
            ok: true,
            durationMs: 1843,
            outputChars: 96,
            ranAt: now - 2_765_000,
          }],
          usage: [cloudUsage(950, 210, 0.0015)],
        },
      ],
    },
    {
      id: 'agent-task',
      title: 'Audit menu copy',
      subtitle: 'Background task',
      createdAt: now - 900_000,
      updatedAt: now - 850_000,
      pinned: false,
      modelId: CLOUD_MODEL_ID,
      agentTask: true,
      agentTaskOriginThreadId: 'active',
      agentTaskStatus: 'scheduled',
      agentTaskScheduledStartAt: now + 3_600_000,
      messages: [
        { id: 'task-user', role: 'user', content: 'Review menu copy for the next design pass.', createdAt: now - 900_000 },
      ],
    },
    {
      id: 'usage',
      title: 'Usage rollup sample',
      subtitle: 'Token and cost rows',
      createdAt: now - 86_400_000,
      updatedAt: now - 86_000_000,
      pinned: false,
      modelId: CLOUD_MODEL_ID,
      messages: [
        { id: 'usage-user', role: 'user', content: 'Give me a short usage example.', createdAt: now - 86_400_000 },
        {
          id: 'usage-assistant',
          role: 'assistant',
          content: 'This thread exists so the Usage screen has realistic totals.',
          createdAt: now - 86_390_000,
          model: CLOUD_MODEL_ID,
          usage: [{ ...cloudUsage(2400, 780, 0.0112), modelId: 'openrouter/anthropic/claude-sonnet-4.5' }],
        },
      ],
    },
  ];
}

export function localOnlyThreads(now: number): SeedThread[] {
  return [{
    id: 'local-active',
    title: 'Local-only planning',
    subtitle: 'Ollama private model workflow',
    createdAt: now - 900_000,
    updatedAt: now - 300_000,
    pinned: true,
    modelId: LOCAL_MODEL_ID,
    contextMode: 'micro',
    summary: 'Exercises local-only usage, picker, and menu screenshots.',
    messages: [
      { id: 'local-user', role: 'user', content: 'Can you keep this workflow fully local?', createdAt: now - 600_000 },
      {
        id: 'local-assistant',
        role: 'assistant',
        content: 'Yes. This thread is pinned to an Ollama model, and usage is tracked as local tokens with no cloud spend.',
        createdAt: now - 590_000,
        model: LOCAL_MODEL_ID,
        usage: [localUsage(840, 260)],
      },
    ],
  }];
}

export function readyProfile() {
  return {
    bio: [
      '- User prefers concise engineering notes.',
      '- Current project is GatesAI Chat journey coverage.',
    ].join('\n'),
    defaultSystemPrompt: 'Prefer direct, practical answers and call out verification gaps.',
  };
}

export function readyImageJobs(now: number) {
  return [{
    id: 'img-tour',
    threadId: 'active',
    prompt: 'A polished app workspace screenshot thumbnail',
    count: 2,
    width: 512,
    height: 512,
    backend: 'openrouter-image',
    status: 'done',
    results: ['/workspace/artifacts/images/tour-1.png', '/workspace/artifacts/images/tour-2.png'],
    costUsd: 0.08,
    createdAt: now - 2_400_000,
    completedAt: now - 2_350_000,
  }];
}

export function defaultRagSettings() {
  return {
    autoInject: true,
    embeddingModel: 'nomic-embed-text',
    sourceTypes: { message: true, note: true, memory: true },
    excludedSources: [],
  };
}

export function workspaceFiles(): BridgeFile[] {
  return [
    { path: '/workspace/skills', name: 'skills', kind: 'dir' },
    {
      path: '/workspace/skills/review.md',
      name: 'review.md',
      kind: 'file',
      mime: 'text/markdown',
      content: [
        '---',
        'name: review',
        'description: Review product surfaces for clarity, hierarchy, and regression risk.',
        'tools: fs, inspect_file',
        '---',
        'Use screenshots first, then inspect code only for ambiguous behavior.',
      ].join('\n'),
    },
    {
      path: '/workspace/skills/research.md',
      name: 'research.md',
      kind: 'file',
      mime: 'text/markdown',
      content: [
        '---',
        'name: research',
        'description: Gather workspace context and produce grounded design notes.',
        'tools: fs, web_search',
        '---',
        'Favor concrete evidence and cite artifacts when available.',
      ].join('\n'),
    },
    { path: '/workspace/attachments', name: 'attachments', kind: 'dir' },
    { path: '/workspace/attachments/requirements.md', name: 'requirements.md', kind: 'file', mime: 'text/markdown', content: '# Requirements\nCover every app surface with a journey.' },
    { path: '/workspace/notes', name: 'notes', kind: 'dir' },
    { path: '/workspace/notes/audit-plan.md', name: 'audit-plan.md', kind: 'file', mime: 'text/markdown', content: '# Audit plan\nReview open models first.' },
    { path: '/workspace/artifacts', name: 'artifacts', kind: 'dir' },
    { path: '/workspace/artifacts/journeys.json', name: 'journeys.json', kind: 'file', mime: 'application/json', content: '{"journeys":"catalog"}' },
    { path: '/workspace/artifacts/images', name: 'images', kind: 'dir' },
    { path: '/workspace/artifacts/images/tour-1.png', name: 'tour-1.png', kind: 'file', mime: 'image/png', size: 345 },
    { path: '/workspace/artifacts/images/tour-2.png', name: 'tour-2.png', kind: 'file', mime: 'image/png', size: 345 },
  ];
}

interface SeedOptions {
  readyProvider: boolean;
  braveKey?: boolean;
  onboardingDismissed: boolean;
  theme?: 'dark' | 'light' | 'system';
  threads?: SeedThread[];
  activeThreadId?: string;
  profile?: ReturnType<typeof readyProfile>;
  imageJobs?: Array<ReturnType<typeof readyImageJobs>[number] | ReturnType<typeof coverageImageJobs>[number]>;
  ragSettings?: ReturnType<typeof defaultRagSettings>;
  /**
   * Version the user last acknowledged. Defaults to the running version so
   * neither the whats-new panel nor the welcome tour thread appears; pass an
   * older version to make the panel show, or null to simulate a true first
   * boot (welcome tour seeded).
   */
  lastSeenVersion?: string | null;
  /** False leaves the "Settings & menu live here" coach mark showing. Defaults to true. */
  menuHintSeen?: boolean;
  /** Ollama tag names persisted from an earlier session, so local models resolve while the server is unreachable. */
  ollamaCatalog?: string[];
  uiPack?: 'classic' | 'aurora';
  /** Approved knowledge-library sources (paths must exist in the bridge file table). */
  library?: Array<{ id: string; path: string; title: string; kind: 'document' | 'database'; enabled: boolean; addedAt: number }>;
}

/** Build the localStorage map for a scenario. */
export function buildSeed(options: SeedOptions): Record<string, unknown> {
  const seed: Record<string, unknown> = {
    [STORAGE_KEYS.userGuideOpened]: '1',
    [STORAGE_KEYS.uiPrefs]: {
      onboardingDismissed: options.onboardingDismissed,
      ...(options.theme ? { theme: options.theme } : {}),
      ...(options.uiPack ? { uiPack: options.uiPack } : {}),
    },
  };
  if (options.menuHintSeen !== false) seed[STORAGE_KEYS.menuHintSeen] = '1';
  if (options.library) seed[STORAGE_KEYS.library] = { sources: options.library };
  if (options.ollamaCatalog) {
    seed[STORAGE_KEYS.ollama] = {
      toolsEnabled: true,
      tagNames: options.ollamaCatalog,
      lastRefreshAt: Date.now() - 3_600_000,
      catalog: options.ollamaCatalog.map(tag => ({
        id: `ollama-${tag}`,
        providerId: 'ollama',
        providerModelId: tag,
        name: tag,
        vendor: 'Ollama',
        dynamic: true,
        supportsVision: false,
        supportsTools: true,
      })),
    };
  }
  if (options.readyProvider) seed[STORAGE_KEYS.providers] = { openrouter: { apiKey: 'test-key' } };
  if (options.braveKey) seed[STORAGE_KEYS.search] = { brave: { apiKey: 'test-brave-key' } };
  if (options.threads) {
    seed[STORAGE_KEYS.state] = {
      threads: options.threads,
      activeThreadId: options.activeThreadId ?? options.threads[0]?.id ?? null,
    };
  }
  if (options.profile) seed[STORAGE_KEYS.profile] = options.profile;
  if (options.imageJobs) seed[STORAGE_KEYS.imageJobs] = { history: options.imageJobs };
  if (options.ragSettings) seed[STORAGE_KEYS.ragSettings] = options.ragSettings;
  if (options.lastSeenVersion !== null) {
    seed[STORAGE_KEYS.whatsNew] = { lastSeenVersion: options.lastSeenVersion ?? APP_VERSION, tourThreadSeeded: true };
  }
  return seed;
}

/** A complete HTML document: the code block gains its Preview toggle and the saved copy gets an inline artifact card. */
export const HTML_DOCUMENT = [
  '<!doctype html>',
  '<html lang="en">',
  '<head><meta charset="utf-8"><title>Preview works</title></head>',
  '<body><h1>Preview works</h1><p>Rendered inside a sandboxed frame.</p></body>',
  '</html>',
].join('\n');

const HTML_REPLY = [
  'Here is the landing page as a complete document:',
  '',
  '```html',
  HTML_DOCUMENT,
  '```',
  '',
  'The saved copy lives at `/workspace/site/index.html`, and the plan is in `/workspace/notes/audit-plan.md`.',
  'The upstream reference is [the journey catalog](https://example.test/journeys).',
].join('\n');

function terminalResult(id: string, cmd: string, ranAt: number) {
  return {
    toolCallId: id,
    toolName: 'terminal',
    content: `$ ${cmd}\n[exit 0, 412ms]\n--- stdout ---\nok`,
    summary: `Ran ${cmd}`,
    ok: true,
    durationMs: 412,
    outputChars: 40,
    ranAt,
  };
}

/** Threads that exercise transcript surfaces desktop-ready leaves untouched: HTML artifacts, paging, attachments, confirm panels, grouped activity, memory sources and image job states. */
export function coverageThreads(now: number): SeedThread[] {
  const longMessages: SeedMessage[] = [];
  for (let i = 0; i < 66; i += 1) {
    const at = now - 5_000_000 + i * 20_000;
    longMessages.push({ id: `long-user-${i + 1}`, role: 'user', content: `Question ${i + 1} of a long conversation.`, createdAt: at });
    longMessages.push({ id: `long-assistant-${i + 1}`, role: 'assistant', content: `Answer ${i + 1}. Earlier turns collapse behind a control once the transcript passes one page.`, createdAt: at + 5_000, model: CLOUD_MODEL_ID });
  }
  return [
    {
      id: 'html',
      title: 'HTML artifact reply',
      subtitle: 'Complete document, saved copy, links',
      createdAt: now - 400_000,
      updatedAt: now - 390_000,
      pinned: false,
      modelId: CLOUD_MODEL_ID,
      messages: [
        { id: 'html-user', role: 'user', content: 'Write the landing page and tell me where you saved it.', createdAt: now - 400_000 },
        { id: 'html-assistant', role: 'assistant', content: HTML_REPLY, createdAt: now - 395_000, model: CLOUD_MODEL_ID, usage: [cloudUsage(600, 300, 0.0012)] },
      ],
    },
    {
      id: 'long',
      title: 'Long conversation',
      subtitle: 'Eighty-four messages',
      createdAt: now - 5_000_000,
      updatedAt: now - 4_100_000,
      pinned: false,
      modelId: CLOUD_MODEL_ID,
      messages: longMessages,
    },
    {
      id: 'attached',
      title: 'Message with attachments',
      subtitle: 'An image and a document',
      createdAt: now - 700_000,
      updatedAt: now - 690_000,
      pinned: false,
      modelId: CLOUD_MODEL_ID,
      messages: [
        {
          id: 'attached-user',
          role: 'user',
          content: 'Two files attached: the diagram and the requirements.',
          createdAt: now - 700_000,
          attachments: [
            { id: 'att-diagram', path: '/workspace/attachments/diagram.png', name: 'diagram.png', mime: 'image/png', size: 345 },
            { id: 'att-requirements', path: '/workspace/attachments/requirements.md', name: 'requirements.md', mime: 'text/markdown', size: 52 },
          ],
        },
        { id: 'attached-assistant', role: 'assistant', content: 'Both files are readable. The diagram shows one field and the requirements ask for full journey coverage.', createdAt: now - 695_000, model: CLOUD_MODEL_ID },
      ],
    },
    {
      id: 'middle',
      title: 'Four-turn exchange',
      subtitle: 'Editing an early turn needs a confirm',
      createdAt: now - 800_000,
      updatedAt: now - 780_000,
      pinned: false,
      modelId: CLOUD_MODEL_ID,
      messages: [
        { id: 'middle-user-1', role: 'user', content: 'First question.', createdAt: now - 800_000 },
        { id: 'middle-assistant-1', role: 'assistant', content: 'First answer.', createdAt: now - 795_000, model: CLOUD_MODEL_ID },
        { id: 'middle-user-2', role: 'user', content: 'Second question.', createdAt: now - 790_000 },
        { id: 'middle-assistant-2', role: 'assistant', content: 'Second answer.', createdAt: now - 785_000, model: CLOUD_MODEL_ID },
      ],
    },
    {
      id: 'grouped',
      title: 'Grouped terminal activity',
      subtitle: 'Two commands in one turn',
      createdAt: now - 1_000_000,
      updatedAt: now - 990_000,
      pinned: false,
      modelId: CLOUD_MODEL_ID,
      messages: [
        { id: 'grouped-user', role: 'user', content: 'Lint and typecheck, then report.', createdAt: now - 1_000_000 },
        {
          id: 'grouped-assistant',
          role: 'assistant',
          content: 'Both commands passed.',
          createdAt: now - 995_000,
          model: CLOUD_MODEL_ID,
          toolCalls: [
            { id: 'call-lint', name: 'terminal', arguments: { cmd: 'npm', args: ['run', 'lint'], cwd: '/workspace' } },
            { id: 'call-typecheck', name: 'terminal', arguments: { cmd: 'npm', args: ['run', 'typecheck'], cwd: '/workspace' } },
          ],
          toolResults: [terminalResult('call-lint', 'npm run lint', now - 994_000), terminalResult('call-typecheck', 'npm run typecheck', now - 993_000)],
        },
      ],
    },
    {
      id: 'memory',
      title: 'Memory sources of every kind',
      subtitle: 'Open, unavailable and library sources',
      createdAt: now - 1_200_000,
      updatedAt: now - 1_190_000,
      pinned: false,
      modelId: CLOUD_MODEL_ID,
      messages: [
        { id: 'memory-user', role: 'user', content: 'What did we decide about the audit?', createdAt: now - 1_200_000 },
        {
          id: 'memory-assistant',
          role: 'assistant',
          content: 'Open models first, then each active menu surface. The library document agrees.',
          createdAt: now - 1_195_000,
          model: CLOUD_MODEL_ID,
          retrievalTrace: {
            version: 1,
            purpose: 'automatic_context',
            usedAt: now - 1_196_000,
            generationId: 'memory-generation',
            model: 'nomic-embed-text',
            rankingPolicyVersion: 1,
            items: [
              { reference: 'message:tool-user', sourceType: 'message', sourceId: 'tool-user', threadId: 'tool', role: 'user', title: 'Tool activity example', sourceTimestamp: now - 2_780_000, excerpt: 'Run the test suite and summarize the result.', denseRank: 1, fusedRank: 1 },
              { reference: 'message:vanished-user', sourceType: 'message', sourceId: 'vanished-user', threadId: 'vanished', role: 'user', title: 'A deleted conversation', sourceTimestamp: now - 3_000_000, excerpt: 'This conversation was deleted after the index was built.', denseRank: 2, fusedRank: 2 },
              { reference: 'library:lib-audit', sourceType: 'library', sourceId: 'lib-audit', title: 'Audit plan', sourceTimestamp: now - 2_000_000, excerpt: 'Review open models first.', denseRank: 3, fusedRank: 3 },
            ],
          },
        },
      ],
    },
    {
      id: 'images',
      title: 'Image jobs in every state',
      subtitle: 'Done, failed and cancelled renders',
      createdAt: now - 1_500_000,
      updatedAt: now - 1_400_000,
      pinned: false,
      modelId: CLOUD_MODEL_ID,
      messages: [
        { id: 'images-user', role: 'user', content: 'Render the seal three ways.', createdAt: now - 1_500_000 },
        ...(['img-tour', 'img-failed', 'img-cancelled'] as const).map((jobId, index) => ({
          id: `images-assistant-${index + 1}`,
          role: 'assistant' as const,
          content: index === 0 ? 'The first render finished.' : index === 1 ? 'The second render failed upstream.' : 'The third render was cancelled.',
          createdAt: now - 1_490_000 + index * 20_000,
          model: CLOUD_MODEL_ID,
          toolCalls: [{ id: `call-${jobId}`, name: 'image_generate', arguments: { prompt: 'A wax seal with the letter G', count: index === 0 ? 2 : 1 } }],
          toolResults: [{
            toolCallId: `call-${jobId}`,
            toolName: 'image_generate',
            content: `Queued image job ${jobId}`,
            summary: 'Queued an image render',
            ok: true,
            durationMs: 5,
            outputChars: 24,
            ranAt: now - 1_489_000 + index * 20_000,
            artifacts: [{ kind: 'image-job', jobId, count: index === 0 ? 2 : 1 }],
          }],
        })),
      ],
    },
  ];
}

/** Terminal-state jobs referenced by the `images` thread; only completed jobs persist. */
export function coverageImageJobs(now: number) {
  return [
    {
      id: 'img-failed',
      threadId: 'images',
      prompt: 'A wax seal with the letter G, failed attempt',
      count: 1,
      width: 512,
      height: 512,
      backend: 'openrouter-image',
      status: 'failed',
      results: [],
      error: 'Provider returned 429 Too Many Requests (mocked).',
      createdAt: now - 1_470_000,
      completedAt: now - 1_465_000,
    },
    {
      id: 'img-cancelled',
      threadId: 'images',
      prompt: 'A wax seal with the letter G, cancelled attempt',
      count: 1,
      width: 512,
      height: 512,
      backend: 'openrouter-image',
      status: 'cancelled',
      results: [],
      createdAt: now - 1_450_000,
      completedAt: now - 1_445_000,
    },
  ];
}

/** Extra workspace files the coverage threads point at. */
export function coverageFiles(): BridgeFile[] {
  return [
    { path: '/workspace/site', name: 'site', kind: 'dir' },
    { path: '/workspace/site/index.html', name: 'index.html', kind: 'file', mime: 'text/html', content: HTML_DOCUMENT },
    { path: '/workspace/attachments/diagram.png', name: 'diagram.png', kind: 'file', mime: 'image/png', size: 345 },
    { path: '/workspace/attachments/notes.txt', name: 'notes.txt', kind: 'file', mime: 'text/plain', content: 'Plain text attachment for the composer tray.' },
    { path: '/workspace/media', name: 'media', kind: 'dir' },
    { path: '/workspace/media/clip.mp3', name: 'clip.mp3', kind: 'file', mime: 'audio/mpeg', size: 1 },
    { path: '/workspace/media/still.png', name: 'still.png', kind: 'file', mime: 'image/png', size: 345 },
    // Paths containing "broken" fail every base64 read in the bridge mock, so
    // the media viewer's error states are reachable.
    { path: '/workspace/media/broken.mp4', name: 'broken.mp4', kind: 'file', mime: 'video/mp4', size: 1 },
    { path: '/workspace/media/broken.png', name: 'broken.png', kind: 'file', mime: 'image/png', size: 1 },
    { path: '/workspace/notes/config.json', name: 'config.json', kind: 'file', mime: 'application/json', content: JSON.stringify({ theme: 'dark', models: ['qwen2.5:7b'] }, null, 2) },
    // No content and not an image: the utf8 read fails, so the file viewer shows its notice.
    { path: '/workspace/notes/unreadable.txt', name: 'unreadable.txt', kind: 'file', mime: 'text/plain', size: 12 },
    { path: '/workspace/artifacts', name: 'artifacts', kind: 'dir' },
    { path: '/workspace/artifacts/html', name: 'html', kind: 'dir' },
    {
      path: '/workspace/artifacts/html/index.json',
      name: 'index.json',
      kind: 'file',
      mime: 'application/json',
      content: JSON.stringify({
        version: 1,
        artifacts: [{ id: 'landing', title: 'Landing page', threadId: 'html', createdAt: '2026-09-01T10:30:00.000Z', updatedAt: '2026-09-01T10:30:00.000Z', revision: 1, sizeBytes: HTML_DOCUMENT.length }],
      }),
    },
    { path: '/workspace/artifacts/html/landing.html', name: 'landing.html', kind: 'file', mime: 'text/html', content: HTML_DOCUMENT },
  ];
}

export function coverageLibrary(now: number) {
  return [{ id: 'lib-audit', path: '/workspace/notes/audit-plan.md', title: 'Audit plan', kind: 'document' as const, enabled: true, addedAt: now - 2_000_000 }];
}

function diffRows(): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (let line = 1; line <= 8; line += 1) rows.push({ type: 'context', text: `const step${line} = ${line};`, oldLine: line, newLine: line });
  for (let line = 9; line <= 16; line += 1) rows.push({ type: 'removed', text: `legacyStep(${line});`, oldLine: line });
  for (let line = 9; line <= 20; line += 1) rows.push({ type: 'added', text: `runStep(${line});`, newLine: line });
  return rows;
}

/** A thread whose reply carries every Aurora surface: a diff artifact past the fold, an image job, a source footer and a follow-up offer. */
export function auroraThreads(now: number): SeedThread[] {
  return [{
    id: 'aurora-active',
    title: 'Aurora pack showcase',
    subtitle: 'Diff, image job, sources, follow-ups',
    createdAt: now - 500_000,
    updatedAt: now - 490_000,
    pinned: true,
    modelId: CLOUD_MODEL_ID,
    messages: [
      { id: 'aurora-user', role: 'user', content: 'Refactor the step runner and render the cover image.', createdAt: now - 500_000 },
      {
        id: 'aurora-assistant',
        role: 'assistant',
        content: 'I replaced the eight legacy calls with twelve runStep calls and queued the cover render.\n\nWant me to run the full suite next?',
        createdAt: now - 495_000,
        model: CLOUD_MODEL_ID,
        workNotes: ['Reading the runner before editing.'],
        toolCalls: [
          { id: 'call-edit', name: 'edit_file', arguments: { path: '/workspace/src/runner.ts' } },
          { id: 'call-cover', name: 'image_generate', arguments: { prompt: 'A wax seal with the letter G', count: 2 } },
        ],
        toolResults: [
          {
            toolCallId: 'call-edit',
            toolName: 'edit_file',
            content: 'Edited /workspace/src/runner.ts (+12 -8)',
            summary: 'Edited runner.ts',
            ok: true,
            durationMs: 30,
            outputChars: 40,
            ranAt: now - 494_000,
            artifacts: [{ kind: 'diff', path: '/workspace/src/runner.ts', added: 12, removed: 8, rows: diffRows() }],
          },
          {
            toolCallId: 'call-cover',
            toolName: 'image_generate',
            content: 'Queued image job img-tour',
            summary: 'Queued an image render',
            ok: true,
            durationMs: 5,
            outputChars: 24,
            ranAt: now - 493_000,
            artifacts: [{ kind: 'image-job', jobId: 'img-tour', count: 2 }],
          },
        ],
        usage: [cloudUsage(900, 250, 0.0014)],
        retrievalTrace: {
          version: 1,
          purpose: 'automatic_context',
          usedAt: now - 496_000,
          generationId: 'aurora-generation',
          model: 'nomic-embed-text',
          rankingPolicyVersion: 1,
          items: [{ reference: 'note:audit-plan', sourceType: 'note', sourceId: 'audit-plan', title: 'Audit plan', sourceTimestamp: now - 2_000_000, excerpt: 'Review open models first.', denseRank: 1, fusedRank: 1 }],
        },
      },
    ],
  }];
}

/** An empty conversation pinned to a local model, so the empty state and its semantic-memory nudge render. */
export function emptyLocalThread(now: number): SeedThread {
  return {
    id: 'local-empty',
    title: 'New local conversation',
    subtitle: '',
    createdAt: now - 10_000,
    updatedAt: now - 10_000,
    pinned: false,
    modelId: LOCAL_MODEL_ID,
    messages: [],
  };
}

/** A conversation pinned to the direct local image model. */
export function localImageThread(now: number): SeedThread {
  return {
    id: 'local-image',
    title: 'Direct image render',
    subtitle: 'Pinned to the local image model',
    createdAt: now - 10_000,
    updatedAt: now - 10_000,
    pinned: false,
    modelId: LOCAL_IMAGE_MODEL_ID,
    messages: [],
  };
}

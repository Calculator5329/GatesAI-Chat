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
} as const;

/** The version the running app reports; whats-new compares against it. */
export const APP_VERSION: string = appPackage.version;

export const CLOUD_MODEL_ID = 'or-gemini-3-flash';
export const LOCAL_MODEL_ID = 'ollama-qwen2.5:7b';
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
  imageJobs?: ReturnType<typeof readyImageJobs>;
  ragSettings?: ReturnType<typeof defaultRagSettings>;
  /**
   * Version the user last acknowledged. Defaults to the running version so
   * neither the whats-new panel nor the welcome tour thread appears; pass an
   * older version to make the panel show, or null to simulate a true first
   * boot (welcome tour seeded).
   */
  lastSeenVersion?: string | null;
}

/** Build the localStorage map for a scenario. */
export function buildSeed(options: SeedOptions): Record<string, unknown> {
  const seed: Record<string, unknown> = {
    [STORAGE_KEYS.userGuideOpened]: '1',
    [STORAGE_KEYS.menuHintSeen]: '1',
    [STORAGE_KEYS.uiPrefs]: {
      onboardingDismissed: options.onboardingDismissed,
      ...(options.theme ? { theme: options.theme } : {}),
    },
  };
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

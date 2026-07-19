import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mockBridgeOnline, mockOllama, mockOpenRouter } from './fixtures/harness';

test.skip(!process.env.SCREENS_TOUR, 'Set SCREENS_TOUR=1 or run npm run screens:tour to capture the screen corpus.');

const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
const MOBILE_VIEWPORT = { width: 375, height: 812 };
const FORCED_THEME = process.env.SCREENS_TOUR_THEME;
const LIGHT_THEME_TOUR = FORCED_THEME === 'light';
const MODEL_ID = 'or-gemini-3-flash';
const TOUR_REPLY = [
  'Mock reply from the assistant.',
  '',
  'Here is a concise implementation note with realistic paragraph length, a short list, and enough content to exercise the message action row.',
  '',
  '- Use seeded workspace context.',
  '- Keep screenshots deterministic.',
  '- Re-run the tour before design reviews.',
].join('\n');
const LOCAL_MODEL_ID = 'ollama-qwen2.5:7b';
const LOCAL_PROVIDER_MODEL_ID = 'qwen2.5:7b';
const LOCAL_TOUR_REPLY = 'Mock local reply from Ollama with a short private-model answer.';

interface TourMessage {
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
    summary?: string;
    ok?: boolean;
    durationMs?: number;
    outputChars?: number;
    ranAt: number;
  }>;
  usage?: Array<{
    providerId: 'openrouter' | 'ollama';
    modelId: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
    costSource: 'pricing' | 'local';
  }>;
}

interface TourThread {
  id: string;
  title: string;
  subtitle: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  modelId: string;
  messages: TourMessage[];
  summary?: string;
  summaryUpdatedAt?: number;
  summaryMessageCount?: number;
  agentTask?: boolean;
  agentTaskOriginThreadId?: string;
  agentTaskStatus?: 'scheduled' | 'running' | 'done' | 'error' | 'interrupted';
  agentTaskScheduledStartAt?: number;
}

interface SeedState {
  readyProvider?: boolean;
  onboardingDismissed?: boolean;
  theme?: 'dark' | 'light' | 'system';
  threads?: TourThread[];
  activeThreadId?: string;
  profile?: { bio: string; defaultSystemPrompt: string };
  imageJobs?: unknown[];
  ragSettings?: { autoInject: boolean; embeddingModel: string };
}

test.describe.configure({ mode: 'serial' });

test('captures the screenshot tour', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  if (LIGHT_THEME_TOUR && project !== 'desktop-mocked') return;
  if (project === 'desktop-mocked') {
    await mockOpenRouter(page, { reply: TOUR_REPLY });
    await mockOllama(page, { reply: LOCAL_TOUR_REPLY, models: [LOCAL_PROVIDER_MODEL_ID, 'llama3.2:3b'] });
    await mockBridgeOnline(page, { files: workspaceFiles() });
    await captureDesktopTour(page, testInfo);
    if (!LIGHT_THEME_TOUR) await captureLocalOnlyTour(page);
    return;
  }

  if (project === 'web-lite') {
    await mockOpenRouter(page, { reply: TOUR_REPLY });
    await captureWebLiteTour(page, testInfo);
  }
});

async function captureDesktopTour(page: Page, testInfo: TestInfo): Promise<void> {
  const outDir = LIGHT_THEME_TOUR ? await prepareNamedDir('light-theme') : await prepareProjectDir(testInfo);
  let index = 1;

  await page.setViewportSize(DESKTOP_VIEWPORT);
  await resetStorage(page, { onboardingDismissed: false });
  await gotoApp(page, '/');
  await forceFirstRunState(page);
  await expect(page.getByText('Bring cloud models')).toBeVisible();
  await shot(page, outDir, index++, 'first-run-onboarding');

  await resetStorage(page, baseSeed('active'));
  await gotoApp(page, '/');
  await sendPrompt(page, 'Draft a short implementation note for the screenshot tour.');
  await expect(page.locator('.md-body', { hasText: 'Mock reply from the assistant.' }).first()).toBeVisible();
  await forceActionRows(page);
  await shot(page, outDir, index++, 'active-chat-streamed-reply');

  await resetStorage(page, baseSeed('tool'));
  await gotoApp(page, '/#/thread/tool');
  await expect(page.getByText('Ran npm test')).toBeVisible();
  await shot(page, outDir, index++, 'chat-tool-activity');

  await resetStorage(page, baseSeed('active'));
  await gotoApp(page, '/#/thread/active');
  await page.keyboard.press('Control+K');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  await shot(page, outDir, index++, 'command-palette');

  await resetStorage(page, baseSeed('active'));
  await gotoApp(page, '/#/thread/active');
  await page.locator('.composer-model-label').click();
  await expect(page.locator('.model-popover')).toBeVisible();
  await shot(page, outDir, index++, 'model-popover');

  for (const section of ['agent', 'models', 'settings']) {
    await resetStorage(page, baseSeed('active'));
    await gotoApp(page, `/#/menu/${section}`);
    await expect(page.locator('.gates-menu__body')).toBeVisible();
    await shot(page, outDir, index++, `menu-${section}`);
  }

  await resetStorage(page, baseSeed('agent-task'));
  await gotoApp(page, '/#/thread/active');
  await expect(page.getByText('Agent tasks')).toBeVisible();
  await shot(page, outDir, index++, 'sidebar-agent-task-group');

  if (LIGHT_THEME_TOUR) return;

  await page.setViewportSize(MOBILE_VIEWPORT);
  await resetStorage(page, { onboardingDismissed: false });
  await gotoApp(page, '/');
  await forceFirstRunState(page);
  await expect(page.getByText('Bring cloud models')).toBeVisible();
  await shot(page, outDir, index++, 'mobile-first-run');

  await resetStorage(page, baseSeed('active'));
  await gotoApp(page, '/#/thread/active');
  await expect(page.locator('.editorial-mobile-topbar__title', { hasText: 'Screenshot tour planning' })).toBeVisible();
  await shot(page, outDir, index++, 'mobile-active-chat');
}

async function captureWebLiteTour(page: Page, testInfo: TestInfo): Promise<void> {
  const outDir = await prepareProjectDir(testInfo);
  let index = 1;

  await page.setViewportSize(DESKTOP_VIEWPORT);
  await resetStorage(page, { onboardingDismissed: false });
  await gotoApp(page, '/');
  await forceFirstRunState(page);
  await expect(page.getByText('Bring cloud models')).toBeVisible();
  await shot(page, outDir, index++, 'first-run-openrouter-onboarding');

  await resetStorage(page, baseSeed('active'));
  await gotoApp(page, '/');
  await sendPrompt(page, 'Write a short web-lite note for the screenshot tour.');
  await expect(page.locator('.md-body', { hasText: 'Mock reply from the assistant.' }).first()).toBeVisible();
  await forceActionRows(page);
  await shot(page, outDir, index++, 'active-chat-streamed-reply');

  await resetStorage(page, baseSeed('active'));
  await gotoApp(page, '/#/menu/models');
  await expect(page.getByRole('heading', { name: 'Models' })).toBeVisible();
  await shot(page, outDir, index++, 'menu-models');

  await resetStorage(page, baseSeed('active'));
  await gotoApp(page, '/#/menu/settings');
  await expect(page.getByText('Danger zone', { exact: true })).toBeVisible();
  await shot(page, outDir, index++, 'menu-settings');

  await page.setViewportSize(MOBILE_VIEWPORT);
  await resetStorage(page, { onboardingDismissed: false });
  await gotoApp(page, '/');
  await forceFirstRunState(page);
  await expect(page.getByText('Bring cloud models')).toBeVisible();
  await shot(page, outDir, index++, 'mobile-first-run');

  await resetStorage(page, baseSeed('active'));
  await gotoApp(page, '/#/thread/active');
  await expect(page.locator('.editorial-mobile-topbar__title', { hasText: 'Screenshot tour planning' })).toBeVisible();
  await shot(page, outDir, index++, 'mobile-active-chat');
}

async function captureLocalOnlyTour(page: Page): Promise<void> {
  const outDir = await prepareNamedDir('local-only');
  let index = 1;

  await page.setViewportSize(DESKTOP_VIEWPORT);
  await resetStorage(page, { onboardingDismissed: false });
  await gotoApp(page, '/');
  await forceFirstRunState(page);
  await forceOllamaOnline(page, { keepOnboarding: true });
  await expect(page.getByRole('button', {  name: /Continue with qwen2\.5:7b/ })).toBeVisible();
  await shot(page, outDir, index++, 'first-run-local-online');

  await resetStorage(page, localOnlySeed('local-active'));
  await gotoApp(page, '/#/thread/local-active');
  await forceOllamaOnline(page);
  await sendPrompt(page, 'Draft a local-only screenshot note.');
  await expect(page.locator('.md-body', { hasText: LOCAL_TOUR_REPLY }).first()).toBeVisible();
  await forceActionRows(page);
  await shot(page, outDir, index++, 'active-chat-local-model');

  await resetStorage(page, localOnlySeed('local-active'));
  await gotoApp(page, '/#/thread/local-active');
  await forceOllamaOnline(page);
  await page.locator('.composer-model-label').click();
  await expect(page.locator('.model-popover')).toBeVisible();
  await page.locator('[data-source-filter="local"]').click();
  await expect(page.locator('.model-popover__list', { hasText: 'Local' })).toBeVisible();
  await shot(page, outDir, index++, 'model-popover-local-section');

  await resetStorage(page, localOnlySeed('local-active'));
  await gotoApp(page, '/#/menu/models');
  await forceOllamaOnline(page);
  await expect(page.getByText('Ollama online · 2 models')).toBeVisible();
  await shot(page, outDir, index++, 'menu-models-local-row');
}

async function prepareProjectDir(testInfo: TestInfo): Promise<string> {
  return prepareNamedDir(testInfo.project.name);
}

async function prepareNamedDir(name: string): Promise<string> {
  const outDir = path.join(process.cwd(), 'docs', 'screens', name);
  await mkdir(outDir, { recursive: true });
  const entries = await readdir(outDir, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.png'))
    .map(entry => rm(path.join(outDir, entry.name), { force: true })));
  return outDir;
}

async function resetStorage(page: Page, seed: SeedState): Promise<void> {
  await page.goto('/favicon.svg');
  const theme = FORCED_THEME === 'light' || FORCED_THEME === 'dark' || FORCED_THEME === 'system'
    ? FORCED_THEME
    : seed.theme;
  await writeStorageSeed(page, { ...seed, ...(theme ? { theme } : {}) });
}

async function writeStorageSeed(page: Page, seed: SeedState): Promise<void> {
  await page.evaluate((state: SeedState) => {
    localStorage.clear();
    localStorage.setItem('gatesai.userGuide.opened.v1', '1');
    localStorage.setItem('gatesai.menuHintSeen.v1', '1');
    localStorage.setItem('gatesai.uiprefs.v1', JSON.stringify({
      onboardingDismissed: state.onboardingDismissed ?? true,
      ...(state.theme ? { theme: state.theme } : {}),
    }));
    if (state.readyProvider) {
      localStorage.setItem('gatesai.providers.v1', JSON.stringify({ openrouter: { apiKey: 'test-key' } }));
    }
    if (state.threads) {
      localStorage.setItem('gatesai.state.v1', JSON.stringify({
        threads: state.threads,
        activeThreadId: state.activeThreadId ?? state.threads[0]?.id ?? null,
      }));
    }
    if (state.profile) localStorage.setItem('gatesai.profile.v1', JSON.stringify(state.profile));
    if (state.imageJobs) localStorage.setItem('gatesai.imagejobs.v1', JSON.stringify({ history: state.imageJobs }));
    if (state.ragSettings) localStorage.setItem('gatesai.rag.settings.v1', JSON.stringify(state.ragSettings));
  }, seed);
}

async function gotoApp(page: Page, route: string): Promise<void> {
  await page.goto(route);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await addStableStyles(page);
  await expect(page.locator('.editorial-sidebar, .editorial-mobile-topbar').first()).toBeVisible();
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(150);
}

async function addStableStyles(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        caret-color: transparent !important;
      }
      .message-actions,
      .editorial-sidebar__row-actions {
        opacity: 1 !important;
        visibility: visible !important;
        pointer-events: auto !important;
      }
    `,
  });
}

async function forceActionRows(page: Page): Promise<void> {
  await page.locator('.editorial-message').last().hover();
  await addStableStyles(page);
}

async function sendPrompt(page: Page, text: string): Promise<void> {
  await page.locator('.composer-textarea').fill(text);
  await page.locator('button.composer-send-control[aria-label="Send"]').click();
}

async function forceFirstRunState(page: Page): Promise<void> {
  await page.evaluate(() => {
    const devWindow = window as Window & {
      __gatesai?: {
        store?: {
          providers?: { remove: (provider: string) => void };
          chat?: { clearAllThreads: () => void };
          ui?: { setOnboardingDismissed: (value: boolean) => void };
        };
      };
    };
    const store = devWindow.__gatesai?.store;
    store?.providers?.remove('openrouter');
    store?.chat?.clearAllThreads();
    store?.ui?.setOnboardingDismissed(false);
  });
  await page.waitForTimeout(50);
}

async function forceOllamaOnline(page: Page, options: { keepOnboarding?: boolean } = {}): Promise<void> {
  await page.evaluate(async ({ keepOnboarding }) => {
    const devWindow = window as Window & {
      __gatesai?: {
        store?: {
          providers?: { remove: (provider: string) => void };
          ui?: { setOnboardingDismissed: (value: boolean) => void };
          chat?: {
            activeThreadId: string | null;
            threads: Array<{ id: string; modelId: string; contextMode?: string }>;
            setThreadModel: (threadId: string, modelId: string) => void;
            setThreadContextMode: (threadId: string, mode: string) => void;
          };
          localRuntime?: {
            runtimes: {
              ollama: { status: string; installPath: string; lastError?: string; lastErrorKind?: string };
              comfyui: { status: string };
            };
          };
          ollama?: { refresh: () => Promise<void> };
        };
      };
    };
    const store = devWindow.__gatesai?.store;
    store?.providers?.remove('openrouter');
    if (store?.localRuntime) {
      store.localRuntime.runtimes.ollama.status = 'online';
      store.localRuntime.runtimes.ollama.installPath = 'C:\\Program Files\\Ollama\\ollama.exe';
      store.localRuntime.runtimes.ollama.lastError = undefined;
      store.localRuntime.runtimes.ollama.lastErrorKind = undefined;
      store.localRuntime.runtimes.comfyui.status = 'stopped';
    }
    await store?.ollama?.refresh();
    const threadId = store?.chat?.activeThreadId;
    if (keepOnboarding && threadId) {
      store?.chat?.setThreadModel(threadId, 'or-gpt-5.5');
      const active = store?.chat?.threads.find(thread => thread.id === threadId);
      if (active) active.modelId = 'or-gpt-5.5';
      store?.ui?.setOnboardingDismissed(false);
    } else if (threadId) {
      store?.chat?.setThreadModel(threadId, 'ollama-qwen2.5:7b');
      const active = store?.chat?.threads.find(thread => thread.id === threadId);
      if (active) active.modelId = 'ollama-qwen2.5:7b';
      store?.chat?.setThreadContextMode(threadId, 'micro');
      if (active) active.contextMode = 'micro';
    }
  }, options);
  await page.waitForTimeout(100);
}

async function shot(page: Page, outDir: string, index: number, name: string): Promise<void> {
  await page.screenshot({
    path: path.join(outDir, `${String(index).padStart(2, '0')}-${name}.png`),
    fullPage: true,
  });
}

function baseSeed(activeThreadId: string): SeedState {
  const now = Date.now();
  const threads = tourThreads(now);
  return {
    readyProvider: true,
    onboardingDismissed: true,
    activeThreadId,
    threads,
    profile: {
      bio: [
        '- User prefers concise engineering notes.',
        '- Current project is GatesAI Chat screenshot coverage.',
      ].join('\n'),
      defaultSystemPrompt: 'Prefer direct, practical answers and call out verification gaps.',
    },
    imageJobs: [{
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
    }],
    ragSettings: { autoInject: true, embeddingModel: 'nomic-embed-text' },
  };
}

function localOnlySeed(activeThreadId: string): SeedState {
  const now = Date.now();
  return {
    readyProvider: false,
    onboardingDismissed: true,
    activeThreadId,
    threads: localOnlyThreads(now),
    profile: {
      bio: '- User is auditing local-only Ollama workflows.',
      defaultSystemPrompt: 'Prefer concise local-first answers.',
    },
    ragSettings: { autoInject: true, embeddingModel: 'nomic-embed-text' },
  };
}

function localOnlyThreads(now: number): TourThread[] {
  return [
    {
      id: 'local-active',
      title: 'Local-only planning',
      subtitle: 'Ollama private model workflow',
      createdAt: now - 900_000,
      updatedAt: now - 300_000,
      pinned: true,
      modelId: LOCAL_MODEL_ID,
      summary: 'Exercises local-only usage, picker, and menu screenshots.',
      messages: [
        { id: 'local-user', role: 'user', content: 'Can you keep this workflow fully local?', createdAt: now - 600_000 },
        {
          id: 'local-assistant',
          role: 'assistant',
          content: 'Yes. This thread is pinned to an Ollama model, and usage is tracked as local tokens with no cloud spend.',
          createdAt: now - 590_000,
          model: LOCAL_MODEL_ID,
          usage: [localUsage(LOCAL_PROVIDER_MODEL_ID, 840, 260)],
        },
      ],
    },
  ];
}

function tourThreads(now: number): TourThread[] {
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
      modelId: MODEL_ID,
      summary: 'Defines the screenshot corpus needed for future design and UX reviews.',
      summaryUpdatedAt: now - 300_000,
      summaryMessageCount: 2,
      messages: [
        { id: 'active-user', role: 'user', content: 'Can you outline the screenshot tour harness and what it should cover?', createdAt: userAt },
        {
          id: 'active-assistant',
          role: 'assistant',
          content: TOUR_REPLY,
          createdAt: assistantAt,
          model: MODEL_ID,
          usage: [usage('openrouter/google/gemini-3-flash-preview', 1180, 420, 0.0021)],
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
      modelId: MODEL_ID,
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
          model: MODEL_ID,
          workNotes: ['Checking the project scripts before running validation.'],
          toolCalls: [{
            id: 'call-terminal-tests',
            name: 'terminal',
            arguments: { cmd: 'npm', args: ['test'], cwd: '/workspace' },
          }],
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
          usage: [usage('openrouter/google/gemini-3-flash-preview', 950, 210, 0.0015)],
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
      modelId: MODEL_ID,
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
      modelId: MODEL_ID,
      messages: [
        { id: 'usage-user', role: 'user', content: 'Give me a short usage example.', createdAt: now - 86_400_000 },
        {
          id: 'usage-assistant',
          role: 'assistant',
          content: 'This thread exists so the Usage screen has realistic totals.',
          createdAt: now - 86_390_000,
          model: MODEL_ID,
          usage: [usage('openrouter/anthropic/claude-sonnet-4.5', 2400, 780, 0.0112)],
        },
      ],
    },
  ];
}

function usage(modelId: string, promptTokens: number, completionTokens: number, costUsd: number) {
  return {
    providerId: 'openrouter' as const,
    modelId,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    costUsd,
    costSource: 'pricing' as const,
  };
}

function localUsage(modelId: string, promptTokens: number, completionTokens: number) {
  return {
    providerId: 'ollama' as const,
    modelId,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    costUsd: 0,
    costSource: 'local' as const,
  };
}

function workspaceFiles() {
  return [
    {
      path: '/workspace/skills/review.md',
      name: 'review.md',
      kind: 'file' as const,
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
      kind: 'file' as const,
      content: [
        '---',
        'name: research',
        'description: Gather workspace context and produce grounded design notes.',
        'tools: fs, web_search',
        '---',
        'Favor concrete evidence and cite artifacts when available.',
      ].join('\n'),
    },
    { path: '/workspace/attachments', name: 'attachments', kind: 'dir' as const },
    { path: '/workspace/attachments/requirements.md', name: 'requirements.md', kind: 'file' as const, content: '# Requirements\nScreenshot every app surface.' },
    { path: '/workspace/notes', name: 'notes', kind: 'dir' as const },
    { path: '/workspace/notes/audit-plan.md', name: 'audit-plan.md', kind: 'file' as const, content: '# Audit plan\nReview open models first.' },
    { path: '/workspace/artifacts', name: 'artifacts', kind: 'dir' as const },
    { path: '/workspace/artifacts/screens-tour.json', name: 'screens-tour.json', kind: 'file' as const, content: '{"screens":15}' },
  ];
}

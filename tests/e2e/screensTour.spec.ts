import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mockBridgeOnline, mockOpenRouter } from './fixtures/harness';

test.skip(!process.env.SCREENS_TOUR, 'Set SCREENS_TOUR=1 or run npm run screens:tour to capture the screen corpus.');

const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
const MOBILE_VIEWPORT = { width: 375, height: 812 };
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
    providerId: 'openrouter';
    modelId: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
    costSource: 'pricing';
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
  threads?: TourThread[];
  activeThreadId?: string;
  profile?: { bio: string; defaultSystemPrompt: string };
  imageJobs?: unknown[];
  mcpServers?: unknown[];
  ragSettings?: { autoInject: boolean; embeddingModel: string };
}

test.describe.configure({ mode: 'serial' });

test('captures the screenshot tour', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  if (project === 'desktop-mocked') {
    await mockOpenRouter(page, { reply: TOUR_REPLY });
    await mockBridgeOnline(page, { files: workspaceFiles() });
    await captureDesktopTour(page, testInfo);
    return;
  }

  if (project === 'web-lite') {
    await mockOpenRouter(page, { reply: TOUR_REPLY });
    await captureWebLiteTour(page, testInfo);
  }
});

async function captureDesktopTour(page: Page, testInfo: TestInfo): Promise<void> {
  const outDir = await prepareProjectDir(testInfo);
  let index = 1;

  await page.setViewportSize(DESKTOP_VIEWPORT);
  await resetStorage(page, { onboardingDismissed: false });
  await gotoApp(page, '/');
  await forceFirstRunState(page);
  await expect(page.getByText('Use cloud models')).toBeVisible();
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

  for (const section of ['agent', 'models', 'local', 'workspace', 'gallery', 'usage', 'settings']) {
    await resetStorage(page, baseSeed('active'));
    await gotoApp(page, `/#/menu/${section}`);
    await expect(page.locator('.gates-menu__body')).toBeVisible();
    await shot(page, outDir, index++, `menu-${section}`);
    if (section === 'agent') {
      await page.getByText('MCP', { exact: true }).scrollIntoViewIfNeeded();
      await page.waitForTimeout(100);
      await shot(page, outDir, index++, 'menu-agent-mcp-skills');
      await page.getByText(/Workspace skills/).scrollIntoViewIfNeeded();
      await page.getByRole('button', { name: 'Refresh' }).last().click();
      await expect(page.getByText(/Workspace skills.*2/)).toBeVisible();
      await page.waitForTimeout(100);
      await shot(page, outDir, index++, 'menu-agent-skills-list');
    }
  }

  await resetStorage(page, baseSeed('agent-task'));
  await gotoApp(page, '/#/thread/active');
  await expect(page.getByText('Agent tasks')).toBeVisible();
  await shot(page, outDir, index++, 'sidebar-agent-task-group');

  await page.setViewportSize(MOBILE_VIEWPORT);
  await resetStorage(page, { onboardingDismissed: false });
  await gotoApp(page, '/');
  await forceFirstRunState(page);
  await expect(page.getByText('Use cloud models')).toBeVisible();
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
  await expect(page.getByText('OpenRouter requires a key')).toBeVisible();
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
  await expect(page.getByText('Your data is saved in this browser')).toBeVisible();
  await shot(page, outDir, index++, 'menu-settings');

  await resetStorage(page, baseSeed('active'));
  await gotoApp(page, '/#/menu/workspace');
  await expect(page.getByText('Web Lite:')).toBeVisible();
  await shot(page, outDir, index++, 'bridge-gated-workspace-notice');

  await page.setViewportSize(MOBILE_VIEWPORT);
  await resetStorage(page, { onboardingDismissed: false });
  await gotoApp(page, '/');
  await forceFirstRunState(page);
  await expect(page.getByText('OpenRouter requires a key')).toBeVisible();
  await shot(page, outDir, index++, 'mobile-first-run');

  await resetStorage(page, baseSeed('active'));
  await gotoApp(page, '/#/thread/active');
  await expect(page.locator('.editorial-mobile-topbar__title', { hasText: 'Screenshot tour planning' })).toBeVisible();
  await shot(page, outDir, index++, 'mobile-active-chat');
}

async function prepareProjectDir(testInfo: TestInfo): Promise<string> {
  const project = testInfo.project.name;
  const outDir = path.join(process.cwd(), 'docs', 'screens', project);
  await mkdir(outDir, { recursive: true });
  const entries = await readdir(outDir, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.png'))
    .map(entry => rm(path.join(outDir, entry.name), { force: true })));
  return outDir;
}

async function resetStorage(page: Page, seed: SeedState): Promise<void> {
  await page.goto('/favicon.svg');
  await writeStorageSeed(page, seed);
}

async function writeStorageSeed(page: Page, seed: SeedState): Promise<void> {
  await page.evaluate((state: SeedState) => {
    localStorage.clear();
    localStorage.setItem('gatesai.userGuide.opened.v1', '1');
    localStorage.setItem('gatesai.menuHintSeen.v1', '1');
    localStorage.setItem('gatesai.uiprefs.v1', JSON.stringify({ onboardingDismissed: state.onboardingDismissed ?? true }));
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
    if (state.mcpServers) localStorage.setItem('gatesai.mcp.v1', JSON.stringify(state.mcpServers));
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
    mcpServers: [{
      id: 'mcp-design-review',
      label: 'Design review',
      url: 'https://mcp.example.test/sse',
      headers: { Authorization: '' },
      enabled: false,
    }],
    ragSettings: { autoInject: true, embeddingModel: 'nomic-embed-text' },
  };
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

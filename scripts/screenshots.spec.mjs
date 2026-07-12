import { readFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { mockBridgeOnline, mockOllama, mockOpenRouter } from '../tests/e2e/fixtures/harness';

const OUTPUT_DIR = process.env.SCREENSHOTS_OUTPUT_DIR;
const GIT_SHA = process.env.SCREENSHOTS_GIT_SHA;
const TIMESTAMP = process.env.SCREENSHOTS_TIMESTAMP;
const VIEWPORT = { width: 1440, height: 900 };
const MODEL_ID = 'or-gemini-3-flash';
const FIXTURE_TIME = Date.parse('2026-01-15T15:30:00.000Z');
const HTML_PATH = '/workspace/artifacts/reports/screenshot-pipeline.html';
const PACKAGE_JSON = JSON.parse(await readFile(path.resolve(process.cwd(), 'package.json'), 'utf8'));
const EXPECTED_STATES = [
  'fresh-load',
  'models-openrouter',
  'seeded-thread',
  'composer-focused',
  'sidebar-header-hover',
  'scroll-to-bottom',
  'html-preview-artifact',
];

test('captures every deterministic UI review state', async ({ page }) => {
  if (!OUTPUT_DIR || !GIT_SHA || !TIMESTAMP) {
    throw new Error('Run this project through npm run screenshots so output metadata is configured.');
  }

  await rm(OUTPUT_DIR, { recursive: true, force: true });
  await mkdir(OUTPUT_DIR, { recursive: true });
  await page.setViewportSize(VIEWPORT);
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await mockOpenRouter(page);
  await mockOllama(page);
  await mockBridgeOnline(page, { files: workspaceFiles() });

  await openState(page, seed({ readyProvider: false, threads: [emptyThread()], activeThreadId: 'fresh' }), '/#/thread/fresh');
  await expect(page.getByText('Add an OpenRouter key in Models to start chatting.')).toBeVisible();
  await capture(page, 'fresh-load');

  await openState(page, seed({ readyProvider: false, threads: [contentThread()], activeThreadId: 'content' }), '/#/menu/models');
  const openRouterCard = page.getByText('OpenRouter', { exact: true }).first();
  await openRouterCard.scrollIntoViewIfNeeded();
  await expect(openRouterCard).toBeVisible();
  await expect(page.getByText('Not connected').first()).toBeVisible();
  await capture(page, 'models-openrouter');

  await openState(page, seed({ threads: [contentThread()], activeThreadId: 'content' }), '/#/thread/content');
  await expect(page.getByRole('heading', { name: 'Screenshot fixture' })).toBeVisible();
  await expect(page.locator('.code-block code')).toContainText('captureStates');
  await capture(page, 'seeded-thread');

  const composer = page.locator('.composer-textarea');
  await composer.focus();
  await expect(composer).toBeFocused();
  await expect(page.locator('.composer-row')).not.toHaveCSS('box-shadow', 'none');
  await capture(page, 'composer-focused');

  const sidebarHeader = page.locator('.editorial-sidebar__brand');
  await sidebarHeader.hover();
  await expect(sidebarHeader).toBeVisible();
  await capture(page, 'sidebar-header-hover');

  await openState(page, seed({ threads: [longThread()], activeThreadId: 'long' }), '/#/thread/long');
  const timeline = page.locator('.editorial-chat-scroll');
  await timeline.evaluate(element => {
    element.scrollTop = Math.max(1, Math.floor((element.scrollHeight - element.clientHeight) / 2));
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await expect(page.locator('.editorial-jump-to-bottom')).toBeVisible();
  await capture(page, 'scroll-to-bottom');

  await openState(page, seed({ threads: [artifactThread()], activeThreadId: 'artifact' }), '/#/thread/artifact');
  const artifact = page.locator('.html-artifact-preview');
  await artifact.scrollIntoViewIfNeeded();
  await expect(artifact).toBeVisible();
  await expect(artifact.locator('iframe')).toBeVisible({ timeout: 10_000 });
  await capture(page, 'html-preview-artifact');

  const states = Object.fromEntries(EXPECTED_STATES.map(stateName => [stateName, `${stateName}.png`]));
  await writeFile(path.join(OUTPUT_DIR, 'manifest.json'), `${JSON.stringify({
    gitSha: GIT_SHA,
    appVersion: PACKAGE_JSON.version,
    timestamp: TIMESTAMP,
    viewport: VIEWPORT,
    states,
  }, null, 2)}\n`);

  // Pipeline contract: every declared state must produce a non-empty PNG.
  const entries = await readdir(OUTPUT_DIR);
  const expectedFiles = EXPECTED_STATES.map(stateName => `${stateName}.png`);
  expect(entries.filter(file => file.endsWith('.png')).sort()).toEqual(expectedFiles.sort());
  for (const file of expectedFiles) {
    expect((await stat(path.join(OUTPUT_DIR, file))).size, `${file} should not be empty`).toBeGreaterThan(0);
  }
  const manifest = JSON.parse(await readFile(path.join(OUTPUT_DIR, 'manifest.json'), 'utf8'));
  expect(manifest.states).toEqual(states);
  expect(manifest.appVersion).toBe(PACKAGE_JSON.version);
});

async function openState(page, state, route) {
  await page.goto('/favicon.svg');
  await page.evaluate(snapshot => {
    localStorage.clear();
    localStorage.setItem('gatesai.userGuide.opened.v1', '1');
    localStorage.setItem('gatesai.menuHintSeen.v1', '1');
    localStorage.setItem('gatesai.whatsNew.v1', JSON.stringify({
      lastSeenVersion: snapshot.appVersion,
      tourThreadSeeded: true,
    }));
    localStorage.setItem('gatesai.uiprefs.v1', JSON.stringify({
      onboardingDismissed: true,
      theme: 'dark',
      animationsEnabled: false,
    }));
    if (snapshot.readyProvider) {
      localStorage.setItem('gatesai.providers.v1', JSON.stringify({ openrouter: { apiKey: 'screenshot-fixture-key' } }));
    }
    localStorage.setItem('gatesai.state.v1', JSON.stringify({
      threads: snapshot.threads,
      activeThreadId: snapshot.activeThreadId,
    }));
  }, state);

  await page.goto(route);
  await page.addStyleTag({ content: `
    *, *::before, *::after {
      animation: none !important;
      transition: none !important;
      caret-color: transparent !important;
    }
  ` });
  await expect(page.locator('.editorial-sidebar')).toBeVisible();
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(100);
}

async function capture(page, stateName) {
  if (!EXPECTED_STATES.includes(stateName)) throw new Error(`Unregistered screenshot state: ${stateName}`);
  await page.screenshot({ path: path.join(OUTPUT_DIR, `${stateName}.png`), animations: 'disabled' });
}

function seed(overrides) {
  return {
    appVersion: PACKAGE_JSON.version,
    readyProvider: true,
    ...overrides,
  };
}

function emptyThread() {
  return makeThread('fresh', 'New conversation', []);
}

function contentThread() {
  return makeThread('content', 'Screenshot pipeline review', [
    message('content-user', 'user', 'Show the deterministic screenshot fixture.'),
    message('content-assistant', 'assistant', [
      '## Screenshot fixture',
      '',
      'This seeded reply exercises **markdown**, a compact checklist, and a fenced code block without making a model request.',
      '',
      '- Fixed viewport and fixture data',
      '- Reduced motion for stable captures',
      '',
      '```ts',
      "const captureStates = ['fresh-load', 'seeded-thread'];",
      'await review(captureStates);',
      '```',
    ].join('\n')),
  ]);
}

function longThread() {
  const messages = Array.from({ length: 34 }, (_, index) => message(
    `long-${index}`,
    index % 2 === 0 ? 'user' : 'assistant',
    `Review note ${String(index + 1).padStart(2, '0')}: ${'This fixed transcript line creates enough vertical rhythm for the mid-thread navigation state. '.repeat(3)}`,
    index,
  ));
  return makeThread('long', 'Long design review', messages);
}

function artifactThread() {
  return makeThread('artifact', 'HTML artifact review', [
    message('artifact-user', 'user', 'Create a small review artifact.'),
    message('artifact-assistant', 'assistant', [
      'The deterministic UI review is ready:',
      '',
      `[Open the screenshot pipeline report](${HTML_PATH})`,
    ].join('\n')),
  ]);
}

function makeThread(id, title, messages) {
  return {
    id,
    title,
    subtitle: 'Deterministic screenshot fixture',
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME + 60_000,
    pinned: true,
    modelId: MODEL_ID,
    messages,
  };
}

function message(id, role, content, offset = 0) {
  return {
    id,
    role,
    content,
    createdAt: FIXTURE_TIME + offset * 1_000,
    ...(role === 'assistant' ? { model: MODEL_ID } : {}),
  };
}

function workspaceFiles() {
  return [{
    path: HTML_PATH,
    name: 'screenshot-pipeline.html',
    kind: 'file',
    mime: 'text/html',
    content: '<!doctype html><html><head><title>Screenshot pipeline</title></head><body style="font:18px system-ui;padding:36px;background:#f7f4ed;color:#24231f"><h1>UI review packet</h1><p>Seven deterministic states captured and ready to compare.</p></body></html>',
  }];
}

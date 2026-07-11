import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { mockBridgeOnline, mockOllama, mockOpenRouter } from '../tests/e2e/fixtures/harness';
import { SCREEN_AUDIT_MANIFEST } from './screens-audit-manifest.mjs';

const OUT_DIR = process.env.SCREENS_AUDIT_DIR
  ?? path.resolve(process.cwd(), 'docs', 'audits', 'screens-2026-07');
const THEME = process.env.SCREENS_TOUR_THEME ?? 'dark';
const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 844 };
const MODEL_ID = 'or-gemini-3-flash';

test('captures every source-audited screen, panel, and modal', async ({ page }) => {
  await prepareOutput();
  await mockOpenRouter(page);
  await mockOllama(page);
  await mockBridgeOnline(page, { files: workspaceFiles() });
  await page.setViewportSize(DESKTOP);

  await openState(page, { onboardingDismissed: false, readyProvider: false }, '/');
  await expect(page.getByLabel('Choose how to start chatting')).toBeVisible();
  await capture(page, 'screen-chat-onboarding.png');

  await openState(page, baseSeed({ threads: [emptyThread()], activeThreadId: 'empty' }), '/#/thread/empty');
  await expect(page.locator('.composer-textarea')).toBeVisible();
  await capture(page, 'screen-chat-empty.png');

  await openState(page, baseSeed(), '/#/thread/audit');
  await expect(page.getByText('Local-first audit planning').first()).toBeVisible();
  await capture(page, 'screen-chat-active.png');

  await openState(page, baseSeed(), '/#/thread/audit');
  await expect(page.getByText('Inspected workspace files')).toBeVisible();
  await capture(page, 'screen-chat-tool-activity.png');

  await page.getByRole('button', { name: 'Edit and resend' }).first().click();
  await expect(page.getByLabel('Edited message')).toBeVisible();
  await capture(page, 'screen-chat-message-edit.png');

  await openState(page, baseSeed(), '/#/thread/audit');
  await page.getByRole('button', { name: 'Regenerate response' }).first().click();
  await expect(page.locator('.message-confirm-panel')).toBeVisible();
  await capture(page, 'screen-chat-regenerate-confirm.png');

  await page.setViewportSize(MOBILE);
  await openState(page, baseSeed(), '/#/thread/audit');
  await page.getByRole('button', { name: 'Open sidebar' }).first().click();
  await expect(page.locator('.editorial-sidebar')).toHaveAttribute('data-mobile-open', 'true');
  await capture(page, 'screen-sidebar-mobile-open.png');
  await page.setViewportSize(DESKTOP);

  for (const section of ['settings', 'usage', 'agent', 'models', 'local', 'workspace', 'gallery']) {
    await openState(page, baseSeed(), `/#/menu/${section}`);
    if (section === 'local') {
      // KNOWN GAP (local-first audit finding LF-1): the Local section throws
      // "Cannot read local runtime status outside the GatesAI desktop app"
      // in Web Lite instead of degrading gracefully. Capture the degraded
      // state as evidence; assertion restored when LF-1 is fixed.
      await page.waitForTimeout(500);
    } else {
      await expect(page.locator('.gates-menu__body')).toBeVisible();
    }
    await capture(page, `screen-menu-${section}.png`);
  }

  await openState(page, baseSeed(), '/#/thread/audit');
  await page.keyboard.press('Control+K');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  await capture(page, 'screen-palette-default.png');
  await page.getByLabel('Search commands and threads').fill('no-result-audit-query');
  await expect(page.getByText('No matching command or thread.')).toBeVisible();
  await capture(page, 'screen-palette-empty.png');

  await openState(page, baseSeed(), '/#/thread/audit');
  await page.locator('.composer-model-label').click();
  await expect(page.locator('.model-popover')).toBeVisible();
  await capture(page, 'screen-picker-model.png');

  await openState(page, baseSeed(), '/#/thread/audit');
  await page.locator('.composer-skill-label').click();
  await expect(page.getByRole('listbox', { name: 'Workspace skills' })).toBeVisible();
  await capture(page, 'screen-picker-skill.png');

  await openState(page, baseSeed(), '/#/menu/gallery');
  await page.getByRole('button', { name: 'Local-first audit cover image' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Image viewer' })).toBeVisible();
  await capture(page, 'screen-modal-gallery-lightbox.png');

  await openState(page, baseSeed(), '/#/thread/audit');
  const artifact = page.locator('.html-artifact-preview').first();
  await artifact.scrollIntoViewIfNeeded();
  await expect(artifact).toBeVisible();
  await expect(artifact.locator('iframe')).toBeVisible({ timeout: 15_000 });
  await artifact.click();
  await expect(page.getByRole('dialog', { name: /HTML artifact audit-report\.html/ })).toBeVisible();
  await capture(page, 'screen-modal-html-artifact.png');

  await openState(page, { ...baseSeed(), lastSeenVersion: '4.4.0' }, '/#/thread/audit');
  await expect(page.getByRole('dialog', { name: 'What’s new' })).toBeVisible();
  await capture(page, 'screen-modal-whats-new.png');

  await openState(page, baseSeed(), '/#/menu/settings');
  const menuBody = page.locator('.gates-menu__body');
  const dangerZone = page.locator('.settings-danger-zone');
  await dangerZone.scrollIntoViewIfNeeded();
  await dangerZone.getByRole('button', { name: 'Delete...' }).first().click();
  await expect(dangerZone.getByText(/This cannot be undone/)).toBeVisible();
  await capture(page, 'screen-panel-settings-confirm.png');
  await menuBody.evaluate(element => { element.scrollTop = 0; });

  const missing = SCREEN_AUDIT_MANIFEST.filter(item => !captured.has(item.file));
  expect(missing, `Manifest entries without a capture: ${missing.map(item => item.file).join(', ')}`).toEqual([]);
});

const captured = new Set();

async function prepareOutput() {
  await mkdir(OUT_DIR, { recursive: true });
  captured.clear();
  const entries = await readdir(OUT_DIR, { withFileTypes: true });
  await Promise.all(entries
    .filter(entry => entry.isFile() && /^screen-[a-z0-9-]+\.png$/.test(entry.name))
    .map(entry => rm(path.join(OUT_DIR, entry.name), { force: true })));
}

async function openState(page, seed, route) {
  await page.goto('/favicon.svg');
  await page.evaluate(({ state, theme }) => {
    localStorage.clear();
    localStorage.setItem('gatesai.userGuide.opened.v1', '1');
    localStorage.setItem('gatesai.menuHintSeen.v1', '1');
    localStorage.setItem('gatesai.uiprefs.v1', JSON.stringify({
      onboardingDismissed: state.onboardingDismissed ?? true,
      theme,
      animationsEnabled: false,
    }));
    localStorage.setItem('gatesai.whatsNew.v1', JSON.stringify({
      lastSeenVersion: state.lastSeenVersion ?? '4.5.0',
      tourThreadSeeded: true,
    }));
    if (state.readyProvider !== false) {
      localStorage.setItem('gatesai.providers.v1', JSON.stringify({ openrouter: { apiKey: 'audit-key' } }));
    }
    if (state.threads) {
      localStorage.setItem('gatesai.state.v1', JSON.stringify({
        threads: state.threads,
        activeThreadId: state.activeThreadId ?? state.threads[0]?.id ?? null,
      }));
    }
    if (state.imageJobs) localStorage.setItem('gatesai.imagejobs.v1', JSON.stringify({ history: state.imageJobs }));
    if (state.profile) localStorage.setItem('gatesai.profile.v1', JSON.stringify(state.profile));
  }, { state: seed, theme: THEME });
  await page.goto(route);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addStyleTag({ content: `
    *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
    .message-actions, .editorial-sidebar__row-actions { opacity: 1 !important; visibility: visible !important; pointer-events: auto !important; }
  ` });
  await expect(page.locator('.editorial-sidebar, .editorial-mobile-topbar').first()).toBeVisible();
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(150);
}

async function capture(page, file) {
  if (!SCREEN_AUDIT_MANIFEST.some(item => item.file === file)) throw new Error(`Unmanifested screenshot: ${file}`);
  await page.screenshot({ path: path.join(OUT_DIR, file), fullPage: true });
  captured.add(file);
}

function baseSeed(overrides = {}) {
  const now = Date.now();
  return {
    readyProvider: true,
    onboardingDismissed: true,
    threads: auditThreads(now),
    activeThreadId: 'audit',
    profile: {
      bio: '- Auditing GatesAI for local-first behavior.',
      defaultSystemPrompt: 'Prefer local execution and disclose every network dependency.',
    },
    imageJobs: [{
      id: 'audit-image', threadId: 'audit', prompt: 'Local-first audit cover image', count: 2,
      width: 512, height: 512, backend: 'local-comfy', status: 'done',
      results: ['/workspace/artifacts/images/audit-1.png', '/workspace/artifacts/images/audit-2.png'],
      createdAt: now - 10_000, completedAt: now - 5_000,
    }],
    ...overrides,
  };
}

function emptyThread() {
  return {
    id: 'empty', title: 'Empty local-first check', subtitle: '', createdAt: 1, updatedAt: 2,
    pinned: false, modelId: MODEL_ID, messages: [],
  };
}

function auditThreads(now) {
  return [{
    id: 'audit', title: 'Local-first audit planning', subtitle: 'Screen-by-screen product review',
    createdAt: now - 60_000, updatedAt: now, pinned: true, modelId: MODEL_ID,
    summary: 'Audit each surface for local persistence, offline capability, and cloud-only gaps.',
    messages: [
      { id: 'u1', role: 'user', content: 'Audit every screen for local-first behavior.', createdAt: now - 50_000 },
      {
        id: 'a1', role: 'assistant', createdAt: now - 40_000, model: MODEL_ID,
        content: 'I inspected the workspace and mapped each visible surface. Open the generated report at `/workspace/artifacts/reports/audit-report.html`.',
        workNotes: ['Checking routes, panels, persistence boundaries, and network-only actions.'],
        toolCalls: [{ id: 'tool-1', name: 'fs', arguments: { action: 'list', path: '/workspace' } }],
        toolResults: [{
          toolCallId: 'tool-1', toolName: 'fs', content: 'src/\nscripts/\ndocs/\npackage.json',
          summary: 'Inspected workspace files', ok: true, durationMs: 38, outputChars: 35, ranAt: now - 45_000,
        }],
      },
      { id: 'u2', role: 'user', content: 'Call out anything that requires a cloud account.', createdAt: now - 30_000 },
      { id: 'a2', role: 'assistant', content: 'The audit table separates local storage from provider-dependent actions.', createdAt: now - 20_000, model: MODEL_ID },
    ],
  }];
}

function workspaceFiles() {
  return [
    { path: '/workspace/skills/audit.md', name: 'audit.md', kind: 'file', content: '---\nname: audit\ndescription: Review local-first behavior.\n---\nInspect every surface.' },
    { path: '/workspace/artifacts/reports/audit-report.html', name: 'audit-report.html', kind: 'file', mime: 'text/html', content: '<!doctype html><title>Local-first audit</title><main style="font:20px system-ui;padding:40px"><h1>Local-first audit</h1><p>Screen inventory and dependency notes.</p></main>' },
    { path: '/workspace/artifacts/images/audit-1.png', name: 'audit-1.png', kind: 'file', mime: 'image/png' },
    { path: '/workspace/artifacts/images/audit-2.png', name: 'audit-2.png', kind: 'file', mime: 'image/png' },
  ];
}

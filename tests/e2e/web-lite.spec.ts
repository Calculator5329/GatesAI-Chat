import { readFile } from 'node:fs/promises';
// Web Lite build assertions: the bridge is intentionally absent, so the UI must
// degrade gracefully — the status pill, disabled attachments, and the notices
// on the bridge-dependent menu sections.
import { test, expect } from '@playwright/test';
import { makeThread, seedThreads, mockOpenRouter, seedReadyProvider } from './fixtures/harness';

test.describe('web lite (no bridge)', () => {
  test.beforeEach(async ({ page }) => {
    await seedReadyProvider(page);
    await mockOpenRouter(page);
  });

  test('shows the web lite status and disables attachments', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('status', { name: 'Web Lite' })).toBeVisible();
    await expect(page.locator('button.composer-attach-btn')).toBeDisabled();
  });

  test('still streams a chat reply without the bridge', async ({ page }) => {
    await page.goto('/');
    await page.locator('.composer-textarea').fill('hi there');
    await page.locator('button.composer-send-control[aria-label="Send"]').click();
    await expect(page.locator('.md-body', { hasText: 'Mock reply from the assistant.' })).toBeVisible();
  });

  test('redirects retired menu hashes to their new homes', async ({ page }) => {
    await page.goto('/#/menu/gallery');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    // Web Lite has no Models tab: the keys live under Settings.
    await page.goto('/#/menu/local');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page).toHaveURL(/#\/menu\/settings/);
    // The seeded key renders masked, so look for the card, not the empty field.
    await expect(page.locator('.settings-keys').getByText('OpenRouter', { exact: true })).toBeVisible();
  });

  test('hides the desktop-only settings rather than showing dead switches', async ({ page }) => {
    await page.goto('/#/menu/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    // Global summon and the tray behaviour are Tauri-only. Shipping them here
    // as inert switches would be exactly the "half-works" the direction doc
    // rules out, so they must be absent, not merely disabled.
    await expect(page.getByRole('switch', { name: 'Global summon' })).toHaveCount(0);
    await expect(page.getByRole('switch', { name: 'Close button hides to tray' })).toHaveCount(0);
    // Presentation packs and thread titling are desktop knobs too.
    await expect(page.getByRole('switch', { name: 'Automatic thread titles' })).toHaveCount(0);
    await expect(page.getByText('Presentation')).toHaveCount(0);
    // Theme leads, then the keys, then export/import, then the danger zone.
    await expect(page.getByRole('button', { name: 'Light', exact: true })).toBeVisible();
    const sections = page.locator('.settings-page .settings-section');
    await expect(sections).toHaveCount(4);
    await expect(sections.nth(0)).toHaveClass(/settings-theme/);
    await expect(sections.nth(1)).toHaveClass(/settings-keys/);
    await expect(sections.nth(2)).toHaveClass(/settings-export-import/);
    await expect(sections.nth(3)).toHaveClass(/settings-danger-zone/);
    await expect(page.getByTestId('settings.gates-menu.tab-models')).toHaveCount(0);
  });

  test('keeps the Agent page to what the browser build can use', async ({ page }) => {
    await page.goto('/#/menu/agent');

    await expect(page.getByTestId('settings.agent.system-prompt')).toBeVisible();
    await expect(page.getByText('Semantic recall')).toHaveCount(0);
    await expect(page.getByText('Knowledge library')).toHaveCount(0);
    await expect(page.getByText('Automatic recall')).toHaveCount(0);
  });
});

test.describe('web lite without a configured provider', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('gatesai.userGuide.opened.v1', '1');
    });
    await mockOpenRouter(page);
  });

  test('shows OpenRouter onboarding without local runtimes', async ({ page }) => {
    await page.goto('/');

    // First boot shows the local-first hero (redesigned 2026-07-11); Web
    // Lite offers the OpenRouter CTA and no local-runtime affordances.
    await expect(page.getByText('LOCAL-FIRST AI WORKSPACE')).toBeVisible();
    await expect(page.getByText('Please enter an OpenRouter API key to chat.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open settings' })).toBeVisible();
    await expect(page.getByText('Use local models')).toHaveCount(0);
    await expect(page.locator('button.composer-send-control[aria-label="Send"]')).toBeDisabled();
  });

  test('the models hash lands on Settings with the OpenRouter key connect form', async ({ page }) => {
    await page.goto('/#/menu/models');

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page).toHaveURL(/#\/menu\/settings/);
    await expect(page.getByPlaceholder('Paste your OpenRouter API key…')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect' }).first()).toBeDisabled();
  });
});


test('downloads exact response bytes and provenance offline, including after reload', async ({ page, context }) => {
  await seedReadyProvider(page);
  await mockOpenRouter(page);
  const text = '  # Export fixture\n\n**Exact response** with café.\n';
  await seedThreads(page, [makeThread('export-origin', 'Origin', [
    { id: 'export-message', role: 'assistant', content: text, createdAt: 123 },
  ])], 'export-origin');
  await page.goto('/#/workspace');
  const button = page.getByRole('button', { name: 'Download response (.md)', exact: true });
  await expect(button).toBeEnabled();
  await page.reload();
  await expect(button).toBeEnabled();
  await context.setOffline(true);
  await page.getByTestId('workspace.editorial-message.message-export-message').hover();
  for (let click = 0; click < 2; click++) {
    const pending = page.waitForEvent('download');
    await button.click();
    const download = await pending;
    expect(await download.failure()).toBeNull();
    const path = await download.path();
    expect(path).not.toBeNull();
    const bytes = await readFile(path!, 'utf8');
    expect(bytes.startsWith(text + '\n\n---\n')).toBe(true);
    const metadata = JSON.parse(bytes.split('```json\n')[1].split('\n```')[0]);
    expect(metadata.threadId).toBe('export-origin');
    expect(metadata.messageId).toBe('export-message');
    expect(metadata.messageCreatedAt).toBe(123);
    expect(download.suggestedFilename()).toMatch(/^gatesai-response-export-message-.*\.md$/);
  }
});

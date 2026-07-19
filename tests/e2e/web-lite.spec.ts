// Web Lite build assertions: the bridge is intentionally absent, so the UI must
// degrade gracefully — the status pill, disabled attachments, and the notices
// on the bridge-dependent menu sections.
import { test, expect } from '@playwright/test';
import { mockOpenRouter, seedReadyProvider } from './fixtures/harness';

test.describe('web lite (no bridge)', () => {
  test.beforeEach(async ({ page }) => {
    await seedReadyProvider(page);
    await mockOpenRouter(page);
  });

  test('shows the web lite status and disables attachments', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('web lite')).toBeVisible();
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

    await page.goto('/#/menu/local');
    await expect(page.getByRole('heading', { name: 'Models' })).toBeVisible();
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
    await expect(page.getByText('Add an OpenRouter key in Models to start chatting.')).toBeVisible();
    await expect(page.getByText('Use local models')).toHaveCount(0);
    await expect(page.locator('button.composer-send-control[aria-label="Send"]')).toBeDisabled();
  });

  test('models menu shows the OpenRouter key connect form', async ({ page }) => {
    await page.goto('/#/menu/models');

    await expect(page.getByRole('heading', { name: 'Models' })).toBeVisible();
    await expect(page.getByPlaceholder('Paste your OpenRouter API key…')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect' }).first()).toBeDisabled();
  });
});

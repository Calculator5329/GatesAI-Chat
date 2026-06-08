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

  test('surfaces web lite notices on bridge-dependent sections', async ({ page }) => {
    await page.goto('/#/menu/gallery');
    await expect(page.getByText('Web Lite:')).toBeVisible();

    await page.goto('/#/menu/settings');
    await expect(page.getByText('Web Lite browser data')).toBeVisible();
  });
});

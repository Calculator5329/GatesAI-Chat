// W-2 artifact contract surface: the desktop registry feeds the command
// palette and opens a stable-id HTML artifact in the dedicated dock panel.
import { test, expect } from '@playwright/test';
import { mockBridgeOnline, mockOpenRouter, seedReadyProvider } from './fixtures/harness';

test.describe('HTML artifact contract (mocked bridge)', () => {
  test.beforeEach(async ({ page }) => {
    await seedReadyProvider(page);
    await mockOpenRouter(page);
    await mockBridgeOnline(page, {
      files: [
        {
          path: '/workspace/artifacts/html/index.json',
          name: 'index.json',
          kind: 'file',
          mime: 'application/json',
          content: JSON.stringify({
            version: 1,
            artifacts: [{
              id: 'status-board-1',
              title: 'Status board',
              threadId: 't-e2e',
              createdAt: '2026-07-16T00:00:00.000Z',
              updatedAt: '2026-07-16T00:01:00.000Z',
              revision: 2,
              sizeBytes: 82,
            }],
          }),
        },
        {
          path: '/workspace/artifacts/html/status-board-1.html',
          name: 'status-board-1.html',
          kind: 'file',
          mime: 'text/html',
          content: '<!doctype html><html><body><main>Status artifact revision two</main></body></html>',
        },
      ],
    });
  });

  test('opens a registry artifact from the palette in the dock', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.composer-textarea')).toBeVisible();

    await page.keyboard.press('Control+k');
    const paletteInput = page.locator('input[aria-label="Search commands and threads"]');
    await expect(paletteInput).toBeVisible();
    await paletteInput.fill('status board');
    await page.locator('.palette-row', { hasText: 'Open artifact: Status board' }).click();

    const dock = page.locator('[data-testid="dock-panel"]');
    await expect(dock).toBeVisible();
    await expect(dock.locator('.dock-cell__title')).toHaveText('HTML artifact');
    await expect(dock.locator('[data-testid="dock-html-artifact"]')).toBeVisible();
    await expect(dock.locator('iframe[title="Preview of Status board"]')).toBeVisible();
  });
});

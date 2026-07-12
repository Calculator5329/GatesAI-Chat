// Right dock panel framework (W-1): open a workspace markdown file in the
// dock through the command palette against the desktop-mocked project.
import { test, expect } from '@playwright/test';
import { mockBridgeOnline, mockOpenRouter, seedReadyProvider } from './fixtures/harness';

test.describe('dock (mocked bridge)', () => {
  test.beforeEach(async ({ page }) => {
    await seedReadyProvider(page);
    await mockOpenRouter(page);
    await mockBridgeOnline(page, {
      files: [
        {
          path: '/workspace/notes/dock-demo.md',
          name: 'dock-demo.md',
          kind: 'file',
          content: '# Dock Demo Heading\n\nBody copy read from the workspace file.',
          mime: 'text/markdown',
        },
      ],
    });
  });

  test('opens a markdown file in the dock via the command palette', async ({ page }) => {
    page.on('dialog', dialog => dialog.accept('/workspace/notes/dock-demo.md'));
    await page.goto('/');
    await expect(page.locator('.composer-textarea')).toBeVisible();

    await page.keyboard.press('Control+k');
    const paletteInput = page.locator('input[aria-label="Search commands and threads"]');
    await expect(paletteInput).toBeVisible();
    await paletteInput.fill('dock');
    await page.locator('.palette-row', { hasText: 'Open file in dock' }).click();

    const dock = page.locator('[data-testid="dock-panel"]');
    await expect(dock).toBeVisible();
    await expect(dock.locator('.dock-cell__title')).toHaveText('dock-demo.md');
    await expect(dock.getByRole('heading', { name: 'Dock Demo Heading' })).toBeVisible();
    await expect(dock.getByText('Body copy read from the workspace file.')).toBeVisible();

    // Collapse to the rail, reopen, then close the panel entirely.
    await dock.getByRole('button', { name: 'Collapse dock' }).click();
    const rail = page.locator('[data-testid="dock-collapsed-rail"]');
    await expect(rail).toBeVisible();
    await rail.getByRole('button', { name: 'Expand dock' }).click();
    await expect(dock).toBeVisible();
    await dock.getByRole('button', { name: 'Close dock-demo.md' }).click();
    await expect(page.locator('[data-testid="dock-panel"]')).toHaveCount(0);
  });
});

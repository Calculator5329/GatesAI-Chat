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

  test('shows an image job running and completing in the task center', async ({ page }) => {
    await page.route('https://openrouter.ai/api/v1/chat/completions', async route => {
      const payload = route.request().postDataJSON() as { modalities?: string[] } | null;
      if (!payload?.modalities?.includes('image')) {
        await route.fallback();
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 150));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          choices: [{ message: { images: [{ image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } }] } }],
          usage: { cost: 0.04 },
        }),
      });
    });

    await page.goto('/');
    await expect(page.locator('.composer-textarea')).toBeVisible();
    await page.keyboard.press('Control+k');
    const paletteInput = page.locator('input[aria-label="Search commands and threads"]');
    await paletteInput.fill('task center');
    await page.locator('.palette-row', { hasText: 'Open task center' }).click();

    await page.evaluate(() => {
      const devWindow = window as Window & {
        __gatesai?: {
          store?: {
            chat: { activeThreadId: string | null };
            imageJobs: { enqueue: (input: Record<string, unknown>) => unknown };
          };
        };
      };
      const store = devWindow.__gatesai?.store;
      const threadId = store?.chat.activeThreadId;
      if (!store || !threadId) throw new Error('GatesAI dev store unavailable');
      store.imageJobs.enqueue({
        threadId,
        prompt: 'Moonlit observatory',
        count: 1,
        width: 512,
        height: 512,
        backend: 'openrouter-image',
      });
    });

    const taskCenter = page.locator('[data-testid="task-center-panel"]');
    await expect(taskCenter.getByText('Moonlit observatory')).toBeVisible();
    await expect(taskCenter.getByText('In progress')).toBeVisible();
    await expect(taskCenter.getByText('Completed')).toBeVisible();
    await expect(taskCenter.getByText('1 result')).toBeVisible();
    await expect(taskCenter.getByText('$0.04')).toBeVisible();
  });
});

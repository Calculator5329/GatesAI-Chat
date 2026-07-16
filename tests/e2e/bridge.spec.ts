// Bridge-dependent UI flows, exercised with a faked online bridge: attachment
// upload, the gallery rendering image bytes, and a Settings danger-zone action.
import { test, expect } from '@playwright/test';
import {
  makeCompletedImageJob,
  makeThread,
  mockBridgeOnline,
  mockOpenRouter,
  seedImageJobs,
  seedReadyProvider,
  seedThreads,
} from './fixtures/harness';

test.describe('bridge-backed flows (faked online bridge)', () => {
  test.beforeEach(async ({ page }) => {
    await seedReadyProvider(page);
    await mockOpenRouter(page);
    await mockBridgeOnline(page);
  });

  test('uploads an attachment once the bridge is online', async ({ page }) => {
    await page.goto('/');
    const attach = page.locator('button.composer-attach-btn');
    await expect(attach).toBeEnabled();

    await page.locator('input[type="file"]').setInputFiles({
      name: 'note.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello from a test attachment'),
    });

    await expect(page.getByText('note.txt')).toBeVisible();
  });

  test('renders gallery thumbnails and lightbox from seeded image bytes', async ({ page }) => {
    await seedImageJobs(page, [
      makeCompletedImageJob('job-1', 'a calm editorial landscape', [
        '/workspace/artifacts/images/api/test-1.png',
      ]),
    ]);
    await page.goto('/#/menu/gallery');

    await expect(page.getByRole('heading', { name: 'Gallery' })).toBeVisible();
    const thumbnail = page.locator('.gallery-grid img');
    await expect(thumbnail).toBeVisible({ timeout: 15_000 });
    await expect(thumbnail).toHaveAttribute('src', /^data:image\/svg\+xml;base64,/);
    await expect.poll(() => thumbnail.evaluate(img => ({
      width: (img as HTMLImageElement).naturalWidth,
      height: (img as HTMLImageElement).naturalHeight,
    }))).toEqual({ width: 64, height: 64 });

    await thumbnail.click();
    const lightbox = page.getByRole('dialog', { name: 'Image viewer' });
    await expect(lightbox).toBeVisible();
    const fullSize = lightbox.locator('img');
    await expect(fullSize).toBeVisible();
    await expect(fullSize).toHaveAttribute('src', /^data:image\/svg\+xml;base64,/);
  });

  test('clears all threads from the danger zone', async ({ page }) => {
    await seedThreads(
      page,
      [
        makeThread('t1', 'Thread one', [{ id: 'm1', role: 'user', content: 'one', createdAt: 1 }]),
        makeThread('t2', 'Thread two', [{ id: 'm2', role: 'user', content: 'two', createdAt: 2 }]),
      ],
      't1',
    );
    await page.goto('/#/menu/settings');

    await page.getByRole('button', { name: 'Delete...' }).first().click();
    await page.getByRole('button', { name: 'Confirm' }).click();

    await expect(page.getByText('Threads cleared.')).toBeVisible();
  });
});

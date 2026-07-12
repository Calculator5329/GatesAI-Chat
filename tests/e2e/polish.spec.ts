import { expect, test } from '@playwright/test';
import {
  makeThread,
  mockBridgeOnline,
  mockOpenRouter,
  seedReadyProvider,
  seedThreads,
} from './fixtures/harness';

test.describe('chat interaction polish', () => {
  test.beforeEach(async ({ page }) => {
    await seedReadyProvider(page);
    await mockBridgeOnline(page);
  });

  test('draws keyboard focus around the rounded composer instead of the textarea', async ({ page }) => {
    await mockOpenRouter(page);
    await page.goto('/');
    const textarea = page.locator('.composer-textarea');
    await textarea.focus();

    const textareaFocus = await textarea.evaluate(element => {
      const style = getComputedStyle(element);
      return { outline: style.outlineStyle, shadow: style.boxShadow };
    });
    const composerFocus = await page.locator('.composer-row').evaluate(element => {
      const style = getComputedStyle(element);
      return { radius: parseFloat(style.borderRadius), shadow: style.boxShadow };
    });

    expect(textareaFocus.outline).toBe('none');
    expect(textareaFocus.shadow).toBe('none');
    expect(composerFocus.radius).toBeGreaterThan(8);
    expect(composerFocus.shadow).not.toBe('none');
  });

  test('wheel intent over the message column disengages follow and bottom re-engages it', async ({ page }) => {
    const messages = Array.from({ length: 36 }, (_, index) => ({
      id: `m-${index}`,
      role: (index % 2 ? 'assistant' : 'user') as 'assistant' | 'user',
      content: `Message ${index}: ${'a comfortably long transcript line '.repeat(8)}`,
      createdAt: index + 1,
    }));
    await seedThreads(page, [makeThread('scroll-thread', 'Scroll test', messages)], 'scroll-thread');
    await mockOpenRouter(page, { reply: 'A delayed final streaming response.', delayMs: 1_200 });
    await page.goto('/');

    await page.locator('.composer-textarea').fill('Continue');
    await page.locator('button.composer-send-control[aria-label="Send"]').click();
    await expect(page.locator('button.composer-send-control[aria-label="Stop"]')).toBeVisible();

    const timeline = page.locator('.editorial-chat-scroll');
    const stream = page.locator('.editorial-stream');
    await expect.poll(() => timeline.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    const before = await timeline.evaluate(el => el.scrollTop);
    const box = await stream.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + Math.min(100, box!.height / 2));
    await page.mouse.wheel(0, -700);

    await expect.poll(() => timeline.evaluate(el => el.scrollTop)).toBeLessThan(before);
    await expect(page.locator('.editorial-jump-to-bottom')).toBeVisible();
    const pausedTop = await timeline.evaluate(el => el.scrollTop);
    await expect(page.getByText('A delayed final streaming response.')).toBeVisible();
    expect(await timeline.evaluate(el => el.scrollTop)).toBeLessThanOrEqual(pausedTop + 2);

    await timeline.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect(page.locator('.editorial-jump-to-bottom')).toHaveCount(0);

    await timeline.evaluate(el => { el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight - 500); });
    await expect(page.locator('.editorial-jump-to-bottom')).toBeVisible();
    await page.locator('.editorial-jump-to-bottom').click();
    await expect(page.locator('.editorial-jump-to-bottom')).toHaveCount(0);
    await expect.poll(() => timeline.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThanOrEqual(2);
  });

  test('copies fenced code with visible success feedback', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await seedThreads(page, [makeThread('code-thread', 'Code test', [{
      id: 'code-message',
      role: 'assistant',
      content: '```mysterylang\nconst exact = "copied";\n```',
      createdAt: 1,
    }])], 'code-thread');
    await mockOpenRouter(page);
    await page.goto('/');

    const copy = page.locator('.code-block__toolbar button', { hasText: 'Copy' });
    await copy.click();
    await expect(copy).toHaveText('Copied');
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('const exact = "copied";');
  });

  test('toggles a complete fenced HTML document between source and sandboxed preview', async ({ page }) => {
    const html = '<!doctype html><html><body><h1>Preview works</h1></body></html>';
    await seedThreads(page, [makeThread('html-thread', 'HTML test', [{
      id: 'html-message',
      role: 'assistant',
      content: `\`\`\`html\n${html}\n\`\`\``,
      createdAt: 1,
    }])], 'html-thread');
    await mockOpenRouter(page);
    await page.goto('/');

    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const frame = page.locator('.inline-html-preview iframe');
    await expect(frame).toBeVisible();
    await expect(frame).toHaveAttribute('sandbox', /allow-scripts/);
    expect(await frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
    await page.getByRole('button', { name: 'Source', exact: true }).click();
    await expect(frame).toHaveCount(0);
    await expect(page.locator('.code-block code')).toContainText('Preview works');
  });
});

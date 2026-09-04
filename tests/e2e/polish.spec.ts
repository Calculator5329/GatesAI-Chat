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
    await expect.poll(() => timeline.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    const before = await timeline.evaluate(el => el.scrollTop);
    // Aim at the visible middle of the message column. The timeline's box is
    // viewport-sized; the stream's content box extends far above the viewport
    // once scrolled to bottom, so its coordinates land outside the window and
    // the wheel would hit the sidebar instead.
    const box = await timeline.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.wheel(0, -700);

    await expect.poll(() => timeline.evaluate(el => el.scrollTop)).toBeLessThan(before);
    await expect(page.locator('.editorial-jump-to-bottom')).toBeVisible();
    // While disengaged, the message-windowing prepend compensation may nudge
    // scrollTop to hold the visual position, so assert the real invariant:
    // the stream finishing must not re-pin the viewport to the bottom.
    await expect(page.getByText('A delayed final streaming response.')).toBeVisible();
    expect(
      await timeline.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight),
    ).toBeGreaterThan(200);

    await timeline.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect(page.locator('.editorial-jump-to-bottom')).toHaveCount(0);

    // Re-test disengagement with actual reader intent. A synthetic scrollTop
    // write can be consumed as part of the component's programmatic pin
    // bookkeeping and does not represent the wheel/touch interaction this
    // contract protects.
    const reboundBox = await timeline.boundingBox();
    expect(reboundBox).not.toBeNull();
    await page.mouse.move(
      reboundBox!.x + reboundBox!.width / 2,
      reboundBox!.y + reboundBox!.height / 2,
    );
    await page.mouse.wheel(0, -500);
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

    // Target the stateful copy button by its data-state attribute: a
    // `hasText: 'Copy'` filter stops matching the moment the label flips to
    // "Copied" (Playwright string filters don't see the new text as a
    // match), so the success state could never be observed.
    const copy = page.locator('.code-block__toolbar button[data-state]');
    await copy.click();
    await expect(copy).toHaveText('Copied');
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('const exact = "copied";');
  });

  test('shows a complete fenced HTML document as source with a Preview toggle', async ({ page }) => {
    // Current behavior (MarkdownChunk CodeBlock): a closed ```html fence holding a
    // complete document renders its source by default with Open and Download,
    // and the toolbar toggle flips it into the sandboxed preview and back.
    const html = '<!doctype html><html><title>Handoff works</title><body><h1>Preview works</h1></body></html>';
    await seedThreads(page, [makeThread('html-thread', 'HTML test', [{
      id: 'html-message',
      role: 'assistant',
      content: `\`\`\`html\n${html}\n\`\`\``,
      createdAt: 1,
    }])], 'html-thread');
    await mockOpenRouter(page);
    await page.goto('/');

    const toggle = page.getByTestId('workspace.markdown-chunk.set-html-view');
    await expect(toggle).toHaveText('Preview');
    await expect(page.getByTestId('workspace.markdown-chunk.open')).toBeVisible();
    await expect(page.getByTestId('workspace.markdown-chunk.download')).toBeVisible();
    const preview = page.getByTestId('workspace.html-preview.inline');
    await expect(preview).toHaveCount(0);
    await expect(page.locator('.code-block code')).toContainText('Preview works');

    await toggle.click();
    await expect(toggle).toHaveText('Source');
    await expect(preview).toBeVisible();
    await expect(preview.locator('iframe')).toHaveCount(1);

    await toggle.click();
    await expect(toggle).toHaveText('Preview');
    await expect(preview).toHaveCount(0);
    await expect(page.locator('.code-block code')).toContainText('Preview works');
  });
});

# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: multiTab.spec.ts >> multi-tab leader election >> the second tab is read-only while the first tab owns persistence
- Location: tests/e2e/multiTab.spec.ts:26:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.editorial-sidebar__item').filter({ hasText: 'Alpha thread' })
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for locator('.editorial-sidebar__item').filter({ hasText: 'Alpha thread' })

```

# Test source

```ts
  1   | // Two tabs of the same browser context share localStorage and coordinate chat
  2   | // persistence through Web Locks. The elected leader remains writable while a
  3   | // follower is read-only, then the follower refreshes and takes over when the
  4   | // leader closes.
  5   | import { test, expect, type Page } from '@playwright/test';
  6   | import {
  7   |   makeThread,
  8   |   mockBridgeOnline,
  9   |   mockOpenRouter,
  10  |   seedReadyProvider,
  11  |   seedThreads,
  12  | } from './fixtures/harness';
  13  | 
  14  | const FOLLOWER_TEXT = 'Another tab is active';
  15  | 
  16  | async function mockNetwork(page: Page): Promise<void> {
  17  |   await seedReadyProvider(page);
  18  |   await page.addInitScript(() => {
  19  |     localStorage.setItem('gatesai.whatsNew.v1', JSON.stringify({ tourThreadSeeded: true }));
  20  |   });
  21  |   await mockOpenRouter(page);
  22  |   await mockBridgeOnline(page);
  23  | }
  24  | 
  25  | test.describe('multi-tab leader election', () => {
  26  |   test('the second tab is read-only while the first tab owns persistence', async ({ page, context }) => {
  27  |     await mockNetwork(page);
  28  |     await seedThreads(
  29  |       page,
  30  |       [
  31  |         makeThread('t1', 'Alpha thread', [
  32  |           { id: 'm1', role: 'user', content: 'hello from alpha', createdAt: 1 },
  33  |         ]),
  34  |       ],
  35  |       't1',
  36  |     );
  37  |     await page.goto('/');
> 38  |     await expect(page.locator('.editorial-sidebar__item', { hasText: 'Alpha thread' })).toBeVisible();
      |                                                                                         ^ Error: expect(locator).toBeVisible() failed
  39  |     await expect(page.locator('.composer-textarea')).toBeEnabled();
  40  | 
  41  |     // Tab B: same context/origin, so it boots from the localStorage tab A wrote.
  42  |     const pageB = await context.newPage();
  43  |     await mockNetwork(pageB);
  44  |     await pageB.goto('/');
  45  |     await expect(pageB.locator('.editorial-sidebar__item', { hasText: 'Alpha thread' })).toBeVisible();
  46  | 
  47  |     const followerNotice = pageB.locator('.chat-error-banner', { hasText: FOLLOWER_TEXT });
  48  |     await expect(followerNotice).toBeVisible();
  49  |     await expect(followerNotice).toContainText('read-only');
  50  |     await expect(pageB.locator('.composer-textarea')).toBeDisabled();
  51  |     await expect(page.locator('.chat-error-banner', { hasText: FOLLOWER_TEXT })).toHaveCount(0);
  52  | 
  53  |     await pageB.close();
  54  |   });
  55  | 
  56  |   test('closing the leader refreshes the follower and hands over persistence', async ({ page, context }) => {
  57  |     await mockNetwork(page);
  58  |     await seedThreads(
  59  |       page,
  60  |       [
  61  |         makeThread('t1', 'Alpha thread', [
  62  |           { id: 'm1', role: 'user', content: 'hello from alpha', createdAt: 1 },
  63  |         ]),
  64  |       ],
  65  |       't1',
  66  |     );
  67  |     await page.goto('/');
  68  |     await expect(page.locator('.editorial-sidebar__item', { hasText: 'Alpha thread' })).toBeVisible();
  69  |     await expect(page.locator('.composer-textarea')).toBeEnabled();
  70  | 
  71  |     const pageB = await context.newPage();
  72  |     await mockNetwork(pageB);
  73  |     await pageB.goto('/');
  74  |     await expect(pageB.locator('.editorial-sidebar__item', { hasText: 'Alpha thread' })).toBeVisible();
  75  |     await expect(pageB.locator('.chat-error-banner', { hasText: FOLLOWER_TEXT })).toBeVisible();
  76  | 
  77  |     // The leader writes a second thread while the follower remains on its
  78  |     // original in-memory snapshot.
  79  |     await page.locator('.editorial-sidebar__new').click();
  80  |     await expect(page.locator('.editorial-sidebar__item')).toHaveCount(2);
  81  |     await expect(pageB.locator('.editorial-sidebar__item')).toHaveCount(1);
  82  |     await expect.poll(async () => page.evaluate(() => {
  83  |       const snapshot = JSON.parse(localStorage.getItem('gatesai.state.v1') ?? '{}') as { threads?: unknown[] };
  84  |       return snapshot.threads?.length ?? 0;
  85  |     })).toBe(2);
  86  | 
  87  |     await page.close();
  88  | 
  89  |     // Web Locks wakes the queued follower. It reloads the departing leader's
  90  |     // snapshot before becoming writable, then its own writes persist.
  91  |     await expect(pageB.locator('.chat-error-banner', { hasText: FOLLOWER_TEXT })).toHaveCount(0);
  92  |     await expect(pageB.locator('.composer-textarea')).toBeEnabled();
  93  |     await expect(pageB.locator('.editorial-sidebar__item')).toHaveCount(2);
  94  |     await pageB.locator('.editorial-sidebar__new').click();
  95  |     await expect(pageB.locator('.editorial-sidebar__item')).toHaveCount(3);
  96  |     await expect.poll(async () => pageB.evaluate(() => {
  97  |       const snapshot = JSON.parse(localStorage.getItem('gatesai.state.v1') ?? '{}') as { threads?: unknown[] };
  98  |       return snapshot.threads?.length ?? 0;
  99  |     })).toBe(3);
  100 | 
  101 |     await pageB.close();
  102 |   });
  103 | });
  104 | 
```
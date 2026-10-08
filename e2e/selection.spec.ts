import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';
import { launch } from './support';

// 범위를 끌어 고르면 코멘트 상자가 열려 있는 동안 노란 음영이 남는다(GitHub 원문 보기처럼). 코멘트는 올리지 않는다
const URL = 'https://github.com/drum-grammer/GITHUB-MD-DIFF/pull/6/changes';

const test = base.extend<{ context: BrowserContext; page: Page }>({
  context: async ({}, use) => {
    const context = await launch();
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await sw.evaluate(() => chrome.storage.local.set({ enabled: true }));
    await use(context);
    await context.close();
  },
  page: async ({ context }, use) => use(context.pages()[0] ?? (await context.newPage())),
});

const fileOf = (page: Page) => page.locator('div[id^="diff-"][class*="Diff-module__diff__"]');

test('끌어서 고른 범위는 상자가 열려 있는 동안 노랗게 남고, 취소하면 지워진다', async ({ page }) => {
  await page.goto(URL);
  const file = fileOf(page);
  await expect(file.locator('.prose-diff .markdown-body')).toBeVisible({ timeout: 30_000 });
  const first = file.locator('.markdown-body li', { hasText: 'Reduce p95 checkout latency' });
  const last = file.locator('.markdown-body li', { hasText: 'Show users the final payment status' });
  const plus = file.locator('[data-mdf="add-comment"]');
  await expect(async () => {
    await first.hover({ position: { x: 10, y: 5 } });
    await first.hover({ position: { x: 20, y: 6 } });
    await expect(plus).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  const p = await plus.boundingBox();
  const end = await last.boundingBox();
  await page.mouse.move(p!.x + p!.width / 2, p!.y + p!.height / 2);
  await page.mouse.down();
  await page.mouse.move(end!.x + 30, end!.y + end!.height / 2, { steps: 8 });
  await page.mouse.up();
  const form = file.locator('[data-mdf="comment-form"]');
  await expect(form.locator('.mdf-comment-label')).toHaveText(/\b13–17\b/);
  const selected = file.locator('.mdf-selected');
  await expect(selected.first()).toBeVisible();
  expect(await selected.count()).toBeGreaterThanOrEqual(3);
  await expect(first).toHaveClass(/mdf-selected/);
  await expect(last).toHaveClass(/mdf-selected/);
  const bg = await first.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  await file.screenshot({ path: 'test-results/selection-open.png' });
  await form.locator('.mdf-btn', { hasText: /취소|Cancel/ }).first().click();
  await expect(form).toHaveCount(0);
  await expect(selected).toHaveCount(0);
});

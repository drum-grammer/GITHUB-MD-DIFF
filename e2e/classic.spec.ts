import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';
import { launchLoggedOut } from './support';

// 로그아웃 상태 — GitHub는 옛 "Files changed" 화면을 준다(2026-10-07 확인). 병합된 공개 PR이라 내용이 바뀌지 않는다
const FOLD_PR = 'https://github.com/github/docs/pull/46149/files';
const FOLD_FILE = 'requiring-two-factor-authentication-in-your-organization.md';
const TABLE_PR = 'https://github.com/github/docs/pull/46192/files';

const test = base.extend<{ context: BrowserContext; page: Page }>({
  context: async ({}, use) => {
    const context = await launchLoggedOut();
    await use(context);
    await context.close();
  },
  page: async ({ context }, use) => {
    await use(context.pages()[0] ?? (await context.newPage()));
  },
});

const classicFile = (page: Page, pathEnd: string) =>
  page.locator('div.file.js-file').filter({ has: page.locator(`.file-header[data-path$="${pathEnd}"]`) });

test('옛 화면: md 파일이 자동으로 렌더링되고 변경 없는 구간이 접힌다', async ({ page }) => {
  await page.goto(FOLD_PR);
  await expect(page.locator('meta[name="user-login"]')).toHaveAttribute('content', '');
  const file = classicFile(page, FOLD_FILE);
  await expect(file.locator('.prose-diff .markdown-body')).toBeVisible({ timeout: 20_000 });
  const bar = file.locator('[data-mdf="fold"]').first();
  await expect(bar).toBeVisible();
  const run = file.locator('.markdown-body > .expandable.unchanged').first();
  await expect(run).toBeHidden();
  await bar.click();
  await expect(run).toBeVisible();
});

test('옛 화면: 표는 바뀐 행만 한 표로 합친다', async ({ page }) => {
  await page.goto(TABLE_PR);
  const file = classicFile(page, 'notifications.md');
  const merged = file.locator('[data-mdf="table"]');
  await expect(merged).toBeVisible({ timeout: 20_000 });
  await expect(merged.locator('tr.mdf-row-added').first()).toBeVisible();
  await expect(file.locator('.markdown-body > del')).toBeHidden();
});

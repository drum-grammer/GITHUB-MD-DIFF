import { expect, test as base, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { launch } from './support';

// 병합된 공개 PR — 내용이 바뀌지 않는다(2026-10-07 구조 확인)
const FOLD_PR = 'https://github.com/github/docs/pull/46149/changes';
const FOLD_FILE = 'requiring-two-factor-authentication-in-your-organization.md';
const TABLE_PR = 'https://github.com/github/docs/pull/46192/changes';
const TABLE_FILE = 'notifications.md';

const test = base.extend<{ context: BrowserContext; sw: Worker; page: Page }>({
  context: async ({}, use) => {
    const context = await launch();
    await use(context);
    await context.close();
  },
  sw: async ({ context }, use) => {
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await sw.evaluate(() => chrome.storage.local.set({ enabled: true }));
    await use(sw);
  },
  page: async ({ context, sw }, use) => {
    void sw; // 켜짐을 먼저 맞춘다
    await use(context.pages()[0] ?? (await context.newPage()));
  },
});

async function openChanges(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.locator('meta[name="user-login"]'), '로그인이 필요합니다 — 먼저 pnpm e2e:login').not.toHaveAttribute(
    'content',
    '',
  );
}

const fileLocator = (page: Page, name: string) =>
  page.locator('div[id^="diff-"][class*="Diff-module__diff__"]').filter({ has: page.locator('h3 code', { hasText: name }) });

test('md 파일이 자동으로 렌더링되고 변경 없는 구간이 접힌다', async ({ page }) => {
  await openChanges(page, FOLD_PR);
  const file = fileLocator(page, FOLD_FILE);
  await expect(file.locator('.prose-diff .markdown-body')).toBeVisible({ timeout: 20_000 });
  const bar = file.locator('[data-mdf="fold"]').first();
  await expect(bar).toBeVisible();
  const run = file.locator('.markdown-body > .expandable.unchanged').first();
  await expect(run).toBeHidden();
  await bar.click();
  await expect(run).toBeVisible();
  await expect(file.locator('.markdown-body > .vicinity').first()).toBeVisible();
});

test('표는 바뀐 행만 한 표로 합치고, 원래 표로 바꿀 수 있다', async ({ page }) => {
  await openChanges(page, TABLE_PR);
  const file = fileLocator(page, TABLE_FILE);
  const merged = file.locator('[data-mdf="table"]');
  await expect(merged).toBeVisible({ timeout: 20_000 });
  await expect(merged.locator('tr.mdf-row-added').first()).toBeVisible();
  await expect(file.locator('.markdown-body > del')).toBeHidden();
  await merged.locator('[data-mdf-action="original"]').click();
  await expect(file.locator('.markdown-body > del')).toBeVisible();
});

test('사람이 원문을 누른 파일은 다시 렌더링으로 바꾸지 않는다', async ({ page }) => {
  await openChanges(page, FOLD_PR);
  const file = fileLocator(page, FOLD_FILE);
  await expect(file.locator('.prose-diff')).toBeVisible({ timeout: 20_000 });
  await file.locator('button[aria-pressed]').filter({ has: page.locator('svg.octicon-code') }).click();
  await expect(file.locator('.prose-diff')).toHaveCount(0);
  await page.waitForTimeout(3000);
  await expect(file.locator('.prose-diff')).toHaveCount(0);
});

test('끄면 확장이 만든 것이 모두 사라진다', async ({ page, sw }) => {
  await openChanges(page, FOLD_PR);
  await expect(fileLocator(page, FOLD_FILE).locator('[data-mdf="fold"]').first()).toBeVisible({ timeout: 20_000 });
  await sw.evaluate(() => chrome.storage.local.set({ enabled: false }));
  await expect(page.locator('[data-mdf]')).toHaveCount(0);
  await expect(page.locator('.mdf-hidden')).toHaveCount(0);
  await sw.evaluate(() => chrome.storage.local.set({ enabled: true })); // 다음 실행을 위해
});

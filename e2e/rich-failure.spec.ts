import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';
import { launch } from './support';
import { GITHUB_CSS } from '../src/selectors';

// GitHub가 큰 md 파일의 렌더링을 만들지 못하는 상황을 흉내 낸다 — 렌더링 요청(page_data/rich_diff)에 504를 돌려준다.
// 실제로는 GitHub 서버가 10초쯤 렌더링하다 504로 끊고 "This rich diff is not supported at the moment."를 그린다(2026-10-21 확인).
// 테스트 저장소 #5(scenario/large)는 GitHub가 원문 diff를 "Load Diff" 뒤에 숨기는 큰 md 하나다
const URL = 'https://github.com/drum-grammer/markdown-diff-cat-testbed/pull/5/changes';
const FILE = 'docs/large.md';

const test = base.extend<{ context: BrowserContext; page: Page }>({
  context: async ({}, use) => {
    const context = await launch();
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await sw.evaluate(() => chrome.storage.local.set({ enabled: true }));
    await context.route(/\/page_data\/rich_diff\?/, (route) => route.fulfill({ status: 504, contentType: 'text/html', body: 'Gateway Timeout' }));
    await use(context);
    await context.close();
  },
  page: async ({ context }, use) => use(context.pages()[0] ?? (await context.newPage())),
});

const fileOf = (page: Page) => page.locator(GITHUB_CSS.file).filter({ has: page.locator('h3 code', { hasText: FILE }) });
const viewToggle = (page: Page, icon: 'octicon-file' | 'octicon-code') => fileOf(page).locator('button[aria-pressed]').filter({ has: page.locator(`svg.${icon}`) });

test('GitHub가 렌더링을 못 만들면 기다리지 않고 원문 diff를 펼치고 까닭을 적는다', async ({ page }) => {
  await page.goto(URL);
  const started = Date.now();
  const note = fileOf(page).locator('[data-mdf="rich-failed"]');
  await expect(note).toBeVisible({ timeout: 12_000 }); // 예전에는 15초를 기다렸다
  expect(Date.now() - started).toBeLessThan(12_000);
  await expect(note).toContainText('GitHub could not render this file');
  await expect(viewToggle(page, 'octicon-code')).toHaveAttribute('aria-pressed', 'true');
  // 확장이 "Load Diff"를 눌러 원문 줄이 보인다
  await expect(fileOf(page).locator('table td', { hasText: 'Entry 0001' }).first()).toBeVisible({ timeout: 20_000 });
  await expect(fileOf(page).getByRole('button', { name: /^load diff$/i })).toHaveCount(0);
  await expect(page.locator('[data-mdf="problem-toast"]')).toHaveCount(0); // GitHub의 실패라 확장 문제로 알리지 않는다
});

test('"Try rich diff again"은 사람의 선택 — 또 실패해도 원문으로 되돌리지 않는다', async ({ page }) => {
  await page.goto(URL);
  const note = fileOf(page).locator('[data-mdf="rich-failed"]');
  await expect(note).toBeVisible({ timeout: 12_000 });
  await note.getByRole('button').click();
  await expect(note).toHaveCount(0);
  await expect(viewToggle(page, 'octicon-file')).toHaveAttribute('aria-pressed', 'true');
  await expect(fileOf(page)).toContainText('This rich diff is not supported at the moment.', { timeout: 15_000 });
  await page.waitForTimeout(3000);
  await expect(viewToggle(page, 'octicon-file')).toHaveAttribute('aria-pressed', 'true');
  await expect(note).toHaveCount(0);
});

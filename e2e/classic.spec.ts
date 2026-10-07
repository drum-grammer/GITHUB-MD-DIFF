import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';
import { launchLoggedOut } from './support';

// 로그아웃 상태 — GitHub는 옛 "Files changed" 화면을 준다(2026-10-07 확인). 병합된 공개 PR이라 내용이 바뀌지 않는다
const FOLD_PR = 'https://github.com/github/docs/pull/46149/files';
const FOLD_FILE = 'requiring-two-factor-authentication-in-your-organization.md';
const TABLE_PR = 'https://github.com/github/docs/pull/46192/files';
// 이 저장소의 시연 PR(병합하지 않는다) — 스토어 심사 안내도 이 PR을 쓴다
const DEMO_PR = 'https://github.com/drum-grammer/GITHUB-MD-DIFF/pull/6/files';

/** 막대 바로 뒤 묶음에서 아이콘·앵커 말고 실제 내용이 보이는가 */
const runContentShown = (bar: ReturnType<Page['locator']>) =>
  bar.evaluate((b) => {
    const el = b.nextElementSibling!;
    const kids = el.classList.contains('expandable') ? [...el.children].filter((c) => c.tagName.toLowerCase() !== 'svg' && !c.matches('a.anchor')) : [el];
    return kids.some((c) => c.getBoundingClientRect().height > 0);
  });

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
  expect(await runContentShown(bar)).toBe(false);
  await bar.click();
  // GitHub의 collapsed가 남아 있으면 펼치기 아이콘만 보이고 내용은 숨는다
  await expect.poll(() => runContentShown(bar)).toBe(true);
});

test('옛 화면: 펼치기 아이콘·앵커뿐인 묶음엔 막대가 없다', async ({ page }) => {
  await page.goto(DEMO_PR);
  const file = classicFile(page, 'design-doc.md');
  await expect(file.locator('[data-mdf="fold"]').first()).toBeVisible({ timeout: 20_000 });
  await expect(file.locator('[data-mdf="fold"]')).toHaveCount(4);
  await expect(file.locator('.markdown-body svg.octicon-unfold').first()).toBeHidden();
});

test('옛 화면: 표는 바뀐 행만 한 표로 합친다', async ({ page }) => {
  await page.goto(TABLE_PR);
  const file = classicFile(page, 'notifications.md');
  const merged = file.locator('[data-mdf="table"]');
  await expect(merged).toBeVisible({ timeout: 20_000 });
  await expect(merged.locator('tr.mdf-row-added').first()).toBeVisible();
  await expect(file.locator('.markdown-body > del')).toBeHidden();
});

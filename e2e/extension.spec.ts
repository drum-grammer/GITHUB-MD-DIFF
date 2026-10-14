import { expect, test as base, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { launch } from './support';
import { GITHUB_CSS } from '../src/selectors';

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
  page.locator(GITHUB_CSS.file).filter({ has: page.locator('h3 code', { hasText: name }) });

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

// 1.5.0은 GitHub가 클래스 이름 형식을 바꾸자(2026-10-14) 아무 말 없이 멈췄다 — 이제 파일을 하나도 못 읽으면 몇 초 뒤 알린다.
// GitHub가 앵커 id·클래스까지 바꾼 화면을 흉내 낸다(파일 링크는 그대로 남는다)
test('GitHub 화면이 바뀌어 파일을 하나도 못 읽으면 몇 초 뒤 경고(구석 안내·이슈 링크)', async ({ page }) => {
  await openChanges(page, FOLD_PR);
  await expect(fileLocator(page, FOLD_FILE).locator('.prose-diff')).toBeVisible({ timeout: 20_000 });
  const toast = page.locator('[data-mdf="problem-toast"]');
  await expect(toast).toHaveCount(0);
  await page.evaluate(() => {
    for (const f of document.querySelectorAll('div[id^="diff-"]')) {
      if (!/^diff-[0-9a-f]+$/.test(f.id)) continue;
      f.id = `moved-${f.id}`;
      f.className = '';
      f.querySelectorAll('[class]').forEach((el) => el.setAttribute('class', [...el.classList].filter((c) => !c.includes('__')).join(' ')));
      f.querySelectorAll('h3').forEach((h) => h.replaceWith(Object.assign(document.createElement('div'), { innerHTML: h.innerHTML })));
    }
    document.body.append(document.createElement('span')); // 확장은 자식 변화로 다시 훑는다
  });
  await expect(toast).toBeVisible({ timeout: 15_000 });
  await expect(toast).toContainText('files on the page not recognized');
  const body = new URLSearchParams((await toast.getAttribute('data-url'))!.split('?')[1]).get('body') ?? '';
  expect(body).toContain('problemNoFiles');
});

import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { launch } from './support';

// GitHub가 화면 뒤 요청을 바꾼 상황을 흉내 낸다 — PR 데이터(JSON) 요청에 404를 돌려준다
const REPO = 'drum-grammer/GITHUB-MD-DIFF';
const PR = 6;
const URL = `https://github.com/${REPO}/pull/${PR}/changes`;
const THREAD = '[class*="InlineReviewThread-module__ReviewThreadContainer"]';

const test = base.extend<{ context: BrowserContext; page: Page }>({
  context: async ({}, use) => {
    const context = await launch();
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await sw.evaluate(() => chrome.storage.local.set({ enabled: true }));
    await context.route(`${URL}*`, (route) => {
      const h = route.request().headers();
      if ((h.accept ?? '').includes('application/json') && h['x-requested-with']) {
        return route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"Not Found"}' });
      }
      return route.continue();
    });
    await use(context);
    await context.close();
  },
  page: async ({ context }, use) => use(context.pages()[0] ?? (await context.newPage())),
});

const fileOf = (page: Page) => page.locator('div[id^="diff-"][class*="Diff-module__diff__"]');

/** 이 사람의 보류 중인 리뷰를 지운다 — 쓰기 E2E가 남긴 것이 있으면 이 파일은 (의도대로) 원문 보기에 남는다 */
function deletePendingReviews(): void {
  if (process.env.GMD_E2E_WRITE !== '1') return;
  const ids = execFileSync('gh', ['api', `repos/${REPO}/pulls/${PR}/reviews`, '--jq', '.[] | select(.state=="PENDING") | .id'], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
  for (const id of ids) execFileSync('gh', ['api', '-X', 'DELETE', `repos/${REPO}/pulls/${PR}/reviews/${id}`]);
}

test.beforeAll(deletePendingReviews);
test.afterAll(deletePendingReviews);

test('PR 데이터 요청이 바뀌면 코멘트만 꺼진다 — 접기는 그대로, "+" 없음, 안내에 이슈 링크', async ({ page }) => {
  // 방금 지운 보류 코멘트가 GitHub 화면에 잠깐 남을 수 있다 — 스레드가 안 보일 때까지 다시 연다
  await expect(async () => {
    await page.goto(URL);
    await page.waitForTimeout(2000);
    await expect(page.locator(THREAD)).toHaveCount(0);
  }).toPass({ timeout: 60_000 });
  const file = fileOf(page);
  await expect(file.locator('[data-mdf="fold"]').first()).toBeVisible({ timeout: 30_000 });
  const para = file.locator('.markdown-body p', { hasText: 'A reconciler runs every' });
  for (let k = 0; k < 6; k++) {
    await para.hover({ position: { x: 10 + k, y: 5 } });
    await page.waitForTimeout(300);
  }
  await expect(file.locator('[data-mdf="add-comment"]')).toHaveCount(0);
  const toast = page.locator('[data-mdf="problem-toast"]');
  await expect(toast).toBeVisible({ timeout: 10_000 });
  const href = await toast.locator('a').getAttribute('href');
  expect(href).toContain('https://github.com/drum-grammer/GITHUB-MD-DIFF/issues/new?');
  expect(decodeURIComponent(href!.replace(/\+/g, ' '))).toContain('HTTP 404');
  expect(href).not.toContain('pull%2F6'); // PR 주소는 넣지 않는다
});

test('그때 줄 코멘트가 있는 파일은 예전처럼 원문 보기로 둔다', async ({ page }) => {
  test.skip(process.env.GMD_E2E_WRITE !== '1', 'GMD_E2E_WRITE=1일 때만 — 보류 중 코멘트를 만들었다 지운다');
  const sha = execFileSync('gh', ['api', `repos/${REPO}/pulls/${PR}`, '--jq', '.head.sha'], { encoding: 'utf8' }).trim();
  execFileSync('gh', ['api', `repos/${REPO}/pulls/${PR}/reviews`, '--input', '-'], {
    input: JSON.stringify({ commit_id: sha, comments: [{ path: 'demo/design-doc.md', line: 49, side: 'RIGHT', body: 'mdf-e2e degraded' }] }),
  });
  try {
    await page.goto(URL);
    const file = fileOf(page);
    await expect(file.locator(THREAD).first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(5000);
    await expect(file.locator('.prose-diff')).toHaveCount(0);
  } finally {
    deletePendingReviews();
  }
});

import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { launch } from './support';

// 코멘트를 실제로 올린다 — 보류 중인 리뷰(나만 보임)로 올리고 끝나면 gh로 지운다. GMD_E2E_WRITE=1일 때만 돈다
const REPO = 'drum-grammer/GITHUB-MD-DIFF';
const PR = 6; // 데모 PR — demo/design-doc.md 하나(2026-10-08 구조 확인)
const URL = `https://github.com/${REPO}/pull/${PR}/changes`;
const FILE = 'demo/design-doc.md';
const STAMP = `mdf-e2e ${Date.now()}`;

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

test.skip(process.env.GMD_E2E_WRITE !== '1', 'GMD_E2E_WRITE=1일 때만 — 실제 PR에 보류 중 코멘트를 올렸다 지운다');

/** 이 사람의 보류 중인 리뷰를 지운다(그 안의 코멘트도 같이 지워진다) */
function deletePendingReviews(): void {
  const ids = execFileSync('gh', ['api', `repos/${REPO}/pulls/${PR}/reviews`, '--jq', '.[] | select(.state=="PENDING") | .id'], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
  for (const id of ids) execFileSync('gh', ['api', '-X', 'DELETE', `repos/${REPO}/pulls/${PR}/reviews/${id}`]);
}

test.beforeAll(deletePendingReviews);
test.afterAll(deletePendingReviews);

const fileOf = (page: Page) =>
  page.locator('div[id^="diff-"][class*="Diff-module__diff__"]').filter({ has: page.locator('h3 code', { hasText: FILE }) });

/** 블록에 마우스를 올려 "+"가 나올 때까지(첫 호버는 원문을 받는 동안 기다린다) */
async function hoverUntilPlus(page: Page, block: ReturnType<Page['locator']>): Promise<void> {
  const plus = fileOf(page).locator('[data-mdf="add-comment"]');
  await expect(async () => {
    await block.hover({ position: { x: 10, y: 5 } });
    await block.hover({ position: { x: 20, y: 6 } });
    await expect(plus).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
}

async function submit(page: Page, text: string): Promise<void> {
  const form = fileOf(page).locator('[data-mdf="comment-form"]');
  await form.locator('textarea').fill(text);
  await form.locator('.mdf-btn-primary').click(); // 리뷰 시작 / 리뷰 코멘트 추가
  await expect(fileOf(page).locator('[data-mdf="thread"]', { hasText: text })).toBeVisible({ timeout: 20_000 });
}

/** 페이지 데이터에서 이 파일의 스레드 위치 키(R49, R17 ← R13 등) */
async function markerKeys(page: Page): Promise<string[]> {
  return page.evaluate(async (path) => {
    const r = await fetch(location.pathname, {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'GitHub-Verified-Fetch': 'true' },
      credentials: 'include',
    });
    const route = (await r.json()).payload.pullRequestsChangesRoute;
    const sum = route.diffSummaries.find((s: { path: string }) => s.path === path);
    return Object.entries(sum?.markersMap ?? {}).flatMap(([key, m]) =>
      ((m as { threads?: Array<{ start?: string }> }).threads ?? []).map((t) => (t.start ? `${t.start}-${key}` : key)),
    );
  }, FILE);
}

test('렌더링 보기에서 문단·합친 표의 행·범위에 코멘트를 달면 그 원문 줄에 붙는다', async ({ page }) => {
  await page.goto(URL);
  const file = fileOf(page);
  await expect(file.locator('.prose-diff .markdown-body')).toBeVisible({ timeout: 30_000 });

  // 고친 문단 → 새 파일 49번째 줄
  const para = file.locator('.markdown-body p', { hasText: 'A reconciler runs every' });
  await hoverUntilPlus(page, para);
  await file.locator('[data-mdf="add-comment"]').click();
  await expect(file.locator('[data-mdf="comment-form"] .mdf-comment-label')).toHaveText(/\bR49\b/);
  await submit(page, `${STAMP} 문단`);
  await expect(file.locator('[data-mdf="thread"] .mdf-pending').first()).toBeVisible();

  // 합친 표의 바뀐 행 → 새 파일 132번째 줄
  const row = file.locator('[data-mdf="table"] tr', { hasText: 'In progress' });
  await hoverUntilPlus(page, row);
  await file.locator('[data-mdf="add-comment"]').click();
  await expect(file.locator('[data-mdf="comment-form"] .mdf-comment-label')).toHaveText(/\bR132\b/);
  await submit(page, `${STAMP} 표`);

  // 목표 첫 항목에서 마지막 항목까지 끌기 → 13–17번째 줄
  const first = file.locator('.markdown-body li', { hasText: 'Reduce p95 checkout latency' });
  const last = file.locator('.markdown-body li', { hasText: 'Show users the final payment status' });
  await hoverUntilPlus(page, first);
  const plus = await file.locator('[data-mdf="add-comment"]').boundingBox();
  const end = await last.boundingBox();
  await page.mouse.move(plus!.x + plus!.width / 2, plus!.y + plus!.height / 2);
  await page.mouse.down();
  await page.mouse.move(end!.x + 30, end!.y + end!.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(file.locator('[data-mdf="comment-form"] .mdf-comment-label')).toHaveText(/\bR13\b.*\bR17\b/);
  await submit(page, `${STAMP} 범위`);

  expect((await markerKeys(page)).sort()).toEqual(['R13-R17', 'R132', 'R49'].sort());

  // 새로고침해도 코멘트 달린 파일은 렌더링으로 열리고 스레드가 제자리에 있다
  await page.reload();
  await expect(file.locator('[data-mdf="thread"]')).toHaveCount(3, { timeout: 30_000 });
  const paraBox = file.locator('[data-mdf="thread"]', { hasText: `${STAMP} 문단` });
  await expect(paraBox).toBeVisible();
  expect(await paraBox.evaluate((el) => el.previousElementSibling?.textContent ?? '')).toContain('A reconciler runs every');
});

import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';
import { launch } from './support';
import { GITHUB_CSS } from '../src/selectors';

// GitHub가 큰 md 파일의 렌더링을 만들지 못하는 상황을 흉내 낸다 — 렌더링 요청(page_data/rich_diff)에 504를 돌려준다.
// 실제로는 GitHub 서버가 10초쯤 렌더링하다 504로 끊고 "This rich diff is not supported at the moment."를 그린다(2026-10-21 확인).
// 확장은 그 파일을 브라우저에서 엔진으로 그린다(docs/local-render). 원문 요청까지 막으면 원문 diff와 까닭으로 되돌린다(#51).
// 테스트 저장소 #5(scenario/large)는 GitHub가 원문 diff를 "Load Diff" 뒤에 숨기는 큰 md 하나다(2,400문단 모두 고침)
const REPO = 'drum-grammer/markdown-diff-cat-testbed';
const URL = `https://github.com/${REPO}/pull/5/changes`;
const FILE = 'docs/large.md';
/** 로컬 렌더링이 원문을 받는 요청 — 코멘트와 같다(_styled JSON, 안 되면 raw) */
const SOURCE_REQUESTS = new RegExp(`^https://github\\.com/${REPO}/(?:_styled|raw)/`);

const test = base.extend<{ sourceFails: boolean; context: BrowserContext; page: Page }>({
  sourceFails: [false, { option: true }],
  context: async ({ sourceFails }, use) => {
    const context = await launch();
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await sw.evaluate(() => chrome.storage.local.set({ enabled: true }));
    await context.route(/\/page_data\/rich_diff\?/, (route) => route.fulfill({ status: 504, contentType: 'text/html', body: 'Gateway Timeout' }));
    if (sourceFails) await context.route(SOURCE_REQUESTS, (route) => route.fulfill({ status: 500, contentType: 'text/plain', body: 'Internal Server Error' }));
    await use(context);
    await context.close();
  },
  page: async ({ context }, use) => use(context.pages()[0] ?? (await context.newPage())),
});

const fileOf = (page: Page, name = FILE) => page.locator(GITHUB_CSS.file).filter({ has: page.locator('h3 code', { hasText: name }) });
const viewToggle = (page: Page, icon: 'octicon-file' | 'octicon-code') => fileOf(page).locator('button[aria-pressed]').filter({ has: page.locator(`svg.${icon}`) });
const localBody = (page: Page, name = FILE) => fileOf(page, name).locator('[data-mdf-local] .markdown-body');

test.describe('GitHub가 렌더링을 못 만들면 브라우저에서 그린다', () => {
  test('504 → 엔진으로 그린 렌더링 diff — 접기·표시·코멘트 "+"가 그대로, 원문으로 되돌리지 않는다', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // 정화기(DOMPurify)가 Trusted Types 정책을 만들면 GitHub CSP가 막아 위반이 남았다 — 확장이 페이지 CSP를 건드리지 않는다
    page.on('console', (m) => /Content Security Policy|TrustedTypePolicy/i.test(m.text()) && errors.push(m.text()));
    await page.goto(URL);
    await expect(localBody(page)).toBeVisible({ timeout: 30_000 });
    const note = fileOf(page).locator('[data-mdf="local-rich"]');
    await expect(note).toContainText('rendered in your browser');
    await expect(viewToggle(page, 'octicon-file')).toHaveAttribute('aria-pressed', 'true');
    await expect(fileOf(page).getByText('This rich diff is not supported at the moment.')).toBeHidden(); // GitHub 안내는 숨긴다
    await expect(localBody(page).locator('p', { hasText: 'Entry 0001' }).locator('ins', { hasText: 'now' })).toBeVisible();
    await expect(fileOf(page).locator('[data-mdf="file-toolbar"]')).toBeVisible(); // applyBody가 돌았다
    await expect(fileOf(page).locator('[data-mdf="rich-failed"]')).toHaveCount(0);
    await expect(fileOf(page).getByRole('button', { name: /^load diff$/i })).toHaveCount(0);
    await expect(page.locator('[data-mdf="problem-toast"]')).toHaveCount(0); // GitHub의 실패라 확장 문제로 알리지 않는다
    // 코멘트 "+" — 줄은 엔진이 단 원문 줄(셋째 문단 Entry 0003은 새 파일 5번째 줄)
    const para = localBody(page).locator('p', { hasText: 'Entry 0003' });
    const plus = fileOf(page).locator('[data-mdf="add-comment"]');
    await expect(async () => {
      await para.hover({ position: { x: 10, y: 5 } });
      await para.hover({ position: { x: 20, y: 6 } });
      await expect(plus).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 30_000 });
    await plus.click();
    await expect(fileOf(page).locator('[data-mdf="comment-form"] .mdf-comment-label')).toHaveText(/\bR5\b/);
    expect(errors).toEqual([]);
  });

  test('"Show source diff" → 원문 보기, 그린 본문을 걷고 다시 그리지 않는다', async ({ page }) => {
    await page.goto(URL);
    await expect(localBody(page)).toBeVisible({ timeout: 30_000 });
    await fileOf(page).locator('[data-mdf="local-rich"]').getByRole('button', { name: 'Show source diff' }).click();
    await expect(viewToggle(page, 'octicon-code')).toHaveAttribute('aria-pressed', 'true');
    await expect(fileOf(page).locator('[data-mdf-local]')).toHaveCount(0);
    await expect(fileOf(page).locator('table td', { hasText: 'Entry 0001' }).first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(3000);
    await expect(fileOf(page).locator('[data-mdf-local]')).toHaveCount(0);
    await expect(fileOf(page).locator('[data-mdf="local-rich"]')).toHaveCount(0);
    await expect(viewToggle(page, 'octicon-code')).toHaveAttribute('aria-pressed', 'true');
  });

  test('수식은 GitHub 페이지가 그린다 — math-renderer 안에 MathML(testbed #8 parity/math.md)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => /Content Security Policy|TrustedTypePolicy/i.test(m.text()) && errors.push(m.text()));
    await page.goto(`https://github.com/${REPO}/pull/8/changes`);
    const file = fileOf(page, 'parity/math.md');
    await file.scrollIntoViewIfNeeded(); // 화면 근처 파일만 그린다
    await expect(localBody(page, 'parity/math.md')).toBeVisible({ timeout: 30_000 });
    await expect(localBody(page, 'parity/math.md').locator('math-renderer math').first()).toBeAttached({ timeout: 10_000 });
    await expect(localBody(page, 'parity/math.md').locator('.katex')).toHaveCount(0);
    expect(errors).toEqual([]); // Mermaid 자리표시의 GitHub 훅을 떼지 않으면 GitHub 스크립트가 오류를 냈다
  });
});

test.describe('브라우저에서도 못 그리면(원문 요청 실패) 원문 diff와 까닭(#51)', () => {
  test.use({ sourceFails: true });

  test('원문 diff를 펼치고 까닭을 적는다', async ({ page }) => {
    await page.goto(URL);
    const note = fileOf(page).locator('[data-mdf="rich-failed"]');
    await expect(note).toBeVisible({ timeout: 20_000 });
    await expect(note).toContainText('could not be rendered in your browser either');
    await expect(viewToggle(page, 'octicon-code')).toHaveAttribute('aria-pressed', 'true');
    // 확장이 "Load Diff"를 눌러 원문 줄이 보인다
    await expect(fileOf(page).locator('table td', { hasText: 'Entry 0001' }).first()).toBeVisible({ timeout: 20_000 });
    await expect(fileOf(page).getByRole('button', { name: /^load diff$/i })).toHaveCount(0);
    await expect(fileOf(page).locator('[data-mdf-local]')).toHaveCount(0);
    await expect(page.locator('[data-mdf="problem-toast"]')).toHaveCount(0);
  });

  test('"Try rich diff again"은 사람의 선택 — 또 실패해도 원문으로 되돌리지 않는다', async ({ page }) => {
    await page.goto(URL);
    const note = fileOf(page).locator('[data-mdf="rich-failed"]');
    await expect(note).toBeVisible({ timeout: 20_000 });
    await note.getByRole('button').click();
    await expect(note).toHaveCount(0);
    await expect(viewToggle(page, 'octicon-file')).toHaveAttribute('aria-pressed', 'true');
    await expect(fileOf(page)).toContainText('This rich diff is not supported at the moment.', { timeout: 15_000 });
    await page.waitForTimeout(3000);
    await expect(viewToggle(page, 'octicon-file')).toHaveAttribute('aria-pressed', 'true');
    await expect(note).toHaveCount(0);
  });
});

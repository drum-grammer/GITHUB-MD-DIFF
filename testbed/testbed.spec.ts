import { expect, test as base, type BrowserContext, type Locator, type Page, type Worker } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launch, launchLoggedOut } from '../e2e/support';
import { api, cleanRuns, comments, me, reviews, setResolved, threads, type ReviewComment } from './github';
import { RUN_MARKER, headFiles, lineOf } from './scenarios';

// 배포 전 시나리오 — 공개 테스트 저장소(testbed)의 PR에서 실제로 코멘트를 달고, 기존 스레드를 보고, 답글·해결을 해 본다.
// 먼저 `pnpm testbed:setup`(저장소·PR·스레드 맞추기). 쓰는 코멘트는 본문에 RUN_MARKER가 들어가고 테스트마다 앞뒤로 지운다.
// 결과 수치는 annotations(type 'metric')로 남겨 `pnpm testbed:report`가 보고서에 옮긴다.

interface State {
  repo: string;
  version: string;
  prs: Record<'review' | 'large' | 'many', { number: number; url: string; head: string }>;
  seeds: Record<string, { id: number; thread?: string; path: string; side: 'LEFT' | 'RIGHT'; line: number; startLine: number | null; body: string; reply: string | null }>;
}

const STATE_FILE = resolve('.scratch/testbed/state.json');
const S: State = (() => {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as State;
  } catch {
    throw new Error(`${STATE_FILE}가 없어요 — pnpm testbed:setup 먼저`);
  }
})();
const REPO = S.repo;
const PR = S.prs.review.number;
const RUN = process.env.TESTBED_RUN ?? Date.now().toString(36);
const HEAD = headFiles('review');
const LOGIN = me();

const test = base.extend<{ context: BrowserContext; page: Page; worker: Worker }>({
  context: async ({}, use) => {
    const context = await launch();
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await sw.evaluate(() => chrome.storage.local.set({ enabled: true }));
    await use(context);
    await context.close();
  },
  worker: async ({ context }, use) => use(context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))),
  page: async ({ context }, use) => use(context.pages()[0] ?? (await context.newPage())),
});

const metric = (name: string, value: string | number) => test.info().annotations.push({ type: 'metric', description: `${name}=${value}` });
const text = (name: string) => `${RUN_MARKER} ${RUN} · ${name}`;

function clean(pr = PR): void {
  cleanRuns(REPO, pr, RUN_MARKER, LOGIN);
}

async function open(page: Page, key: keyof State['prs']): Promise<number> {
  const t0 = Date.now();
  await page.goto(`${S.prs[key].url}/changes`);
  return t0;
}

/** 파일 상자. 이름이 바뀐 파일은 새 경로로 찾는다 */
const fileOf = (page: Page, path: string): Locator =>
  page.locator('div[id^="diff-"][class*="Diff-module__diff__"]').filter({ has: page.locator('h3 code', { hasText: path }) });

const prose = (file: Locator) => file.locator('.prose-diff .markdown-body');

async function rendered(file: Locator): Promise<void> {
  await expect(prose(file)).toBeVisible({ timeout: 30_000 });
}

/** 블록에 마우스를 올려 "+"가 나올 때까지(첫 호버는 원문을 받는 동안 기다린다) */
async function hoverUntilPlus(file: Locator, block: Locator): Promise<Locator> {
  const plus = file.locator('[data-mdf="add-comment"]');
  await block.scrollIntoViewIfNeeded();
  await expect(async () => {
    await block.hover({ position: { x: 10, y: 5 } });
    await block.hover({ position: { x: 20, y: 6 } });
    await expect(plus).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  return plus;
}

async function formFor(file: Locator, block: Locator): Promise<Locator> {
  await (await hoverUntilPlus(file, block)).click();
  const form = file.locator('[data-mdf="comment-form"]');
  await expect(form).toBeVisible();
  return form;
}

const buttons = (form: Locator) => form.locator(':scope > .mdf-comment-actions > button');

/** single: 바로 올리기(답글이면 "답글") · review: 리뷰 시작/리뷰에 넣기 */
async function submit(file: Locator, form: Locator, body: string, mode: 'single' | 'review'): Promise<void> {
  await form.locator('textarea').fill(body);
  if (mode === 'single') {
    await expect(buttons(form)).toHaveCount(3);
    await buttons(form).nth(1).click();
  } else {
    await form.locator('.mdf-btn-primary').click();
  }
  await expect(file.locator('[data-mdf="thread"]', { hasText: body })).toBeVisible({ timeout: 20_000 });
}

function myPending(pr = PR): ReviewComment[] {
  const r = reviews(REPO, pr).find((x) => x.state === 'PENDING' && x.user.login === LOGIN);
  return r ? api<ReviewComment[]>(`repos/${REPO}/pulls/${pr}/reviews/${r.id}/comments`) : [];
}

function posted(body: string): ReviewComment | undefined {
  return comments(REPO, PR).find((c) => c.body.includes(body));
}

const where = (c: ReviewComment | undefined) => (c ? `${c.path} ${c.side} ${c.start_line ? `${c.start_line}–` : ''}${c.line}` : '없음');

async function badge(worker: Worker): Promise<string[]> {
  return worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return Promise.all(tabs.map((t) => chrome.action.getBadgeText({ tabId: t.id })));
  });
}

async function noProblems(page: Page, worker: Worker): Promise<void> {
  await expect(page.locator('[data-mdf="problem-toast"]')).toHaveCount(0);
  expect((await badge(worker)).filter((b) => b && b !== 'OFF')).toEqual([]);
}

test.beforeAll(() => clean());
test.afterAll(() => {
  clean();
  // 해결 테스트가 중간에 멈췄어도 심은 스레드는 해결 안 됨으로 둔다
  const range = S.seeds.range?.thread;
  if (range && threads(REPO, PR).find((t) => t.id === range)?.isResolved) setResolved(range, false);
});

test('T01 바뀐 md 파일은 렌더링 보기로 열리고, 렌더링이 없는 파일은 그대로 둔다', async ({ page, worker }) => {
  const t0 = await open(page, 'review');
  for (const path of ['docs/handbook.md', 'docs/pricing.md', 'docs/new-page.md', 'docs/guides/renamed-edit.md', 'docs/escape.md', 'docs/widget.mdx']) {
    await rendered(fileOf(page, path));
  }
  metric('PR #1 렌더링 6개까지(ms)', Date.now() - t0);
  // 이름만 바뀐 파일·지운 파일(GitHub가 Load diff 뒤에 둔다)은 렌더링 보기가 없다 — "+"도 경고도 없어야 한다
  for (const path of ['docs/archive/moved.md', 'docs/legacy.md']) {
    const f = fileOf(page, path);
    await expect(f).toHaveCount(1);
    await expect(prose(f)).toHaveCount(0);
    await expect(f.locator('[data-mdf]')).toHaveCount(0);
  }
  await page.waitForTimeout(4000); // 문제 판정(3초 보류)이 지난 뒤
  await noProblems(page, worker);
});

test('T02 변경 없는 구간은 접히고, 표는 바뀐 행만 보이게 합친다', async ({ page }) => {
  await open(page, 'review');
  const hb = fileOf(page, 'docs/handbook.md');
  await rendered(hb);
  const tail = prose(hb).locator('p', { hasText: 'Admins can require single sign-on' });
  await expect(tail).toBeHidden();
  const bar = hb.locator('[data-mdf="fold"]').last();
  await bar.click();
  await expect(tail).toBeVisible();
  await bar.click();
  await expect(tail).toBeHidden();

  const pricing = fileOf(page, 'docs/pricing.md');
  await rendered(pricing);
  const table = pricing.locator('[data-mdf="table"]');
  await expect(table).toHaveCount(1);
  const korea = table.locator('tr', { hasText: 'Korea' }).first();
  await expect(korea).toBeVisible();
  await expect(korea).toContainText('12,000');
  await expect(table.locator('tr', { hasText: 'Brazil' }).first()).toBeHidden();
  metric('pricing 표 접은 행 묶음', await table.locator('tr.mdf-fold-row').count());
});

test('T03 렌더링에 드러나지 않는 변경은 알리고, 버튼으로 원문 보기로 간다', async ({ page }) => {
  await open(page, 'review');
  const f = fileOf(page, 'docs/escape.md');
  await rendered(f);
  const notice = f.locator('[data-mdf="no-change"]');
  await expect(notice).toBeVisible();
  await notice.locator('button').click();
  await expect(f.locator('table[data-diff-anchor]')).toBeVisible({ timeout: 15_000 });
  await expect(prose(f)).toHaveCount(0);
});

test('T04 기존 리뷰 스레드가 가리키는 블록 바로 아래에 붙는다', async ({ page }) => {
  await open(page, 'review');
  const hb = fileOf(page, 'docs/handbook.md');
  await rendered(hb);
  const thread = (f: Locator, body: string) => f.locator('[data-mdf="thread"]', { hasText: body });
  const before = (t: Locator) => t.evaluate((el) => el.previousElementSibling?.textContent ?? '');

  const para = thread(hb, S.seeds.para.body);
  await expect(para).toBeVisible();
  expect(await before(para)).toContain('or your app store');

  const range = thread(hb, S.seeds.range.body);
  await expect(range).toBeVisible();
  expect(await range.evaluate((el) => el.closest('li')?.textContent ?? '')).toContain('Pick a default template');
  await expect(range.locator('.mdf-thread-head')).toContainText(/17–20/);

  const left = thread(hb, S.seeds.left.body);
  await expect(left).toBeVisible();
  expect(await before(left)).toContain('Use two blank lines');

  const pricing = fileOf(page, 'docs/pricing.md');
  const resolved = pricing.locator('[data-mdf="thread"]');
  await expect(resolved).toHaveCount(1);
  await expect(resolved.locator('.mdf-thread-body')).toBeHidden(); // 해결된 스레드는 접혀 있다
  await resolved.locator('.mdf-thread-head').click();
  await expect(resolved.locator('.mdf-thread-body')).toContainText(S.seeds.resolved.body);

  const reply = thread(fileOf(page, 'docs/new-page.md'), S.seeds.reply.body);
  await expect(reply.locator('.mdf-comment')).toHaveCount(2);
  await expect(reply).toContainText(S.seeds.reply.reply!);

  const renamed = thread(fileOf(page, 'docs/guides/renamed-edit.md'), S.seeds.renamed.body);
  await expect(renamed).toBeVisible();
  expect(await before(renamed)).toContain('search notes');

  await expect(page.locator('[data-mdf="unplaced"]')).toHaveCount(0);
});

test('T05 블록마다 "+"가 맞는 원문 줄을 고른다(표 행·HTML 표·알림·코드·목록·각주)', async ({ page }) => {
  await open(page, 'review');
  const hb = fileOf(page, 'docs/handbook.md');
  await rendered(hb);
  const body = prose(hb);
  const hbText = HEAD['docs/handbook.md'];
  const cases: Array<[string, Locator, RegExp]> = [
    ['표 행', body.locator('[data-mdf="table"] tr', { hasText: '$9' }).first(), new RegExp(`\\b${lineOf(hbText, '| Team |')}\\b`)],
    ['HTML 표 행', body.locator('tr', { hasText: 'Link notes to pull requests' }).first(), new RegExp(`\\b${lineOf(hbText, '<tr><td>GitHub')}\\b`)],
    ['목록 항목', body.locator('li', { hasText: 'Connect your calendar' }).first(), new RegExp(`\\b${lineOf(hbText, '- Connect your calendar')}\\b`)],
    ['알림', body.locator('.markdown-alert').first(), new RegExp(`\\b${lineOf(hbText, '> [!NOTE]')}–${lineOf(hbText, 'or drafts.')}\\b`)],
    ['코드 블록', body.locator('pre', { hasText: '--template meeting' }).first(), new RegExp(`\\b${lineOf(hbText, '```bash')}–${lineOf(hbText, '```bash') + 2}\\b`)],
    ['각주', body.locator('[data-footnotes] li').first(), new RegExp(`\\b${lineOf(hbText, '[^sync]:')}\\b`)],
  ];
  for (const [name, block, want] of cases) {
    const form = await formFor(hb, block);
    const label = (await form.locator('.mdf-comment-label').textContent()) ?? '';
    metric(`줄 연결 ${name}`, label);
    expect.soft(label, name).toMatch(want);
    await buttons(form).first().click(); // 취소
    await expect(form).toHaveCount(0);
  }
});

test('T06 한 줄 코멘트를 바로 올리면 그 줄의 보통 코멘트가 된다', async ({ page }) => {
  clean();
  await open(page, 'review');
  const hb = fileOf(page, 'docs/handbook.md');
  await rendered(hb);
  const block = prose(hb).locator('p', { hasText: 'or your app store' });
  const form = await formFor(hb, block);
  await expect(form.locator('.mdf-comment-label')).toHaveText(/\b13\b/);
  const body = text('single');
  await submit(hb, form, body, 'single');
  const c = posted(body);
  metric('올라간 자리', where(c));
  expect(c, 'REST에 보인다(보류 중이 아님)').toBeTruthy();
  expect([c!.path, c!.side, c!.line, c!.start_line]).toEqual(['docs/handbook.md', 'RIGHT', 13, null]);
  // 다시 열어도 그 블록 아래에 있다(심은 스레드와 같은 줄)
  await page.reload();
  await rendered(hb);
  const t = hb.locator('[data-mdf="thread"]', { hasText: body });
  await expect(t).toBeVisible({ timeout: 20_000 });
  expect(await t.evaluate((el) => el.parentElement?.textContent ?? '')).toContain('or your app store');
  clean();
});

test('T07 끌어서 고른 범위로 리뷰를 시작하면 보류 중인 리뷰의 범위 코멘트가 된다', async ({ page }) => {
  clean();
  await open(page, 'review');
  const f = fileOf(page, 'docs/new-page.md');
  await rendered(f);
  const first = prose(f).locator('p', { hasText: 'Run the test suite' });
  const last = prose(f).locator('p', { hasText: 'Post the release notes' });
  const plus = await hoverUntilPlus(f, first);
  const p = (await plus.boundingBox())!;
  const end = (await last.boundingBox())!;
  await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + 30, end.y + end.height / 2, { steps: 8 });
  await page.mouse.up();
  const form = f.locator('[data-mdf="comment-form"]');
  const text0 = HEAD['docs/new-page.md'];
  const [a, b] = [lineOf(text0, 'Run the test suite'), lineOf(text0, 'Post the release notes')];
  await expect(form.locator('.mdf-comment-label')).toHaveText(new RegExp(`\\b${a}–${b}\\b`));
  metric('고른 블록(노란 음영)', await f.locator('.mdf-selected').count());
  expect(await f.locator('.mdf-selected').count()).toBeGreaterThanOrEqual(3);
  const body = text('range');
  await submit(f, form, body, 'review');
  await expect(f.locator('[data-mdf="thread"]', { hasText: body }).locator('.mdf-pending')).toBeVisible();
  await expect(f.locator('.mdf-selected')).toHaveCount(0);
  const c = myPending().find((x) => x.body.includes(body));
  metric('올라간 자리', where(c));
  expect([c?.path, c?.side, c?.start_line, c?.line]).toEqual(['docs/new-page.md', 'RIGHT', a, b]);
  expect(posted(body), '보류 중이라 남에게는 안 보인다').toBeUndefined();
  clean();
});

test('T08 지운 문단에는 원래 파일 쪽 코멘트가 달리고, 보류 중인 리뷰가 있으면 리뷰에 넣는다', async ({ page }) => {
  clean();
  await open(page, 'review');
  const hb = fileOf(page, 'docs/handbook.md');
  await rendered(hb);
  const removed = prose(hb).locator('p', { hasText: 'Use two blank lines' }).first();
  let form = await formFor(hb, removed);
  await expect(form.locator('.mdf-comment-label')).toHaveText(/\b25\b.+·/); // "25번째 줄 · 원래 파일"
  const body = text('left');
  await submit(hb, form, body, 'review');
  const c = myPending().find((x) => x.body.includes(body));
  metric('올라간 자리', where(c));
  expect([c?.path, c?.side, c?.line]).toEqual(['docs/handbook.md', 'LEFT', 25]);

  // 보류 중인 리뷰가 생겼으니 다음 상자는 "리뷰에 넣기"만 있다(바로 올리기 없음) — 답글 상자도 같다
  form = await formFor(hb, prose(hb).locator('li', { hasText: 'Connect your calendar' }).first());
  await expect(buttons(form)).toHaveCount(2);
  await buttons(form).first().click();
  const seeded = hb.locator('[data-mdf="thread"]', { hasText: S.seeds.para.body });
  await seeded.locator('.mdf-thread-body > .mdf-comment-actions > button').first().click(); // 답글
  const replyForm = seeded.locator('.mdf-comment-form');
  await expect(buttons(replyForm)).toHaveCount(2);
  await buttons(replyForm).first().click();
  clean();
});

test('T09 기존 스레드에 답글을 달면 그 스레드의 답글이 된다', async ({ page }) => {
  clean();
  await open(page, 'review');
  const hb = fileOf(page, 'docs/handbook.md');
  await rendered(hb);
  const t = hb.locator('[data-mdf="thread"]', { hasText: S.seeds.para.body });
  await t.locator('.mdf-thread-body > .mdf-comment-actions > button').first().click();
  const form = t.locator('.mdf-comment-form');
  const body = text('reply');
  await form.locator('textarea').fill(body);
  await expect(buttons(form)).toHaveCount(3);
  await buttons(form).nth(1).click(); // 답글(바로 올리기)
  await expect(t.locator('.mdf-comment')).toHaveCount(2, { timeout: 20_000 });
  await expect(t).toContainText(body);
  const c = posted(body);
  metric('답글이 붙은 코멘트', c?.in_reply_to_id ?? '없음');
  expect(c?.in_reply_to_id).toBe(S.seeds.para.id);
  clean();
});

test('T10 스레드를 해결하면 접히고, 해결 취소하면 다시 펼쳐진다', async ({ page }) => {
  await open(page, 'review');
  const hb = fileOf(page, 'docs/handbook.md');
  await rendered(hb);
  const t = hb.locator('[data-mdf="thread"]', { hasText: S.seeds.range.body });
  const id = S.seeds.range.thread!;
  const isResolved = () => threads(REPO, PR).find((x) => x.id === id)?.isResolved;
  await t.locator('.mdf-thread-body > .mdf-comment-actions > button').last().click(); // 대화 해결
  await expect(t.locator('.mdf-thread-body')).toBeHidden({ timeout: 20_000 });
  await expect.poll(isResolved, { timeout: 15_000 }).toBe(true);
  await t.locator('.mdf-thread-head').click();
  await t.locator('.mdf-thread-body > .mdf-comment-actions > button').last().click(); // 해결 취소
  await expect.poll(isResolved, { timeout: 15_000 }).toBe(false);
  await expect(t.locator('.mdf-thread-body')).toBeVisible();
});

test('T11 이름이 바뀌고 내용도 바뀐 파일에도 새 경로로 코멘트가 달린다', async ({ page }) => {
  clean();
  await open(page, 'review');
  const f = fileOf(page, 'docs/guides/renamed-edit.md');
  await rendered(f);
  const form = await formFor(f, prose(f).locator('p', { hasText: 'search notes' }).first());
  await expect(form.locator('.mdf-comment-label')).toHaveText(/\b3\b/);
  const body = text('renamed');
  await submit(f, form, body, 'single');
  const c = posted(body);
  metric('올라간 자리', where(c));
  expect([c?.path, c?.side, c?.line]).toEqual(['docs/guides/renamed-edit.md', 'RIGHT', 3]);
  clean();
});

test('T12 큰 파일(2,400줄 바뀜)도 렌더링 보기로 열리고 경고가 없다', async ({ page, worker }) => {
  const t0 = await open(page, 'large');
  const f = fileOf(page, 'docs/large.md');
  await expect(prose(f)).toBeVisible({ timeout: 60_000 });
  metric('렌더링까지(ms)', Date.now() - t0);
  await page.waitForTimeout(4000);
  await noProblems(page, worker);
});

test('T13 파일 120개(md 100) PR에서 md는 모두 렌더링되고 txt는 그대로다', async ({ page, worker }) => {
  test.setTimeout(180_000);
  const t0 = await open(page, 'many');
  const md = page.locator('div[id^="diff-"][class*="Diff-module__diff__"]').filter({ has: page.locator('h3 code', { hasText: /\.md\b/ }) });
  await expect(md).toHaveCount(100, { timeout: 60_000 });
  // 화면 밖 파일도 차례로 받아 오는지 — 끝까지 내려가며 기다린다
  await expect(async () => {
    await page.mouse.wheel(0, 4000);
    expect(await md.filter({ has: page.locator('.prose-diff .markdown-body') }).count()).toBe(100);
  }).toPass({ timeout: 120_000, intervals: [1000] });
  metric('md 100개 렌더링까지(ms)', Date.now() - t0);
  const txt = page.locator('div[id^="diff-"][class*="Diff-module__diff__"]').filter({ has: page.locator('h3 code', { hasText: /\.txt\b/ }) });
  await expect(txt).toHaveCount(20);
  await expect(txt.locator('.prose-diff')).toHaveCount(0);
  await page.waitForTimeout(4000);
  await noProblems(page, worker);
});

test('T14 로그아웃 화면(옛 /files)에서도 렌더링·접기는 되고 "+"는 없다', async () => {
  const context = await launchLoggedOut();
  try {
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await sw.evaluate(() => chrome.storage.local.set({ enabled: true }));
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`${S.prs.review.url}/files`);
    const file = page.locator('div.file.js-file', { has: page.locator('.file-header[data-path="docs/handbook.md"]') });
    await expect(file.locator('.prose-diff .markdown-body')).toBeVisible({ timeout: 30_000 });
    await expect(file.locator('[data-mdf="fold"]').first()).toBeVisible();
    await file.locator('.markdown-body p', { hasText: 'or your app store' }).first().hover();
    await page.waitForTimeout(1000);
    await expect(page.locator('[data-mdf="add-comment"]')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

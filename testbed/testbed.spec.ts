import { expect, test as base, type BrowserContext, type Locator, type Page, type Worker } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launch, launchLoggedOut } from '../e2e/support';
import { api, cleanRuns, comments, me, setResolved, threadAt, threads, type ReviewComment, type ThreadAt } from './github';
import { ORIGINAL_FILE, QUERY, applyPrefs, restorePrefs, type Layout } from './layout';
import { RUN_MARKER, baseFiles, headFiles, lineOf } from './scenarios';

// 배포 전 시나리오 — 공개 테스트 저장소(testbed)의 PR에서 실제로 코멘트를 달고, 기존 스레드를 보고, 답글·해결을 해 본다.
// 먼저 `pnpm testbed:setup`(저장소·PR·스레드 맞추기). 쓰는 코멘트는 본문에 RUN_MARKER가 들어가고 테스트마다 앞뒤로 지운다.
// 결과 수치는 annotations(type 'metric')로 남겨 `pnpm testbed:report`가 보고서에 옮긴다.

interface State {
  repo: string;
  version: string;
  prs: Record<'review' | 'large' | 'many' | 'followup', { number: number; url: string; head: string }>;
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
const BASE = baseFiles();
const LOGIN = me();

/** 계정 설정을 바꿔야 하는 layout(톱니바퀴 메뉴) — 프로젝트를 시작할 때 바꾸고 끝나면 되돌린다 */
async function withPrefs(fn: (page: Page) => Promise<unknown>): Promise<void> {
  const context = await launch();
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`${S.prs.review.url}/changes?diff=split`);
    await page.waitForTimeout(3000);
    await fn(page);
  } finally {
    await context.close();
  }
}

const test = base.extend<{ context: BrowserContext; page: Page; worker: Worker }, { layout: Layout; prefs: void }>({
  layout: ['split', { option: true, scope: 'worker' }],
  prefs: [
    async ({ layout }, use) => {
      if (layout === 'minimized' || layout === 'compact') {
        await withPrefs((page) => applyPrefs(page, layout));
        try {
          await use();
        } finally {
          await withPrefs((page) => restorePrefs(page));
        }
      } else {
        // 지난 실행이 계정 설정을 바꾼 채 멈췄으면 먼저 되돌린다
        if (existsSync(ORIGINAL_FILE)) await withPrefs((page) => restorePrefs(page));
        await use();
      }
    },
    { scope: 'worker', auto: true },
  ],
  // 실패하면 그 시나리오의 기록(trace.zip — 화면·DOM·네트워크)과 페이지 콘솔을 결과 폴더에 남긴다(가끔 실패하는 것을 다음에 가리려고)
  context: async ({}, use, testInfo) => {
    const context = await launch();
    await context.tracing.start({ screenshots: true, snapshots: true });
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await sw.evaluate(() => chrome.storage.local.set({ enabled: true }));
    await use(context);
    const failed = testInfo.status !== testInfo.expectedStatus;
    await context.tracing.stop(failed ? { path: testInfo.outputPath('trace.zip') } : undefined);
    await context.close();
  },
  worker: async ({ context }, use) => use(context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))),
  page: async ({ context }, use, testInfo) => {
    const page = context.pages()[0] ?? (await context.newPage());
    const log: string[] = [];
    page.on('console', (m) => log.push(`${m.type()} ${m.text()}`));
    await use(page);
    if (testInfo.status !== testInfo.expectedStatus && log.length) await testInfo.attach('console', { body: log.join('\n'), contentType: 'text/plain' });
  },
});

const metric = (name: string, value: string | number) => test.info().annotations.push({ type: 'metric', description: `${name}=${value}` });
const text = (name: string) => `${RUN_MARKER} ${RUN} · ${name}`;

function clean(pr = PR): void {
  cleanRuns(REPO, pr, RUN_MARKER, LOGIN);
}

/** 이 프로젝트의 화면 모양(Split·Unified·공백 숨김…) — 주소로 정한다 */
const layoutOf = (): Layout => ((test.info().project.use as { layout?: Layout }).layout ?? 'split');

async function open(page: Page, key: keyof State['prs']): Promise<number> {
  const t0 = Date.now();
  await page.goto(`${S.prs[key].url}/changes${QUERY[layoutOf()]}`);
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
async function hoverUntilPlus(file: Locator, block: Locator, timeout = 30_000): Promise<Locator> {
  const plus = file.locator('[data-mdf="add-comment"]');
  // 가운데로 — 그냥 두면 Playwright가 블록을 화면 맨 아래 끝에 겨우 걸치게 두어, 범위를 끌 때 끝 블록이 화면 밖에 남는다(T07이 가끔 실패)
  await block.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await expect(async () => {
    await block.hover({ position: { x: 10, y: 5 } });
    await block.hover({ position: { x: 20, y: 6 } });
    await expect(plus).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout });
  return plus;
}

async function formFor(file: Locator, block: Locator, timeout?: number): Promise<Locator> {
  await (await hoverUntilPlus(file, block, timeout)).click();
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

function posted(body: string): ReviewComment | undefined {
  return comments(REPO, PR).find((c) => c.body.includes(body));
}

/** 올라간 코멘트의 자리(보류 중인 것 포함) */
const placed = (body: string): ThreadAt | null => threadAt(REPO, PR, body);

const where = (t: ThreadAt | null) => (t ? `${t.path} ${t.side} ${t.startLine ? `${t.startLine}–` : ''}${t.line}${t.pending ? ' (보류 중)' : ''}` : '없음');

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

test('T01 바뀐 md 파일은 렌더링 보기로 열리고, 렌더링이 없는 파일은 그대로 둔다 @layout @quick', async ({ page, worker }) => {
  const t0 = await open(page, 'review');
  for (const path of ['docs/handbook.md', 'docs/pricing.md', 'docs/new-page.md', 'docs/guides/renamed-edit.md', 'docs/escape.md', 'docs/widget.mdx']) {
    await rendered(fileOf(page, path));
  }
  metric(`PR #${S.prs.review.number} 렌더링 6개까지(ms)`, Date.now() - t0);
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

test('T02 변경 없는 구간은 접히고, 표는 바뀐 행만 보이게 합친다 @layout', async ({ page }) => {
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

test('T03 렌더링에 드러나지 않는 변경은 알리고, 버튼으로 원문 보기로 간다 @layout', async ({ page }) => {
  await open(page, 'review');
  const f = fileOf(page, 'docs/escape.md');
  await rendered(f);
  const notice = f.locator('[data-mdf="no-change"]');
  await expect(notice).toBeVisible();
  await notice.locator('button').click();
  await expect(f.locator('table[data-diff-anchor]')).toBeVisible({ timeout: 15_000 });
  await expect(prose(f)).toHaveCount(0);
});

test('T04 기존 리뷰 스레드가 가리키는 블록 바로 아래에 붙는다 @layout @quick', async ({ page }) => {
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

test('T05 블록마다 "+"가 맞는 원문 줄을 고른다(표 행·HTML 표·알림·코드·목록·각주) @layout @quick', async ({ page }) => {
  await open(page, 'review');
  const hb = fileOf(page, 'docs/handbook.md');
  await rendered(hb);
  const body = prose(hb);
  const hbText = HEAD['docs/handbook.md'];
  const baseText = BASE['docs/handbook.md'];
  const cases: Array<[string, Locator, RegExp]> = [
    ['표 행', body.locator('[data-mdf="table"] tr', { hasText: '$9' }).first(), new RegExp(`\\bR${lineOf(hbText, '| Team |')}\\b`)],
    ['HTML 표 행', body.locator('tr', { hasText: 'Link notes to pull requests' }).first(), new RegExp(`\\bR${lineOf(hbText, '<tr><td>GitHub')}\\b`)],
    ['목록 항목', body.locator('li', { hasText: 'Connect your calendar' }).first(), new RegExp(`\\bR${lineOf(hbText, '- Connect your calendar')}\\b`)],
    // 고친 알림은 GitHub가 제목 문단과 본문으로 나눠 그린다(.markdown-alert 묶음 없음)
    ['알림 제목', body.locator('p.markdown-alert-title').first(), new RegExp(`\\bR${lineOf(hbText, '> [!NOTE]')}\\b`)],
    ['알림 본문', body.locator('.changed', { hasText: 'Shared links never include' }).first(), new RegExp(`\\bR${lineOf(hbText, 'or drafts.')}\\b`)],
    ['코드 블록', body.locator('pre', { hasText: '--template meeting' }).first(), new RegExp(`\\bR${lineOf(hbText, '```bash')}\\b.*\\bR${lineOf(hbText, '```bash') + 2}\\b`)],
    // 문서 중간에 정의한 각주 — 렌더링은 문서 끝에 모은다. 고친 각주는 옛 항목·새 항목이 따로 나온다
    ['각주(새)', body.locator('[data-footnotes] li.added').first(), new RegExp(`\\bR${lineOf(hbText, '[^sync]:')}\\b`)],
    ['각주(옛)', body.locator('[data-footnotes] li.removed').first(), new RegExp(`\\bL${lineOf(baseText, '[^sync]:')}\\b`)],
  ];
  for (const [name, block, want] of cases) {
    const form = await formFor(hb, block, 15_000);
    const label = (await form.locator('.mdf-comment-label').textContent()) ?? '';
    metric(`줄 연결 ${name}`, label);
    expect.soft(label, name).toMatch(want);
    await buttons(form).first().click(); // 취소
    await expect(form).toHaveCount(0);
  }
});

test('T06 한 줄 코멘트를 바로 올리면 그 줄의 보통 코멘트가 된다 @layout', async ({ page }) => {
  clean();
  await open(page, 'review');
  const hb = fileOf(page, 'docs/handbook.md');
  await rendered(hb);
  const block = prose(hb).locator('p', { hasText: 'or your app store' });
  const form = await formFor(hb, block);
  await expect(form.locator('.mdf-comment-label')).toHaveText(/\bR13\b/);
  const body = text('single');
  await submit(hb, form, body, 'single');
  const t = placed(body);
  metric('올라간 자리', where(t));
  expect(t).toEqual({ path: 'docs/handbook.md', side: 'RIGHT', line: 13, startLine: null, pending: false });
  expect(posted(body), 'REST 목록에도 보인다(보류 중이 아님)').toBeTruthy();
  // 다시 열어도 그 블록 아래에 있다(심은 스레드와 같은 줄)
  await page.reload();
  await rendered(hb);
  const box = hb.locator('[data-mdf="thread"]', { hasText: body });
  await expect(box).toBeVisible({ timeout: 20_000 });
  expect(await box.evaluate((el) => el.parentElement?.textContent ?? '')).toContain('or your app store');
  clean();
});

test('T07 끌어서 고른 범위로 리뷰를 시작하면 보류 중인 리뷰의 범위 코멘트가 된다', async ({ page }) => {
  clean();
  await open(page, 'review');
  const f = fileOf(page, 'docs/new-page.md');
  await rendered(f);
  const first = prose(f).locator('p', { hasText: 'Run the test suite' });
  const last = prose(f).locator('p', { hasText: 'Post the release notes' });
  await hoverUntilPlus(f, first);
  // 첫 호버는 원문을 받는 동안 1초쯤 걸리고, 그사이 위쪽 파일에 스레드·툴바가 들어오면 크롬이 화면을 옮긴다(스크롤 고정).
  // 원문을 받은 뒤 다시 가운데로 맞추고 곧바로 재서 끈다 — 잰 좌표가 낡아 끝 블록이 화면 밖이던 것(T07이 가끔 실패)
  const plus = await hoverUntilPlus(f, first);
  const p = (await plus.boundingBox())!;
  const end = (await last.boundingBox())!;
  expect(end.y + end.height, '끌 범위가 화면 안에 있어야 한다').toBeLessThan(page.viewportSize()?.height ?? 720);
  await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + 30, end.y + end.height / 2, { steps: 8 });
  await page.mouse.up();
  const form = f.locator('[data-mdf="comment-form"]');
  const text0 = HEAD['docs/new-page.md'];
  const [a, b] = [lineOf(text0, 'Run the test suite'), lineOf(text0, 'Post the release notes')];
  await expect(form.locator('.mdf-comment-label')).toHaveText(new RegExp(`\\bR${a}\\b.*\\bR${b}\\b`));
  metric('고른 블록(노란 음영)', await f.locator('.mdf-selected').count());
  expect(await f.locator('.mdf-selected').count()).toBeGreaterThanOrEqual(3);
  const body = text('range');
  await submit(f, form, body, 'review');
  await expect(f.locator('[data-mdf="thread"]', { hasText: body }).locator('.mdf-pending')).toBeVisible();
  await expect(f.locator('.mdf-selected')).toHaveCount(0);
  const t = placed(body);
  metric('올라간 자리', where(t));
  expect(t).toEqual({ path: 'docs/new-page.md', side: 'RIGHT', line: b, startLine: a, pending: true });
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
  await expect(form.locator('.mdf-comment-label')).toHaveText(/\bL25\b/); // 원래 파일 쪽은 GitHub처럼 L
  const body = text('left');
  await submit(hb, form, body, 'review');
  const t = placed(body);
  metric('올라간 자리', where(t));
  expect(t).toEqual({ path: 'docs/handbook.md', side: 'LEFT', line: lineOf(BASE['docs/handbook.md'], 'Use two blank lines'), startLine: null, pending: true });

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
  await expect(form.locator('.mdf-comment-label')).toHaveText(/\bR3\b/);
  const body = text('renamed');
  await submit(f, form, body, 'single');
  const t = placed(body);
  metric('올라간 자리', where(t));
  expect(t).toEqual({ path: 'docs/guides/renamed-edit.md', side: 'RIGHT', line: 3, startLine: null, pending: false });
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

test('T14 로그아웃 화면(옛 /files)에서 스레드 없는 md는 렌더링·접기, 스레드 있는 md는 원문 그대로(스레드가 보이게), "+"는 없다', async () => {
  const context = await launchLoggedOut();
  try {
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await sw.evaluate(() => chrome.storage.local.set({ enabled: true }));
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`${S.prs.review.url}/files`);
    await expect(page.locator('meta[name="user-login"]')).toHaveAttribute('content', '');
    const classic = (path: string) => page.locator('div.file.js-file', { has: page.locator(`.file-header[data-path="${path}"]`) });
    // 렌더링에 안 드러나는 변경(escape.md)은 옛 화면에서 GitHub가 렌더링 본문을 숨기고 자기 안내를 보인다 — 여기서는 보지 않는다
    const widget = classic('docs/widget.mdx');
    await expect(widget.locator('.prose-diff .markdown-body')).toBeVisible({ timeout: 30_000 });
    await expect(widget.locator('[data-mdf="fold"]').first()).toBeVisible();
    const hb = classic('docs/handbook.md');
    await expect(hb.locator('tr.inline-comments').first()).toBeAttached({ timeout: 20_000 });
    await expect(hb.locator('.prose-diff')).toHaveCount(0);
    await expect(page.locator('[data-mdf="add-comment"]')).toHaveCount(0);
    await expect(page.locator('[data-mdf="problem-toast"]')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('T15 파일 툴바 요약과 ] [ } { 이동 — 바뀐 곳·스레드를 페이지 순서로, 글을 쓰는 중에는 가로채지 않는다 @layout @quick', async ({ page }) => {
  await open(page, 'review');
  for (const path of ['docs/guides/renamed-edit.md', 'docs/handbook.md', 'docs/new-page.md', 'docs/pricing.md', 'docs/widget.mdx', 'docs/escape.md']) {
    await rendered(fileOf(page, path));
  }
  const summary = (path: string) => fileOf(page, path).locator('[data-mdf="file-toolbar"] .mdf-summary');
  // 내용 v1 기준: handbook은 바뀐 곳 8(머리말 표·문단·목록·지운 문단+코드·Plans 표·알림·HTML 표·각주), 심은 스레드 3
  await expect(summary('docs/handbook.md')).toHaveText(/\b8\b.*\b3\b.*\b3\b/, { timeout: 20_000 });
  await expect(summary('docs/pricing.md')).toHaveText(/\b1\b.*\b1\b.*\b0\b/); // 해결된 스레드는 미해결에 세지 않는다
  await expect(summary('docs/widget.mdx')).toHaveText(/^\D*1\D*$/);
  await expect(summary('docs/escape.md')).toHaveCount(0); // 렌더링에 안 드러나는 변경 — 요약 대신 안내
  metric('handbook 요약', (await summary('docs/handbook.md').textContent()) ?? '');

  const status = page.locator('[data-mdf="nav-status"]');
  const press = async (key: string) => {
    await page.keyboard.press(key);
    return (await status.textContent()) ?? '';
  };
  const flashedTop = () => page.evaluate(() => [Math.round(document.querySelector('.mdf-flash')?.getBoundingClientRect().top ?? -1), Math.round(innerHeight * 0.3)]);
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  const changes: string[] = [];
  for (let i = 0; i < 13; i++) changes.push(await press(']'));
  metric('] 차례', changes.join(' → '));
  expect(changes.slice(0, 12)).toEqual(Array.from({ length: 12 }, (_, i) => expect.stringMatching(new RegExp(`\\b${i + 1}\\D+12\\b`))));
  expect(changes[12]).not.toMatch(/\d/); // 끝 안내
  expect(await press('[')).toMatch(/\b11\D+12\b/);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1300); // 앞의 비춤(1.2초)이 사라진 뒤에 잰다
  const first = await press('}');
  expect(first).toMatch(/\b1\D+6\b/);
  const [top, ref] = await flashedTop();
  expect(Math.abs(top - ref)).toBeLessThan(12); // GitHub 고정 머리 아래, 화면 위 30%
  for (let i = 2; i <= 6; i++) expect(await press('}')).toMatch(new RegExp(`\\b${i}\\D+6\\b`));
  expect(await press('{')).toMatch(/\b5\D+6\b/);

  // 코멘트 상자에 쓰는 중에는 ]가 글자로 들어간다
  const hb = fileOf(page, 'docs/handbook.md');
  const form = await formFor(hb, prose(hb).locator('li', { hasText: 'Connect your calendar' }).first());
  const before = await status.textContent();
  await form.locator('textarea').click();
  await page.keyboard.type('a]b[');
  await expect(form.locator('textarea')).toHaveValue('a]b[');
  expect(await status.textContent()).toBe(before);
  await buttons(form).first().click();

  // 툴바 ↓는 그 파일 안에서만
  await fileOf(page, 'docs/pricing.md').locator('[data-mdf="file-toolbar"] .mdf-nav').last().click();
  await expect(status).toHaveText(/\b1\D+1\b/);
  await expect(fileOf(page, 'docs/pricing.md').locator('[data-mdf="table"].mdf-flash')).toHaveCount(1);
  await page.waitForTimeout(1500);
  await expect(page.locator('.mdf-flash')).toHaveCount(0); // 비춤은 1.2초 뒤 모두 걷힌다
});

// ── 리뷰 뒤 따라온 커밋(PR followup) — 파일 전체 코멘트·낡은 스레드·제안·서식 ──────────────────────────────

const FU = () => S.prs.followup.number;
const roadmap = (page: Page) => fileOf(page, 'docs/roadmap.md');

test('T16 파일 전체에 단 코멘트가 렌더링 보기 맨 위에 보이고 답글을 달 수 있다 @layout', async ({ page }) => {
  clean(FU());
  await open(page, 'followup');
  const f = roadmap(page);
  await rendered(f);
  const t = f.locator('[data-mdf="thread"]', { hasText: S.seeds.file.body });
  await expect(t).toBeVisible({ timeout: 20_000 });
  // 본문 첫 블록(제목)보다 앞 — 파일 맨 위
  expect(await t.evaluate((el) => {
    const h1 = el.closest('.markdown-body')?.querySelector('h1');
    return Boolean(h1 && el.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);
  metric('스레드 머리', (await t.locator('.mdf-thread-head').textContent()) ?? '');
  if (layoutOf() !== 'split') return; // 쓰기는 split 한 번만
  await t.locator('.mdf-thread-body > .mdf-comment-actions > button').first().click(); // 답글
  const form = t.locator('.mdf-comment-form');
  const body = text('file-reply');
  await form.locator('textarea').fill(body);
  await buttons(form).nth(1).click();
  await expect(t.locator('.mdf-comment')).toHaveCount(2, { timeout: 20_000 });
  const c = comments(REPO, FU()).find((x) => x.body.includes(body));
  metric('답글이 붙은 코멘트', c?.in_reply_to_id ?? '없음');
  expect(c?.in_reply_to_id).toBe(S.seeds.file.id);
  clean(FU());
});

test('T17 따라온 커밋으로 낡은 스레드는 GitHub처럼 본문에 두지 않고 요약에도 세지 않는다', async ({ page }) => {
  await open(page, 'followup');
  const f = roadmap(page);
  await rendered(f);
  await expect(f.locator('[data-mdf="thread"]', { hasText: S.seeds.current.body })).toBeVisible({ timeout: 20_000 });
  await expect(f.locator('[data-mdf="thread"]', { hasText: S.seeds.outdated.body })).toHaveCount(0);
  // 지금 줄 스레드 3개 + 파일 전체 1개, 낡은 것 빼고
  await expect(f.locator('.mdf-summary')).toHaveText(/스레드 4개|4 threads/);
  metric('요약', (await f.locator('.mdf-summary').textContent()) ?? '');
});

test('T18 제안·서식 있는 코멘트를 GitHub 모양 그대로 보여 준다(제안 표·목록·코드·링크) @layout', async ({ page }) => {
  await open(page, 'followup');
  const f = roadmap(page);
  await rendered(f);
  const sug = f.locator('[data-mdf="thread"]', { hasText: 'Shorter wording' });
  await expect(sug).toBeVisible({ timeout: 20_000 });
  await expect(sug.locator('.js-suggested-changes-blob')).toContainText('Shortcuts for every command');
  const rich = f.locator('[data-mdf="thread"]', { hasText: 'Two notes' });
  await expect(rich.locator('ol > li')).toHaveCount(2);
  await expect(rich.locator('strong', { hasText: 'tablet' })).toBeVisible();
  await expect(rich.locator('a[href*="markdown-diff-cat-testbed/blob/main/README.md"]')).toBeVisible();
  await expect(rich.locator('pre')).toContainText('const shared = true;');
});

// ── 리뷰 흐름 더 — 보류 중 답글·⌘Enter·표 행 ──────────────────────────────────────────────────────────

test('T19 보류 중인 리뷰가 있을 때 답글은 그 리뷰의 보류 중 답글로 올라간다', async ({ page }) => {
  clean();
  await open(page, 'review');
  const hb = fileOf(page, 'docs/handbook.md');
  await rendered(hb);
  const form = await formFor(hb, prose(hb).locator('li', { hasText: 'Connect your calendar' }).first());
  await submit(hb, form, text('review-start'), 'review');
  const t = hb.locator('[data-mdf="thread"]', { hasText: S.seeds.para.body });
  await t.locator('.mdf-thread-body > .mdf-comment-actions > button').first().click(); // 답글
  const rf = t.locator('.mdf-comment-form');
  await expect(buttons(rf)).toHaveCount(2); // 취소 · 리뷰에 넣기
  const body = text('pending-reply');
  await rf.locator('textarea').fill(body);
  await rf.locator('.mdf-btn-primary').click();
  await expect(t).toContainText(body, { timeout: 20_000 });
  const at = placed(body);
  metric('올라간 자리', where(at));
  expect(at).toEqual({ path: 'docs/handbook.md', side: 'RIGHT', line: S.seeds.para.line, startLine: null, pending: true });
  expect(posted(body), '보류 중이라 남에게는 안 보인다').toBeUndefined();
  clean();
});

test('T20 코멘트 상자에서 ⌘Enter(Ctrl+Enter)로 바로 올린다', async ({ page }) => {
  clean();
  await open(page, 'review');
  const hb = fileOf(page, 'docs/handbook.md');
  await rendered(hb);
  const form = await formFor(hb, prose(hb).locator('pre', { hasText: '--template meeting' }).first());
  const body = text('cmd-enter');
  await form.locator('textarea').fill(body);
  await form.locator('textarea').press('ControlOrMeta+Enter');
  await expect(hb.locator('[data-mdf="thread"]', { hasText: body })).toBeVisible({ timeout: 20_000 });
  const at = placed(body);
  metric('올라간 자리', where(at));
  const fence = lineOf(HEAD['docs/handbook.md'], '```bash');
  expect(at).toEqual({ path: 'docs/handbook.md', side: 'RIGHT', line: fence + 2, startLine: fence, pending: false });
  clean();
});

test('T21 합친 표의 바뀐 행에 단 코멘트는 그 행의 원문 줄에 붙고, 다시 열면 표 뒤에 보인다', async ({ page }) => {
  clean();
  await open(page, 'review');
  const hb = fileOf(page, 'docs/handbook.md');
  await rendered(hb);
  const line = lineOf(HEAD['docs/handbook.md'], '| Team |');
  const form = await formFor(hb, prose(hb).locator('[data-mdf="table"] tr', { hasText: '$9' }).first());
  await expect(form.locator('.mdf-comment-label')).toHaveText(new RegExp(`\\bR${line}\\b`));
  const body = text('table-row');
  await submit(hb, form, body, 'single');
  const at = placed(body);
  metric('올라간 자리', where(at));
  expect(at).toEqual({ path: 'docs/handbook.md', side: 'RIGHT', line, startLine: null, pending: false });
  await page.reload();
  await rendered(hb);
  const box = hb.locator('[data-mdf="thread"]', { hasText: body });
  await expect(box).toBeVisible({ timeout: 20_000 });
  expect(await box.evaluate((el) => el.previousElementSibling?.matches('[data-mdf="table"], ins, del') ?? false)).toBe(true);
  clean();
});

// ── 내 코멘트 편집·삭제·미리보기(1.3.0) ────────────────────────────────────────────────────────────────

/** REST로 내 코멘트 하나를 달아 둔다(화면에서 고치고 지울 대상) */
function seedMine(body: string, anchor = 'Lantern keeps every note'): ReviewComment {
  return api<ReviewComment>(`repos/${REPO}/pulls/${PR}/comments`, 'POST', {
    body, commit_id: S.prs.review.head, path: 'docs/handbook.md', side: 'RIGHT', line: lineOf(HEAD['docs/handbook.md'], anchor),
  });
}

const tool = (t: Locator, name: RegExp) => t.locator('.mdf-comment-tools button').filter({ hasText: name });

test('T22 내 코멘트를 렌더링 보기에서 고치면(미리보기 포함) GitHub 코멘트가 바뀐다', async ({ page }) => {
  clean();
  const before = text('edit-before');
  const c = seedMine(before);
  await open(page, 'review');
  const hb = fileOf(page, 'docs/handbook.md');
  await rendered(hb);
  const t = hb.locator('[data-mdf="thread"]', { hasText: before });
  await expect(t).toBeVisible({ timeout: 20_000 });
  await tool(t, /^(편집|Edit)$/).click();
  const area = t.locator('.mdf-comment-edit textarea');
  await expect(area).toHaveValue(before);
  const after = `${text('edit-after')} **굵게**`;
  await area.fill(after);
  await t.locator('.mdf-comment-edit .mdf-tab').nth(1).click(); // 미리보기
  await expect(t.locator('.mdf-comment-edit .mdf-preview strong')).toHaveText('굵게', { timeout: 15_000 });
  await t.locator('.mdf-comment-edit .mdf-tab').nth(0).click();
  await t.locator('.mdf-comment-edit .mdf-btn-primary').click(); // 저장
  const box = hb.locator('[data-mdf="thread"]', { hasText: 'edit-after' });
  await expect(box.locator('.mdf-comment-body strong')).toHaveText('굵게', { timeout: 20_000 });
  const now = api<ReviewComment>(`repos/${REPO}/pulls/comments/${c.id}`);
  metric('GitHub 본문', now.body.slice(0, 60));
  expect(now.body).toBe(after);
  clean();
});

test('T23 내 코멘트를 두 번 눌러 지우면 스레드가 사라지고 GitHub에서도 없어진다', async ({ page }) => {
  clean();
  const body = text('delete-me');
  const c = seedMine(body, 'Notes support headings');
  await open(page, 'review');
  const hb = fileOf(page, 'docs/handbook.md');
  await rendered(hb);
  const t = hb.locator('[data-mdf="thread"]', { hasText: body });
  await expect(t).toBeVisible({ timeout: 20_000 });
  const del = tool(t, /^(삭제|Delete)$/);
  await del.click();
  await expect(t.locator('.mdf-comment-tools .mdf-danger')).toBeVisible(); // "정말 삭제"
  expect(comments(REPO, PR).some((x) => x.id === c.id), '한 번 눌러서는 지우지 않는다').toBe(true);
  await t.locator('.mdf-comment-tools .mdf-danger').click();
  await expect(hb.locator('[data-mdf="thread"]', { hasText: body })).toHaveCount(0, { timeout: 20_000 });
  expect(comments(REPO, PR).some((x) => x.id === c.id)).toBe(false);
  clean();
});

test('T24 새 코멘트 상자의 미리보기는 GitHub와 같게 렌더링한다(굵게·코드·멘션) — 올리지 않고 닫는다', async ({ page }) => {
  clean();
  await open(page, 'review');
  const hb = fileOf(page, 'docs/handbook.md');
  await rendered(hb);
  const form = await formFor(hb, prose(hb).locator('li', { hasText: 'Connect your calendar' }).first());
  await form.locator('textarea').fill(`**굵게** \`code\` @${LOGIN}`);
  await form.locator('.mdf-tab').nth(1).click();
  const pane = form.locator('.mdf-preview');
  await expect(pane.locator('strong')).toHaveText('굵게', { timeout: 15_000 });
  await expect(pane.locator('code')).toHaveText('code');
  await expect(pane.locator('a.user-mention')).toHaveText(`@${LOGIN}`);
  await form.locator('.mdf-tab').nth(0).click();
  await expect(form.locator('textarea')).toBeVisible();
  await buttons(form).first().click(); // 취소
  await expect(form).toHaveCount(0);
});

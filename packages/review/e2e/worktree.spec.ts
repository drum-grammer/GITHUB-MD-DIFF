import { expect, test, type Page } from '@playwright/test';
import { api, cli, hoverUntilPlus, makeRepo, renderCount, startReview, type Repo } from './support';

const GUIDE = ['# Guide', '', 'Install the tool with one command.', '', '| Step | Status |', '| --- | --- |', '| Build | done |', '| Test | todo |', ''].join('\n');
const GUIDE2 = GUIDE.replace('one command', 'a single command').replace('| Test | todo |', '| Test | done |');

let repo: Repo;
test.afterEach(() => repo?.cleanup());

const fileSection = (page: Page, path: string) => page.locator('section.mdc-file', { has: page.locator('.mdc-file-head .mdc-path', { hasText: path }) });

test('리뷰 한 바퀴 — 열기·코멘트·보내기·comments 형식·--since-last', async ({ page, browser }) => {
  repo = makeRepo({ 'docs/guide.md': GUIDE });
  repo.write('docs/guide.md', GUIDE2);
  const review = await startReview(repo);
  await page.goto(review.url);
  await expect(page).toHaveURL(/\/$/); // 1회용 코드는 주소에서 지운다
  const file = fileSection(page, 'docs/guide.md');
  await expect(file.locator('[data-mdf="table"]')).toBeVisible(); // 바뀐 표는 합친 표 하나
  await expect(page.locator('.mdc-filerow .mdc-count-changes')).toHaveText('1 change'); // 바뀐 문단과 바로 뒤 합친 표는 이어진 한 곳

  const para = file.locator('p', { hasText: 'Install the tool' });
  await hoverUntilPlus(file, para);
  await file.locator('[data-mdf="add-comment"]').click();
  const form = page.locator('[data-mdf="comment-form"]');
  await expect(form).toContainText('Add a comment on line R3');
  await expect(form.locator('.mdf-avatar')).toHaveCount(0);
  await form.locator('textarea').fill('Make this shorter.');
  await form.locator('.mdf-btn-primary', { hasText: 'Add comment' }).click();
  await expect(file.locator('[data-mdf="thread"]', { hasText: 'Make this shorter.' })).toBeVisible();
  await expect(page.locator('.mdc-send')).toHaveText('Send to agent (1)');

  await page.locator('.mdc-send').click();
  await expect(page.locator('.mdc-toast')).toHaveText('Sent round 1 (1 comment). The agent can read it now.');
  await expect(file.locator('[data-mdf="thread"] .mdc-badge-sent')).toHaveText('Sent');

  const out = cli(repo, 'comments');
  expect(out.code).toBe(0);
  expect(out.stdout).toMatch(/^<!-- markdown-diff-cat round 1 · \d{4}-\d\d-\d\dT\d\d:\d\d[+-]\d\d:\d\d · base [0-9a-f]{7} \(merge-base main\) → working tree · review render r[0-9a-z]{5} -->/);
  expect(out.stdout).toContain('> Files: ["docs/guide.md"] · 1 comment (you 1 · others 0 · excluded 0)');
  expect(out.stdout).toContain('## "docs/guide.md"\n\n### 1 · L3 (new) · heading ["Guide"] · author: you\n```text\nInstall the tool with a single command.\n```\nMake this shorter.');

  // 에이전트가 고친 뒤 --since-last — 떠 있는 서버에 기준 바꾸기를 요청하고 새 주소를 낸다
  repo.write('docs/guide.md', GUIDE2.replace('a single command', 'one short command'));
  const again = cli(repo, 'review', '--since-last');
  expect(again.code).toBe(0);
  const url2 = /http:\/\/localhost:\d+\/\?code=[0-9a-f]{32}/.exec(again.stdout)![0];
  await expect(page.locator('.mdc-banner')).toContainText('The review base changed.', { timeout: 10_000 });
  const page2 = await (await browser.newContext()).newPage();
  await page2.goto(url2);
  const file2 = fileSection(page2, 'docs/guide.md');
  await expect(page2.locator('.mdc-base')).toContainText('review render r');
  await expect(file2.locator('ins', { hasText: 'short' })).toBeVisible();
  await expect(file2.locator('[data-mdf="table"]')).toHaveCount(0); // 지난 리뷰 전에 바뀐 표는 다시 뜨지 않는다
  await review.stop();
});

test('접기·원문만 바뀜 막대와 ] [ 이동, 새로고침해도 그 탭은 계속 쓴다', async ({ page }) => {
  repo = makeRepo({ 'a.md': '# A\n\nUse *b* here.\n\nSame one.\n\nSame two.\n\nSame three.\n\nSame four.\n\nMore text.\n' });
  repo.write('a.md', '# A\n\nUse _b_ here.\n\nSame one.\n\nSame two.\n\nSame three.\n\nSame four.\n\nMore text, changed.\n');
  const review = await startReview(repo);
  await page.goto(review.url);
  // 바뀌지 않은 구간은 접힌다 — 맨 위 제목 하나와, 두 변경 사이의 가운데 둘(앞뒤 한 블록씩은 문맥으로 남는다)
  await expect(page.locator('[data-mdf="fold"]')).toHaveText(['▸Unchanged · 1 block · last heading “A”', '▸Unchanged · 2 blocks']);
  await expect(page.locator('p', { hasText: 'Same two.' })).toBeHidden();
  const bar = page.locator('.mdc-source-only');
  await expect(bar).toBeVisible();
  await expect(page.locator('.mdc-count-invisible')).toHaveText('1 invisible');
  await bar.locator('.mdc-source-only-toggle').click();
  await expect(bar.locator('.mdc-source-diff')).toBeVisible();
  const nav = page.locator('[data-mdf="nav-status"]');
  await page.keyboard.press(']');
  await expect(nav).toContainText(/Change [12] of 2/); // 막대도 이동 대상이다
  if ((await nav.textContent())?.includes('Change 1 of 2')) {
    await page.keyboard.press(']');
    await expect(nav).toContainText('Change 2 of 2');
  }
  await page.keyboard.press('[');
  await expect(nav).toContainText('Change 1 of 2');
  await page.reload();
  await expect(page.locator('.mdc-source-only')).toBeVisible();
  await review.stop();
});

test('한글·공백 경로와 그냥 mv한 파일(이름 바꿈)', async ({ page }) => {
  const notes = Array.from({ length: 8 }, (_, i) => `Line ${i + 1} about the notes.`).join('\n\n') + '\n';
  repo = makeRepo({ '문서/설계 노트.md': '# 설계\n\n처음 글.\n', 'docs/old name.md': notes });
  repo.write('문서/설계 노트.md', '# 설계\n\n고친 글.\n');
  repo.move('docs/old name.md', 'docs/new name.md');
  repo.write('docs/new name.md', notes.replace('Line 3 about', 'Row 3 about'));
  const review = await startReview(repo);
  await page.goto(review.url);
  await expect(page.locator('.mdc-filerow .mdc-path')).toHaveText(['docs/old name.md → docs/new name.md', '문서/설계 노트.md']);
  await expect(page.locator('.mdc-filerow .mdc-status').first()).toHaveText('renamed');
  const file = fileSection(page, '문서/설계 노트.md');
  await hoverUntilPlus(file, file.locator('p', { hasText: '고친 글' }));
  await file.locator('[data-mdf="add-comment"]').click();
  await page.locator('[data-mdf="comment-form"] textarea').fill('짧게');
  await page.locator('[data-mdf="comment-form"] .mdf-btn-primary').click();
  await expect(file.locator('[data-mdf="thread"]', { hasText: '짧게' })).toBeVisible();
  await page.locator('.mdc-send').click();
  await expect(page.locator('.mdc-toast')).toContainText('Sent round 1');
  expect(cli(repo, 'comments').stdout).toContain('## "문서/설계 노트.md"\n\n### 1 · L3 (new) · heading ["설계"] · author: you');
  await review.stop();
});

test('md 변경이 없으면 서버 없이 끝난다', () => {
  repo = makeRepo({ 'a.md': 'a\n', 'notes.txt': 'x\n' });
  repo.write('notes.txt', 'y\n');
  const out = cli(repo, 'review');
  expect(out.code).toBe(0);
  expect(out.stdout).toMatch(/No Markdown changes between [0-9a-f]{7} \(merge-base main\) and the working tree\./);
});

test('라운드 — 넘기지 않은 둘은 오래된 것부터, 기다리기 전에 보낸 것은 wait가 바로, 그리기와 보내기 사이 변경은 머리 줄에', async ({ page }) => {
  repo = makeRepo({ 'a.md': '# A\n\none\n\ntwo\n' });
  repo.write('a.md', '# A\n\nONE\n\ntwo\n');
  const review = await startReview(repo);
  await page.goto(review.url);
  await expect(page.locator('section.mdc-file')).toHaveCount(1);
  const view = await api<{ rev: string }>(page, 'GET', '/api/view');
  await api(page, 'POST', '/api/drafts', { rev: view.rev, path: 'a.md', side: 'right', start: 3, end: 3, body: 'first' });
  expect(await api(page, 'POST', '/api/send', { rev: view.rev })).toEqual({ round: 1, comments: 1 });
  await api(page, 'POST', '/api/drafts', { rev: view.rev, path: 'a.md', side: 'right', start: 5, end: 5, body: 'second' });
  repo.write('a.md', '# A\n\nONE\n\ntwo, edited before sending\n');
  expect(await api(page, 'POST', '/api/send', { rev: view.rev })).toEqual({ round: 2, comments: 1 });
  const out = cli(repo, 'comments').stdout;
  expect(out.indexOf('round 1 ·')).toBeLessThan(out.indexOf('round 2 ·'));
  expect(out).toMatch(/round 2 · .* · review render r[0-9a-z]{5} \(files changed after this render\) -->/);
  const next = await api<{ rev: string }>(page, 'POST', '/api/redraw');
  await api(page, 'POST', '/api/drafts', { rev: next.rev, path: 'a.md', side: 'right', start: 3, end: 3, body: 'third' });
  await api(page, 'POST', '/api/send', { rev: next.rev });
  const waited = cli(repo, 'wait');
  expect(waited.code).toBe(0);
  expect(waited.stdout).toContain('round 3 ·');
  await review.stop();
});

test('연속 세 라운드 --since-last — 가운데 라운드에서 안 고친 파일의 옛 변경이 다시 뜨지 않는다', async ({ browser }) => {
  repo = makeRepo({ 'a.md': '# A\n\na0\n', 'b.md': '# B\n\nb0\n' });
  repo.write('a.md', '# A\n\na1\n');
  repo.write('b.md', '# B\n\nb1\n');
  const review = await startReview(repo);
  const open = async (url: string): Promise<Page> => {
    const p = await (await browser.newContext()).newPage();
    await p.goto(url);
    await expect(p.locator('.mdc-header')).toBeVisible();
    return p;
  };
  const sendOn = async (p: Page, path: string): Promise<void> => {
    const v = await api<{ rev: string }>(p, 'GET', '/api/view');
    await api(p, 'POST', '/api/drafts', { rev: v.rev, path, side: 'right', start: 3, end: 3, body: `fix ${path}` });
    await api(p, 'POST', '/api/send', { rev: v.rev });
  };
  const since = (): string => /http:\/\/localhost:\d+\/\?code=[0-9a-f]{32}/.exec(cli(repo, 'review', '--since-last').stdout)![0];
  await sendOn(await open(review.url), 'a.md'); // 라운드 1(분기점 보기: a·b)
  repo.write('a.md', '# A\n\na2\n');
  const p2 = await open(since());
  await expect(p2.locator('.mdc-filerow .mdc-path')).toHaveText(['a.md']);
  await sendOn(p2, 'a.md'); // 라운드 2(a만)
  repo.write('c.md', '# C\n\nnew\n');
  const p3 = await open(since());
  await expect(p3.locator('.mdc-filerow .mdc-path')).toHaveText(['c.md']); // b의 옛 변경·a는 다시 뜨지 않는다
  await review.stop();
});

test('렌더 판을 21번 넘게 다시 그린 뒤에도 --since-last의 기준 판은 남는다', async ({ page, browser }) => {
  repo = makeRepo({ 'a.md': '# A\n\na0\n', 'b.md': '# B\n\nb0\n' });
  repo.write('a.md', '# A\n\na1\n');
  repo.write('b.md', '# B\n\nb1\n');
  const review = await startReview(repo);
  await page.goto(review.url);
  const view = await api<{ rev: string }>(page, 'GET', '/api/view');
  await api(page, 'POST', '/api/drafts', { rev: view.rev, path: 'a.md', side: 'right', start: 3, end: 3, body: 'x' });
  await api(page, 'POST', '/api/send', { rev: view.rev });
  for (let i = 0; i < 25; i++) await api(page, 'POST', '/api/redraw');
  expect(renderCount(repo)).toBeLessThanOrEqual(22); // 최근 20개 + 라운드가 가리키는 판 + 지금 판
  repo.write('b.md', '# B\n\nb2\n');
  const url = /http:\/\/localhost:\d+\/\?code=[0-9a-f]{32}/.exec(cli(repo, 'review', '--since-last').stdout)![0];
  const p = await (await browser.newContext()).newPage();
  await p.goto(url);
  await expect(p.locator('.mdc-base')).toContainText(`review render ${view.rev}`);
  await expect(p.locator('.mdc-filerow .mdc-path')).toHaveText(['b.md']);
  await review.stop();
});

test('추적 안 하는 새 md를 mv해도 --since-last에서 이름 바꿈으로 보인다', async ({ page, browser }) => {
  const text = Array.from({ length: 6 }, (_, i) => `Line ${i + 1} about drafts.`).join('\n\n') + '\n';
  repo = makeRepo({ 'keep.md': '# K\n' });
  repo.write('draft.md', text); // 커밋하지 않은 새 파일
  const review = await startReview(repo);
  await page.goto(review.url);
  const v = await api<{ rev: string }>(page, 'GET', '/api/view');
  await api(page, 'POST', '/api/drafts', { rev: v.rev, path: 'draft.md', side: 'right', start: 1, end: 1, body: 'x' });
  await api(page, 'POST', '/api/send', { rev: v.rev });
  repo.move('draft.md', 'final.md'); // 에이전트가 그냥 mv
  const url = /http:\/\/localhost:\d+\/\?code=[0-9a-f]{32}/.exec(cli(repo, 'review', '--since-last').stdout)![0];
  const p = await (await browser.newContext()).newPage();
  await p.goto(url);
  await expect(p.locator('.mdc-filerow .mdc-path')).toHaveText(['draft.md → final.md']);
  await review.stop();
});

test('바뀐 단어는 GitHub rich diff와 같은 모양 — 더한 것은 밑줄·옅은 바탕, 지운 것은 줄 긋기, 글자색은 본문 그대로(밝음·어두움)', async ({ page }) => {
  repo = makeRepo({ 'a.md': '# A\n\nInstall from the downloads page and sign in.\n' });
  repo.write('a.md', '# A\n\nInstall from the downloads page or your app store, then sign in.\n');
  const review = await startReview(repo);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    if (scheme === 'light') await page.goto(review.url);
    const look = (sel: string) =>
      page.locator(sel).first().evaluate((el) => {
        const c = getComputedStyle(el);
        const body = getComputedStyle(el.closest('.markdown-body')!);
        return { td: c.textDecorationLine, sameColor: c.color === body.color, bg: c.backgroundColor };
      });
    const ins = await look('.changed ins');
    const del = await look('.changed del');
    expect(ins.td).toBe('underline');
    expect(del.td).toBe('line-through');
    expect(ins.sameColor && del.sameColor).toBe(true);
    // 옅은 바탕(muted) — 단어 강조색(diffBlob …-word)보다 옅다
    expect(ins.bg).toBe(scheme === 'light' ? 'rgb(218, 251, 225)' : 'rgba(46, 160, 67, 0.15)');
    expect(del.bg).toBe(scheme === 'light' ? 'rgb(255, 235, 233)' : 'rgba(248, 81, 73, 0.1)');
  }
});

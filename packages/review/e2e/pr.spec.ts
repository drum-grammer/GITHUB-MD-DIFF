// PR 모드 한 바퀴 — 네트워크 없이. 원격은 insteadOf로 가리킨 bare 저장소, gh는 PATH 앞의 가짜(e2e/fake-gh.mjs)
import { expect, test, type Page } from '@playwright/test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fakeComment, fakeGitHub, fakeThread, type FakeGitHub } from '../test/helpers/fake-github';
import { prWorld, type PrWorld } from '../test/helpers/pr-world';
import { api, cli, hoverUntilPlus, startReview, type Repo } from './support';

const OLD = '# Guide\n\n## Install\n\nInstall it.\n\n## Use\n\nUse it often.\n\n## Notes\n\nOld note.\n';
const NEW = OLD.replace('Old note.', 'New note.');
const PATCH = '@@ -10,4 +10,4 @@ Use it often.\n \n ## Notes\n \n-Old note.\n+New note.';

let world: PrWorld | undefined;
let tmp: string | undefined;
test.afterEach(() => {
  world?.cleanup();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

const fileSection = (page: Page, path: string) => page.locator('section.mdc-file', { has: page.locator('.mdc-file-head .mdc-path', { hasText: path }) });

function setup(): { repo: Repo; stateFile: string; read(): FakeGitHub } {
  world = prWorld({ base: { 'docs/guide.md': OLD }, head: { 'docs/guide.md': NEW } });
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'mdc-e2e-pr-')));
  const bin = join(tmp, 'bin');
  const stateFile = join(tmp, 'gh.json');
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), `#!/bin/sh\nexec "${process.execPath}" "${resolve('e2e/fake-gh.mjs')}" "$@"\n`);
  chmodSync(join(bin, 'gh'), 0o755);
  const gh = fakeGitHub({
    pr: { url: world.view.url, number: 7, title: 'Docs', baseRefName: 'main', baseRefOid: world.base, headRefOid: world.head },
    files: [{ filename: 'docs/guide.md', patch: PATCH }],
    threads: [
      fakeThread({ id: 'PRRT_note', path: 'docs/guide.md', line: 13, comments: { nodes: [fakeComment('octocat', 'Is this note still true?')] } }),
      fakeThread({ id: 'PRRT_file', path: 'docs/guide.md', subjectType: 'FILE', line: null, comments: { nodes: [fakeComment('me', 'Whole file looks good.')] } }),
      fakeThread({ path: 'docs/guide.md', line: 5, isOutdated: true, comments: { nodes: [fakeComment('octocat', 'old')] } }),
    ],
  });
  writeFileSync(stateFile, JSON.stringify(gh));
  const repo: Repo = {
    dir: world.clone.dir,
    state: join(tmp, 'state'),
    env: { PATH: `${bin}:${process.env.PATH}`, FAKE_GH_STATE: stateFile },
    write: (p, t) => world!.clone.write(p, t),
    move: () => {},
    git: (...a) => world!.clone.git(...a),
    cleanup: () => {},
  };
  return { repo, stateFile, read: () => JSON.parse(readFileSync(stateFile, 'utf8')) as FakeGitHub };
}

test('PR 모드 한 바퀴 — 기존 스레드·코멘트·답글·확인 상자·보류 중 리뷰·포함해 보내기', async ({ page }) => {
  const { repo, read } = setup();
  const review = await startReview(repo, '--pr', '7');
  await expect.poll(() => review.output()).toContain('Reviewing acme/docs#7 "Docs"'); // 주소 줄 다음에 나온다
  await page.goto(review.url);
  await expect(page.locator('.mdc-pr-link')).toHaveText('acme/docs#7');
  await expect(page.locator('.mdc-header .mdc-redraw')).toHaveText('Redraw');
  await expect(page.locator('.mdc-base')).toContainText('→ head ');
  await expect(page.locator('.mdc-notice')).toContainText('run gh pr checkout 7');
  const file = fileSection(page, 'docs/guide.md');
  const note = file.locator('[data-mdf="thread"]', { hasText: 'Is this note still true?' });
  await expect(note).toBeVisible();
  await expect(file.locator('[data-mdf="thread"]', { hasText: 'Whole file looks good.' })).toBeVisible();
  await expect(file.locator('.mdc-outdated')).toHaveText('1 outdated thread hidden — see it on GitHub');

  // 바뀐 문단에 코멘트(화면), 접힌 블록에 코멘트(API), 남의 스레드에 답글(화면)
  const para = file.locator('p', { hasText: 'New note.' });
  await hoverUntilPlus(file, para);
  await file.locator('[data-mdf="add-comment"]').click();
  const form = page.locator('[data-mdf="comment-form"]');
  await form.locator('textarea').fill('Say what changed.');
  await form.locator('.mdf-btn-primary', { hasText: 'Add comment' }).click();
  await expect(file.locator('[data-mdf="thread"]', { hasText: 'Say what changed.' })).toBeVisible();
  const view = await api<{ rev: string }>(page, 'GET', '/api/view');
  await api(page, 'POST', '/api/drafts', { rev: view.rev, path: 'docs/guide.md', side: 'right', start: 5, end: 5, body: '`@.env` {repo} @- stays literal' });
  await note.getByRole('button', { name: 'Reply' }).click();
  await note.locator('textarea').fill('Yes — still true.');
  await note.locator('.mdf-btn-primary', { hasText: 'Reply' }).click();
  await expect(note).toContainText('Yes — still true.');
  await page.reload();
  await expect(page.locator('.mdc-push')).toHaveText('Add to pending review (3)');

  // 확인 상자 → 넣기
  await page.locator('.mdc-push').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('h2')).toHaveText('Add 3 to your pending review on acme/docs#7?');
  await expect(dialog.locator('li')).toHaveText([
    'docs/guide.md · L13 · Say what changed.',
    'docs/guide.md · L5 · `@.env` {repo} @- stays literal → added as a whole-file comment with the quoted lines',
    'docs/guide.md · L13 · Yes — still true. → reply',
  ]);
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(page.locator('.mdc-toast')).toHaveText('Added 3 to your pending review. Submit it on GitHub');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.mdc-push')).toHaveText('Add to pending review');
  await expect(file.locator('[data-mdf="thread"]', { hasText: 'Say what changed.' }).locator('.mdf-pending')).toBeVisible();

  const gh = read();
  expect(gh.createdReviews).toBe(1);
  expect(gh.mutations.map((m) => m.input)).toEqual([
    { pullRequestReviewId: 'PRR_new', path: 'docs/guide.md', body: 'Say what changed.', subjectType: 'LINE', line: 13, side: 'RIGHT' },
    { pullRequestReviewId: 'PRR_new', path: 'docs/guide.md', body: '`L5` (unchanged lines; GitHub accepts line comments only on changed lines)\n\n```text\nInstall it.\n```\n\n`@.env` {repo} @- stays literal', subjectType: 'FILE' },
    { pullRequestReviewId: 'PRR_new', pullRequestReviewThreadId: 'PRRT_note', body: 'Yes — still true.' },
  ]);

  // 남의 스레드를 골라 에이전트에게 보내기
  const include = file.locator('[data-mdf="thread"]', { hasText: 'Is this note still true?' }).locator('input.mdc-include-box');
  await include.check();
  await expect(page.locator('.mdc-send')).toHaveText('Send to agent (1)');
  await page.locator('.mdc-send').click();
  await expect(page.locator('.mdc-toast')).toContainText('Sent round 1');
  const out = cli(repo, 'comments');
  expect(out.code).toBe(0);
  expect(out.stdout).toMatch(/· base [0-9a-f]{7} \(merge-base of acme\/docs#7\) → head [0-9a-f]{7} · review render r/);
  expect(out.stdout).toContain('author: @octocat (others)');
  expect(out.stdout).toContain('> Warning: HEAD is not the head of acme/docs#7');
  await review.stop();
});

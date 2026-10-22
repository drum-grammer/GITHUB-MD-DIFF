// PR 모드를 실제 GitHub에서 — 공개 testbed의 패리티 PR(#8)에 내 보류 중 리뷰를 만들고, 줄·파일 스레드·본문을 확인한 뒤 지운다.
// 공개 저장소에 쓰므로 MDC_PR_TESTBED=1일 때만 돈다(gh 로그인 필요). 보류 중 리뷰는 나만 보이고, 끝에 지워 아무것도 공개되지 않는다
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePatch } from '../src/hunks';
import { api, startReview, type Repo } from './support';

const OWNER = 'drum-grammer';
const NAME = 'markdown-diff-cat-testbed';
const NUMBER = 8;

test.skip(process.env.MDC_PR_TESTBED !== '1', 'writes a pending review on the public testbed — set MDC_PR_TESTBED=1 to run');

const gql = <T>(query: string, variables: Record<string, unknown> = {}): T => {
  const out = JSON.parse(execFileSync('gh', ['api', 'graphql', '--input', '-'], { input: JSON.stringify({ query, variables: { owner: OWNER, repo: NAME, number: NUMBER, ...variables } }), encoding: 'utf8' })) as { data: T };
  return out.data;
};
const myPending = (): string[] =>
  gql<{ repository: { pullRequest: { reviews: { nodes: Array<{ id: string; viewerDidAuthor: boolean }> } } } }>(
    'query($owner: String!, $repo: String!, $number: Int!) { repository(owner: $owner, name: $repo) { pullRequest(number: $number) { reviews(states: PENDING, first: 20) { nodes { id viewerDidAuthor } } } } }',
  ).repository.pullRequest.reviews.nodes.filter((r) => r.viewerDidAuthor).map((r) => r.id);

let dir: string | undefined;
let made = false;
test.beforeAll(() => {
  // 사람이 이 PR에 쓰던 보류 중 리뷰는 건드리지 않는다 — 있으면 멈춘다
  expect(myPending(), `you have a pending review on ${OWNER}/${NAME}#${NUMBER} — submit or delete it first`).toEqual([]);
});
test.afterAll(() => {
  if (made) for (const id of myPending()) gql('mutation($id: ID!) { deletePullRequestReview(input: { pullRequestReviewId: $id }) { clientMutationId } }', { id });
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test('testbed PR #8 — 보류 중 리뷰에 줄·잘린 범위·파일 스레드를 넣고 글자 그대로인지 확인', async ({ page }) => {
  test.setTimeout(180_000);
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'mdc-testbed-')));
  const clone = join(dir, 'repo');
  execFileSync('git', ['clone', '-q', `https://github.com/${OWNER}/${NAME}.git`, clone]);
  const repo: Repo = { dir: clone, state: join(dir, 'state'), write: () => {}, move: () => {}, git: (...a) => execFileSync('git', a, { cwd: clone, encoding: 'utf8' }).trim(), cleanup: () => {} };

  // GitHub가 준 hunk로 파일·줄을 고른다 — 앞에 바뀌지 않은 줄이 있는 hunk(그 hunk 안 한 줄, hunk 앞 줄까지 걸친 범위는 잘림, hunk 밖 줄은 파일 스레드)
  const files = JSON.parse(execFileSync('gh', ['api', `repos/${OWNER}/${NAME}/pulls/${NUMBER}/files?per_page=100`], { encoding: 'utf8' })) as Array<{ filename: string; patch?: string }>;
  const pick = files
    .map((f) => {
      const right = parsePatch(f.patch ?? '').map((h) => h.right).filter((r): r is [number, number] => r !== null);
      const inHunk = (n: number): boolean => right.some(([a, b]) => a <= n && n <= b);
      const first = right.find(([a]) => a > 1 && !inHunk(a - 1));
      return first ? { file: f.filename, first, inHunk } : null;
    })
    .find((x) => x !== null);
  expect(pick, 'needs a hunk with an unchanged line before it').toBeTruthy();
  const { file: FILE, first, inHunk } = pick!;
  const review = await startReview(repo, '--pr', String(NUMBER));
  await page.goto(review.url);
  const view = await api<{ rev: string; files: Array<{ path: string; newText: string }> }>(page, 'GET', '/api/view');
  const lines = view.files.find((f) => f.path === FILE)!.newText.split('\n').length;
  const outside = Array.from({ length: lines }, (_, i) => i + 1).find((n) => !inHunk(n));
  expect(outside, 'needs an unchanged line').toBeDefined();
  const add = (start: number, end: number, body: string) => api(page, 'POST', '/api/drafts', { rev: view.rev, path: FILE, side: 'right', start, end, body });
  await add(first[0], first[0], 'fits — markdown-diff-cat M4 testbed run');
  await add(first[0] - 1, first[1], 'clipped — markdown-diff-cat M4 testbed run');
  await add(outside!, outside!, 'unchanged — markdown-diff-cat M4 testbed run');
  await add(first[1], first[1], '@- {repo} `@.env` literal — markdown-diff-cat M4 testbed run'); // @로 시작해도 글자 그대로(스펙 §10). @-는 사람 이름이 아니라 알림이 가지 않는다
  await page.reload();

  await page.locator('.mdc-push').click();
  made = true;
  await page.getByRole('dialog').getByRole('button', { name: 'Add' }).click();
  await expect(page.locator('.mdc-toast')).toHaveText('Added 4 to your pending review. Submit it on GitHub', { timeout: 60_000 });

  const threads = gql<{ repository: { pullRequest: { reviewThreads: { nodes: Array<{ path: string; line: number | null; startLine: number | null; subjectType: string; comments: { nodes: Array<{ body: string; state: string }> } }> } } } }>(
    'query($owner: String!, $repo: String!, $number: Int!) { repository(owner: $owner, name: $repo) { pullRequest(number: $number) { reviewThreads(first: 100) { nodes { path line startLine subjectType comments(first: 5) { nodes { body state } } } } } } }',
  ).repository.pullRequest.reviewThreads.nodes.filter((t) => t.comments.nodes.some((c) => c.state === 'PENDING' && c.body.includes('markdown-diff-cat M4 testbed run')));
  const by = (word: string) => threads.find((t) => t.comments.nodes[0].body.includes(word))!;
  console.log(JSON.stringify(threads.map((t) => ({ path: t.path, line: t.line, startLine: t.startLine, subjectType: t.subjectType, body: t.comments.nodes[0].body }))));
  // 한 줄 스레드의 startLine은 GitHub가 null 또는 같은 줄로 돌려준다(2026-10-23 testbed 실측: 같은 줄)
  expect(by('fits')).toMatchObject({ path: FILE, subjectType: 'LINE', line: first[0] });
  expect([null, first[0]]).toContain(by('fits').startLine);
  expect(by('clipped')).toMatchObject({ subjectType: 'LINE', line: first[1], startLine: first[0] === first[1] ? null : first[0] });
  expect(by('clipped').comments.nodes[0].body).toContain(`trimmed to`);
  expect(by('unchanged')).toMatchObject({ path: FILE, subjectType: 'FILE' }); // GitHub는 파일 스레드의 line을 1로 돌려준다(2026-10-23 실측)
  expect(by('unchanged').comments.nodes[0].body).toContain('(unchanged lines; GitHub accepts line comments only on changed lines)');
  expect(by('literal').comments.nodes[0].body).toBe('@- {repo} `@.env` literal — markdown-diff-cat M4 testbed run');
  await review.stop();
});

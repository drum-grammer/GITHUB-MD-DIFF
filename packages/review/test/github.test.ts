import { describe, expect, it } from 'vitest';
import { Gh, type GhRunner } from '../src/gh';
import { addItems, currentHead, loadThreads, pendingReviewId, prFileInfos } from '../src/github';
import type { PrRef } from '../src/records';

const PR: PrRef = { owner: 'acme', repo: 'docs', number: 7, url: 'https://github.com/acme/docs/pull/7', title: 'Docs', baseOid: 'b'.repeat(40), headOid: 'h'.repeat(40), mergeBase: 'm'.repeat(40) };

interface Seen {
  args: string[];
  body: { query?: string; variables?: Record<string, unknown> } & Record<string, unknown>;
}

/** 그대로 낼 출력(--jq 줄 단위 등) */
class Raw {
  constructor(readonly text: string) {}
}

/** 요청을 보고 답을 고르는 가짜 gh — answer가 undefined를 돌려주면 시험 실패 */
function fakeGh(answer: (s: Seen) => unknown): { gh: Gh; seen: Seen[] } {
  const seen: Seen[] = [];
  const run: GhRunner = async (args, opts) => {
    const s = { args, body: opts.input ? JSON.parse(opts.input) : {} };
    seen.push(s);
    const out = answer(s);
    if (out === undefined) throw new Error(`unexpected gh call ${args.join(' ')} ${opts.input ?? ''}`);
    if (out instanceof Error) return { code: 1, stdout: '', stderr: out.message };
    if (out instanceof Raw) return { code: 0, stdout: out.text, stderr: '' };
    return { code: 0, stdout: JSON.stringify(out), stderr: '' };
  };
  return { gh: new Gh(run, '/repo'), seen };
}

const comment = (id: string, login: string | null, body: string, state = 'SUBMITTED') => ({ id, author: login ? { login } : null, body, url: `https://github.com/acme/docs/pull/7#discussion_${id}`, state });
const thread = (over: Record<string, unknown>) => ({
  id: 'T',
  path: 'docs/a.md',
  line: 5,
  startLine: null,
  diffSide: 'RIGHT',
  startDiffSide: null,
  originalLine: 5,
  originalStartLine: null,
  subjectType: 'LINE',
  isResolved: false,
  isOutdated: false,
  viewerCanReply: true,
  comments: { nodes: [comment('C1', 'octocat', 'Hmm')] },
  ...over,
});

describe('loadThreads', () => {
  it('줄·파일·왼쪽 쪽, 낡음·줄 없음은 숨기고 수만, PENDING은 pending, 다음 페이지까지', async () => {
    const pages = [
      {
        nodes: [
          thread({ id: 'T1', line: 6, startLine: 4, comments: { nodes: [comment('C1', 'octocat', '**Why?**'), comment('C2', 'me', 'Because', 'PENDING')] } }),
          // 실제 GitHub는 파일 스레드의 line을 1로 돌려준다(2026-10-23 testbed 실측) — subjectType으로 가른다
          thread({ id: 'T2', subjectType: 'FILE', line: 1, viewerCanReply: false }),
          thread({ id: 'T3', isOutdated: true }),
        ],
        pageInfo: { hasNextPage: true, endCursor: 'CUR' },
      },
      {
        nodes: [thread({ id: 'T4', path: 'docs/b.md', diffSide: 'LEFT', line: 2, isResolved: true, comments: { nodes: [comment('C4', null, 'old note')] } }), thread({ id: 'T5', line: null })],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    ];
    const { gh, seen } = fakeGh((s) => (s.body.query?.includes('reviewThreads') ? { data: { viewer: { login: 'me' }, repository: { pullRequest: { reviewThreads: pages.shift() } } } } : undefined));
    const got = await loadThreads(gh, PR, (md) => `<p>${md}</p>`);
    expect(seen.map((s) => s.body.variables)).toEqual([
      { owner: 'acme', repo: 'docs', number: 7, after: null },
      { owner: 'acme', repo: 'docs', number: 7, after: 'CUR' },
    ]);
    expect(got.viewer).toBe('me');
    expect(got.byPath.get('docs/a.md')).toEqual([
      {
        id: 'T1',
        subject: 'line',
        side: 'right',
        start: 4,
        end: 6,
        resolved: false,
        canReply: true,
        comments: [
          { id: 'C1', author: 'octocat', body: '**Why?**', bodyHTML: '<p>**Why?**</p>', url: 'https://github.com/acme/docs/pull/7#discussion_C1', pending: false, bodyVersion: '', canEdit: false, canDelete: false },
          { id: 'C2', author: 'me', body: 'Because', bodyHTML: '<p>Because</p>', url: 'https://github.com/acme/docs/pull/7#discussion_C2', pending: true, bodyVersion: '', canEdit: false, canDelete: false },
        ],
      },
      expect.objectContaining({ id: 'T2', subject: 'file', side: 'right', start: 0, end: 0, canReply: false }),
    ]);
    expect(got.byPath.get('docs/b.md')).toEqual([expect.objectContaining({ id: 'T4', side: 'left', start: 2, end: 2, resolved: true, comments: [expect.objectContaining({ author: 'ghost' })] })]);
    expect(got.hidden).toEqual(new Map([['docs/a.md', 2]]));
    expect(got.others).toEqual(new Map([['T1', 1], ['T2', 1], ['T4', 1]]));
  });
});

describe('보류 중 리뷰', () => {
  it('내 보류 중 리뷰가 있으면 그것에 — REST로 새로 만들지 않는다', async () => {
    const { gh, seen } = fakeGh((s) =>
      s.body.query?.includes('reviews(states: PENDING') ? { data: { repository: { pullRequest: { reviews: { nodes: [{ id: 'PRR_other', viewerDidAuthor: false }, { id: 'PRR_mine', viewerDidAuthor: true }] } } } } } : undefined,
    );
    expect(await pendingReviewId(gh, PR)).toBe('PRR_mine');
    expect(seen).toHaveLength(1);
  });

  it('없으면 commit_id만 담은 REST로 만들고 node_id를 쓴다', async () => {
    const { gh, seen } = fakeGh((s) => {
      if (s.body.query?.includes('reviews(states: PENDING')) return { data: { repository: { pullRequest: { reviews: { nodes: [] } } } } };
      if (s.args.includes('repos/acme/docs/pulls/7/reviews')) return { id: 1, node_id: 'PRR_new' };
      return undefined;
    });
    expect(await pendingReviewId(gh, PR)).toBe('PRR_new');
    expect(seen[1].args).toEqual(['api', '--method', 'POST', 'repos/acme/docs/pulls/7/reviews', '--input', '-']);
    expect(seen[1].body).toEqual({ commit_id: 'h'.repeat(40) });
  });

  it('currentHead·prFileInfos', async () => {
    const { gh, seen } = fakeGh((s) => {
      if (s.body.query?.includes('headRefOid')) return { data: { repository: { pullRequest: { headRefOid: 'n'.repeat(40) } } } };
      if (s.args.includes('repos/acme/docs/pulls/7/files?per_page=100')) return new Raw('{"filename":"docs/a.md","patch":"@@ -1 +1 @@"}\n{"filename":"docs/big.md"}\n');
      return undefined;
    });
    expect(await currentHead(gh, PR)).toBe('n'.repeat(40));
    expect(await prFileInfos(gh, PR)).toEqual(
      new Map([
        ['docs/a.md', { path: 'docs/a.md', patch: '@@ -1 +1 @@' }],
        ['docs/big.md', { path: 'docs/big.md', patch: null }],
      ]),
    );
    expect(seen[1].args).toContain('--paginate');
  });
});

describe('addItems', () => {
  it('한 줄이면 startLine 없음, 범위면 startLine·startSide, 파일·답글, 실패한 것만 오류로 남기고 계속', async () => {
    const { gh, seen } = fakeGh((s) => {
      const input = s.body.variables?.input as Record<string, unknown> | undefined;
      if (input?.body === 'bad') return new Error('gh: pull_request_review_thread.line must be part of the diff');
      if (s.body.query?.includes('addPullRequestReviewThreadReply(')) return { data: { addPullRequestReviewThreadReply: { comment: { id: 'C9' } } } };
      if (s.body.query?.includes('addPullRequestReviewThread(')) return { data: { addPullRequestReviewThread: { thread: input?.body === 'null' ? null : { id: 'T9' } } } };
      return undefined;
    });
    const result = await addItems(gh, 'PRR_1', [
      { draft: 'd1', kind: 'line', path: 'docs/a.md', side: 'RIGHT', start: 3, end: 3, body: 'one' },
      { draft: 'd2', kind: 'line', path: 'docs/a.md', side: 'LEFT', start: 2, end: 4, body: 'bad' },
      { draft: 'd3', kind: 'file', path: 'docs/a.md', body: 'file' },
      { draft: 'd4', kind: 'reply', thread: 'PRRT_x', body: 'reply' },
      { draft: 'd5', kind: 'error', error: 'not in the PR' },
      { draft: 'd6', kind: 'line', path: 'docs/a.md', side: 'RIGHT', start: 1, end: 2, body: 'null' },
    ]);
    expect(result).toEqual([
      { draft: 'd1' },
      { draft: 'd2', error: 'gh api: gh: pull_request_review_thread.line must be part of the diff' },
      { draft: 'd3' },
      { draft: 'd4' },
      { draft: 'd5', error: 'not in the PR' },
      { draft: 'd6', error: 'GitHub did not add the comment' },
    ]);
    expect(seen.map((s) => s.body.variables?.input)).toEqual([
      { pullRequestReviewId: 'PRR_1', path: 'docs/a.md', body: 'one', subjectType: 'LINE', line: 3, side: 'RIGHT' },
      { pullRequestReviewId: 'PRR_1', path: 'docs/a.md', body: 'bad', subjectType: 'LINE', line: 4, side: 'LEFT', startLine: 2, startSide: 'LEFT' },
      { pullRequestReviewId: 'PRR_1', path: 'docs/a.md', body: 'file', subjectType: 'FILE' },
      { pullRequestReviewId: 'PRR_1', pullRequestReviewThreadId: 'PRRT_x', body: 'reply' },
      { pullRequestReviewId: 'PRR_1', path: 'docs/a.md', body: 'null', subjectType: 'LINE', line: 2, side: 'RIGHT', startLine: 1, startSide: 'RIGHT' },
    ]);
  });
});

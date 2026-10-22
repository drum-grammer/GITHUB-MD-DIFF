// 상태를 가진 가짜 GitHub(gh) — PR 하나의 스레드·파일 patch·보류 중 리뷰. 넣은 스레드·답글은 다음 읽기에 PENDING으로 나온다
import type { GhRunner } from '../../src/gh';

export interface FakeComment {
  id: string;
  author: { login: string } | null;
  body: string;
  url: string;
  state: string;
}

export interface FakeThread {
  id: string;
  path: string;
  line: number | null;
  startLine: number | null;
  diffSide: 'LEFT' | 'RIGHT';
  startDiffSide: 'LEFT' | 'RIGHT' | null;
  originalLine: number | null;
  originalStartLine: number | null;
  subjectType: 'LINE' | 'FILE';
  isResolved: boolean;
  isOutdated: boolean;
  viewerCanReply: boolean;
  comments: { nodes: FakeComment[] };
}

export interface FakeGitHub {
  viewer: string;
  /** gh pr view가 내는 값 */
  pr: { url: string; number: number; title: string; baseRefName: string; baseRefOid: string; headRefOid: string };
  /** GraphQL headRefOid(넣기 직전 다시 읽는 값) — 기본은 pr.headRefOid */
  head?: string;
  threads: FakeThread[];
  files: Array<{ filename: string; patch?: string }>;
  pendingReviewId: string | null;
  /** 받은 변경 요청(input 그대로) */
  mutations: Array<{ name: string; input: Record<string, unknown> }>;
  /** REST로 리뷰를 만든 횟수 */
  createdReviews: number;
  /** 로그인 안 함·gh 없음 흉내 */
  auth?: 'ok' | 'logged-out' | 'missing';
  calls: string[][];
}

export function fakeGitHub(over: Partial<FakeGitHub> & Pick<FakeGitHub, 'pr'>): FakeGitHub {
  return { viewer: 'me', threads: [], files: [], pendingReviewId: null, mutations: [], createdReviews: 0, calls: [], ...over };
}

/** 프로세스마다 다시 시작해도(E2E의 gh 실행마다) 겹치지 않는 id */
const uid = (): string => Math.random().toString(36).slice(2, 12);
export const fakeThread = (over: Partial<FakeThread> & { comments?: { nodes: FakeComment[] } }): FakeThread => ({
  id: `PRRT_${uid()}`,
  path: 'docs/a.md',
  line: 3,
  startLine: null,
  diffSide: 'RIGHT',
  startDiffSide: null,
  originalLine: 3,
  originalStartLine: null,
  subjectType: 'LINE',
  isResolved: false,
  isOutdated: false,
  viewerCanReply: true,
  comments: { nodes: [] },
  ...over,
});
export const fakeComment = (login: string, body: string, state = 'SUBMITTED'): FakeComment => {
  const id = uid();
  return { id: `PRRC_${id}`, author: { login }, body, url: `https://github.com/acme/docs/pull/7#discussion_${id}`, state };
};

const ok = (data: unknown) => ({ code: 0, stdout: JSON.stringify(data), stderr: '' });

export function fakeRunner(gh: FakeGitHub): GhRunner {
  return async (args, opts) => {
    gh.calls.push(args);
    if (gh.auth === 'missing') return { code: 127, stdout: '', stderr: '' };
    if (args[0] === 'auth') return gh.auth === 'logged-out' ? { code: 1, stdout: '', stderr: 'You are not logged into any GitHub hosts. To log in, run: gh auth login\n' } : ok({});
    if (args[0] === 'pr' && args[1] === 'view') return ok(gh.pr);
    if (args[0] === 'api' && args[1] === 'graphql') {
      const { query, variables } = JSON.parse(opts.input ?? '{}') as { query: string; variables: Record<string, unknown> };
      if (query.includes('reviewThreads')) return ok({ data: { viewer: { login: gh.viewer }, repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: gh.threads } } } } });
      if (query.includes('reviews(states: PENDING')) return ok({ data: { repository: { pullRequest: { reviews: { nodes: gh.pendingReviewId ? [{ id: gh.pendingReviewId, viewerDidAuthor: true }] : [] } } } } });
      if (query.includes('headRefOid')) return ok({ data: { repository: { pullRequest: { headRefOid: gh.head ?? gh.pr.headRefOid } } } });
      const input = variables.input as Record<string, unknown>;
      if (query.includes('addPullRequestReviewThreadReply(')) {
        gh.mutations.push({ name: 'addPullRequestReviewThreadReply', input });
        const t = gh.threads.find((x) => x.id === input.pullRequestReviewThreadId);
        if (!t) return { code: 1, stdout: '', stderr: 'gh: Could not resolve to a node' };
        const c = fakeComment(gh.viewer, String(input.body), 'PENDING');
        t.comments.nodes.push(c);
        return ok({ data: { addPullRequestReviewThreadReply: { comment: { id: c.id } } } });
      }
      if (query.includes('addPullRequestReviewThread(')) {
        gh.mutations.push({ name: 'addPullRequestReviewThread', input });
        const file = input.subjectType === 'FILE';
        const t = fakeThread({
          path: String(input.path),
          subjectType: file ? 'FILE' : 'LINE',
          line: file ? null : Number(input.line),
          startLine: input.startLine === undefined ? null : Number(input.startLine),
          diffSide: (input.side as 'LEFT' | 'RIGHT') ?? 'RIGHT',
          comments: { nodes: [fakeComment(gh.viewer, String(input.body), 'PENDING')] },
        });
        gh.threads.push(t);
        return ok({ data: { addPullRequestReviewThread: { thread: { id: t.id } } } });
      }
      return { code: 1, stdout: '', stderr: `fake gh: unknown query ${query.slice(0, 60)}` };
    }
    // --paginate --jq '.[]' — 한 줄에 하나
    if (args[0] === 'api' && args[2] === 'GET' && /pulls\/\d+\/files/.test(args[3])) return { code: 0, stdout: gh.files.map((f) => `${JSON.stringify(f)}\n`).join(''), stderr: '' };
    if (args[0] === 'api' && args[2] === 'POST' && /pulls\/\d+\/reviews$/.test(args[3])) {
      gh.createdReviews++;
      gh.pendingReviewId = 'PRR_new';
      return ok({ id: 1, node_id: 'PRR_new' });
    }
    return { code: 1, stdout: '', stderr: `fake gh: unknown call ${args.join(' ')}` };
  };
}

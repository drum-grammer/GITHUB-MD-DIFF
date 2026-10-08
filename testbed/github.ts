// gh CLI로 GitHub를 읽고 쓴다 — 설정 스크립트와 시나리오 테스트가 같이 쓴다. 로그인은 `gh auth login`의 것을 쓴다(토큰을 다루지 않는다)
import { execFileSync } from 'node:child_process';

export interface ReviewComment {
  id: number;
  node_id: string;
  body: string;
  path: string;
  line: number | null;
  start_line: number | null;
  side: 'LEFT' | 'RIGHT';
  start_side: 'LEFT' | 'RIGHT' | null;
  in_reply_to_id?: number;
  pull_request_review_id: number;
  user: { login: string };
}

export interface Review {
  id: number;
  state: string;
  user: { login: string };
}

export interface Thread {
  id: string;
  isResolved: boolean;
  firstCommentId: number;
  comments: number;
}

export function gh(args: string[], input?: string): string {
  return execFileSync('gh', args, { encoding: 'utf8', input, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], maxBuffer: 64 << 20 });
}

/** REST 호출. body가 있으면 JSON으로 보낸다 */
export function api<T = unknown>(path: string, method = 'GET', body?: unknown): T {
  const args = ['api', '-X', method, path, '-H', 'Accept: application/vnd.github+json'];
  const out = body === undefined ? gh(args) : gh([...args, '--input', '-'], JSON.stringify(body));
  return (out.trim() ? JSON.parse(out) : null) as T;
}

/** 여러 쪽짜리 목록(per_page=100) */
export function list<T>(path: string): T[] {
  const sep = path.includes('?') ? '&' : '?';
  const out = gh(['api', '--paginate', '--slurp', `${path}${sep}per_page=100`]);
  return (JSON.parse(out) as T[][]).flat();
}

export function graphql<T = unknown>(query: string, vars: Record<string, string | number>): T {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [k, v] of Object.entries(vars)) args.push(typeof v === 'number' ? '-F' : '-f', `${k}=${v}`);
  return JSON.parse(gh(args)).data as T;
}

export function me(): string {
  return gh(['api', 'user', '--jq', '.login']).trim();
}

export function comments(repo: string, pr: number): ReviewComment[] {
  return list<ReviewComment>(`repos/${repo}/pulls/${pr}/comments`);
}

export function reviews(repo: string, pr: number): Review[] {
  return list<Review>(`repos/${repo}/pulls/${pr}/reviews`);
}

/** 이 PR의 리뷰 스레드(해결 여부·첫 코멘트) */
export function threads(repo: string, pr: number): Thread[] {
  const [owner, name] = repo.split('/');
  const data = graphql<{
    repository: { pullRequest: { reviewThreads: { nodes: Array<{ id: string; isResolved: boolean; comments: { totalCount: number; nodes: Array<{ databaseId: number }> } }> } } };
  }>(
    `query($owner:String!,$name:String!,$pr:Int!){repository(owner:$owner,name:$name){pullRequest(number:$pr){reviewThreads(first:100){nodes{id isResolved comments(first:1){totalCount nodes{databaseId}}}}}}}`,
    { owner, name, pr },
  );
  return data.repository.pullRequest.reviewThreads.nodes.map((n) => ({
    id: n.id,
    isResolved: n.isResolved,
    firstCommentId: n.comments.nodes[0]?.databaseId ?? 0,
    comments: n.comments.totalCount,
  }));
}

export interface ThreadAt {
  path: string;
  side: 'LEFT' | 'RIGHT';
  line: number | null;
  startLine: number | null;
  pending: boolean;
}

/**
 * 본문에 `text`가 든 코멘트의 스레드 자리 — 보류 중인 리뷰의 코멘트도 찾는다
 * (REST의 리뷰 코멘트 목록은 보류 중인 코멘트에 줄·쪽을 주지 않아 GraphQL로 읽는다)
 */
export function threadAt(repo: string, pr: number, text: string): ThreadAt | null {
  const [owner, name] = repo.split('/');
  const data = graphql<{
    repository: {
      pullRequest: {
        reviewThreads: {
          nodes: Array<{
            path: string;
            diffSide: 'LEFT' | 'RIGHT';
            line: number | null;
            originalLine: number | null;
            startLine: number | null;
            originalStartLine: number | null;
            comments: { nodes: Array<{ body: string; state: string }> };
          }>;
        };
      };
    };
  }>(
    `query($owner:String!,$name:String!,$pr:Int!){repository(owner:$owner,name:$name){pullRequest(number:$pr){reviewThreads(first:100){nodes{path diffSide line originalLine startLine originalStartLine comments(first:20){nodes{body state}}}}}}}`,
    { owner, name, pr },
  );
  for (const t of data.repository.pullRequest.reviewThreads.nodes) {
    const c = t.comments.nodes.find((x) => x.body.includes(text));
    if (c) {
      const line = t.line ?? t.originalLine;
      const start = t.startLine ?? t.originalStartLine;
      // 한 줄 코멘트도 GraphQL은 startLine을 같은 줄로 줄 때가 있다(REST는 null) — 같으면 한 줄로 본다
      return { path: t.path, side: t.diffSide, line, startLine: start === line ? null : start, pending: c.state === 'PENDING' };
    }
  }
  return null;
}

export function setResolved(threadId: string, resolved: boolean): void {
  const m = resolved ? 'resolveReviewThread' : 'unresolveReviewThread';
  graphql(`mutation($id:ID!){${m}(input:{threadId:$id}){thread{id}}}`, { id: threadId });
}

/**
 * 테스트가 남긴 것을 걷는다 — 내 보류 중인 리뷰(그 안의 코멘트째)와 본문에 `marker`가 든 코멘트.
 * 지운 개수를 돌려준다.
 */
export function cleanRuns(repo: string, pr: number, marker: string, login = me()): number {
  let n = 0;
  for (const r of reviews(repo, pr)) {
    if (r.state === 'PENDING' && r.user.login === login) {
      api(`repos/${repo}/pulls/${pr}/reviews/${r.id}`, 'DELETE');
      n++;
    }
  }
  // 답글을 먼저 지운다(스레드 첫 코멘트를 먼저 지우면 답글이 남는 일이 있다)
  const runs = comments(repo, pr)
    .filter((c) => c.body.includes(marker))
    .sort((a, b) => Number(Boolean(b.in_reply_to_id)) - Number(Boolean(a.in_reply_to_id)));
  for (const c of runs) {
    try {
      api(`repos/${repo}/pulls/comments/${c.id}`, 'DELETE');
      n++;
    } catch {
      // 보류 중인 리뷰를 지울 때 같이 지워졌다
    }
  }
  return n;
}

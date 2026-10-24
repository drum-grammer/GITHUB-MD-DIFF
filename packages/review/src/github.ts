// PR 모드의 GitHub 요청(스펙 §6-2·§6-3) — 스레드 읽기, 내 보류 중 리뷰 찾기·만들기, 코멘트를 하나씩 넣기. 모두 gh(Gh)를 거친다
import type { ReviewComment, ReviewThread } from '../../../src/types';
import { repoPath, type Gh } from './gh';
import type { PrFileInfo, UploadItem } from './hunks';
import type { PrRef } from './records';

export interface PrThreads {
  viewer: string;
  /** 경로 → 보이는 스레드 */
  byPath: Map<string, ReviewThread[]>;
  /** 경로 → 숨긴 낡은(outdated)·줄 없는 스레드 수 */
  hidden: Map<string, number>;
  /** 보이는 스레드 id → 남(viewer가 아닌 사람)의 코멘트 수 */
  others: Map<string, number>;
}

interface ThreadNode {
  id: string;
  path: string;
  line: number | null;
  startLine: number | null;
  diffSide: 'LEFT' | 'RIGHT';
  startDiffSide: 'LEFT' | 'RIGHT' | null;
  subjectType: 'LINE' | 'FILE';
  isResolved: boolean;
  isOutdated: boolean;
  viewerCanReply: boolean;
  comments: { nodes: Array<{ id: string; author: { login: string } | null; body: string; url: string; state: string }> };
}

const vars = (pr: PrRef) => ({ owner: pr.owner, repo: pr.repo, number: pr.number });

const THREADS = `query($owner: String!, $repo: String!, $number: Int!, $after: String) {
  viewer { login }
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id path line startLine diffSide startDiffSide originalLine originalStartLine subjectType isResolved isOutdated viewerCanReply
          comments(first: 100) { nodes { id author { login } body url state } }
        }
      }
    }
  }
}`;

/** 모든 스레드(페이지 끝까지). 코멘트 본문은 html(로컬 엔진·정화)로 그린다. 해결·편집·삭제는 GitHub 화면에서 — 여기서는 답글만(스펙 §6-2) */
export async function loadThreads(gh: Gh, pr: PrRef, html: (markdown: string) => string): Promise<PrThreads> {
  const out: PrThreads = { viewer: '', byPath: new Map(), hidden: new Map(), others: new Map() };
  let after: string | null = null;
  for (;;) {
    const data: { viewer: { login: string }; repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ThreadNode[] } } } } = await gh.graphql(THREADS, { ...vars(pr), after });
    out.viewer = data.viewer.login;
    const page = data.repository.pullRequest.reviewThreads;
    for (const n of page.nodes) {
      const file = n.subjectType === 'FILE';
      if (n.isOutdated || (!file && n.line === null)) {
        out.hidden.set(n.path, (out.hidden.get(n.path) ?? 0) + 1);
        continue;
      }
      const comments: ReviewComment[] = n.comments.nodes.map((c) => ({
        id: c.id,
        author: c.author?.login ?? 'ghost',
        body: c.body,
        bodyHTML: html(c.body),
        url: c.url,
        pending: c.state === 'PENDING',
        bodyVersion: '',
        canEdit: false,
        canDelete: false,
      }));
      const thread: ReviewThread = file
        ? { id: n.id, subject: 'file', side: 'right', start: 0, end: 0, resolved: n.isResolved, canReply: n.viewerCanReply, comments }
        : // 옛 쪽에서 새 쪽으로 걸친 스레드는 한 쪽 줄 범위로 못 나타낸다 — 끝 줄(diffSide 쪽)에만 둔다
          { id: n.id, subject: 'line', side: n.diffSide === 'LEFT' ? 'left' : 'right', start: n.startDiffSide && n.startDiffSide !== n.diffSide ? n.line! : (n.startLine ?? n.line!), end: n.line!, resolved: n.isResolved, canReply: n.viewerCanReply, comments };
      out.byPath.set(n.path, [...(out.byPath.get(n.path) ?? []), thread]);
      const others = comments.filter((c) => c.author !== out.viewer).length;
      if (others) out.others.set(n.id, others);
    }
    if (!page.pageInfo.hasNextPage) return out;
    after = page.pageInfo.endCursor;
  }
}

/** GitHub가 준 파일 목록과 patch(hunk) — patch가 없으면 diff를 주지 않은 큰 파일 */
export async function prFileInfos(gh: Gh, pr: PrRef): Promise<Map<string, PrFileInfo>> {
  const files = await gh.rest<Array<{ filename: string; patch?: string; previous_filename?: string }>>('GET', repoPath(pr.owner, pr.repo, `pulls/${pr.number}/files?per_page=100`), undefined, { paginate: true });
  return new Map(files.map((f) => [f.filename, { path: f.filename, patch: f.patch ?? null, ...(f.previous_filename ? { previous: f.previous_filename } : {}) }]));
}

/** 지금 PR head — 넣기 직전에 다시 읽어 그린 뒤 새 커밋이 왔는지 본다 */
export async function currentHead(gh: Gh, pr: PrRef): Promise<string> {
  const data = await gh.graphql<{ repository: { pullRequest: { headRefOid: string } } }>(
    'query($owner: String!, $repo: String!, $number: Int!) { repository(owner: $owner, name: $repo) { pullRequest(number: $number) { headRefOid } } }',
    vars(pr),
  );
  return data.repository.pullRequest.headRefOid;
}

/**
 * 내 보류 중 리뷰 — 있으면 그것(사용자당 PR마다 하나라는 보고가 있어 늘 먼저 본다, ⚠️), 없으면 event·comments 없이 REST로 만든다(PENDING).
 * REST 리뷰의 comments[]에는 subject_type이 없어 파일 스레드를 못 넣으므로 코멘트는 모두 GraphQL로 더한다
 */
export async function pendingReviewId(gh: Gh, pr: PrRef): Promise<string> {
  const data = await gh.graphql<{ repository: { pullRequest: { reviews: { nodes: Array<{ id: string; viewerDidAuthor: boolean }> } } } }>(
    'query($owner: String!, $repo: String!, $number: Int!) { repository(owner: $owner, name: $repo) { pullRequest(number: $number) { reviews(states: PENDING, first: 20) { nodes { id viewerDidAuthor } } } } }',
    vars(pr),
  );
  const mine = data.repository.pullRequest.reviews.nodes.find((r) => r.viewerDidAuthor);
  if (mine) return mine.id;
  const created = await gh.rest<{ node_id: string }>('POST', repoPath(pr.owner, pr.repo, `pulls/${pr.number}/reviews`), { commit_id: pr.headOid });
  return created.node_id;
}

const ADD_THREAD = 'mutation($input: AddPullRequestReviewThreadInput!) { addPullRequestReviewThread(input: $input) { thread { id } } }';
const ADD_REPLY = 'mutation($input: AddPullRequestReviewThreadReplyInput!) { addPullRequestReviewThreadReply(input: $input) { comment { id } } }';

/** 하나씩 넣는다 — 실패해도 다음 것을 계속하고, 실패한 것만 오류로 돌려준다 */
export async function addItems(gh: Gh, reviewId: string, items: UploadItem[]): Promise<Array<{ draft: string; error?: string }>> {
  const out: Array<{ draft: string; error?: string }> = [];
  for (const item of items) {
    if (item.kind === 'error') {
      out.push({ draft: item.draft, error: item.error });
      continue;
    }
    try {
      let added: unknown;
      if (item.kind === 'reply') {
        const d = await gh.graphql<{ addPullRequestReviewThreadReply: { comment: { id: string } | null } }>(ADD_REPLY, {
          input: { pullRequestReviewId: reviewId, pullRequestReviewThreadId: item.thread, body: item.body },
        });
        added = d.addPullRequestReviewThreadReply?.comment;
      } else {
        const input =
          item.kind === 'file'
            ? { pullRequestReviewId: reviewId, path: item.path, body: item.body, subjectType: 'FILE' }
            : {
                pullRequestReviewId: reviewId,
                path: item.path,
                body: item.body,
                subjectType: 'LINE',
                line: item.end,
                side: item.side,
                ...(item.start !== item.end ? { startLine: item.start, startSide: item.side } : {}),
              };
        const d = await gh.graphql<{ addPullRequestReviewThread: { thread: { id: string } | null } }>(ADD_THREAD, { input });
        added = d.addPullRequestReviewThread?.thread;
      }
      out.push(added ? { draft: item.draft } : { draft: item.draft, error: 'GitHub did not add the comment' });
    } catch (e) {
      out.push({ draft: item.draft, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

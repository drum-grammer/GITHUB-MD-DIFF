/**
 * GitHub 화면 뒤 요청에 대한 가정은 전부 여기에 둔다 — 새 "Files changed" 화면이 쓰는 내부 요청, 2026-10-08 확인.
 * 공식 API가 아니라 바뀔 수 있다. 로그인 세션(쿠키)으로 github.com에만 보내고 토큰은 쓰지 않는다.
 * 요청 모양은 Markdown PR(chienyuanchang/rich-diff-comments)과 Mihiraki(KinjiKawaguchi/mihiraki)가 정리한 것을 참고했다.
 */

const HEADERS = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'GitHub-Verified-Fetch': 'true' };
const TIMEOUT_MS = 20_000;
const PR_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/;
const LINE_KEY = /^([LR])(\d+)$/;

export interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

/** left = 원래 파일(지운 쪽), right = 새 파일 */
export type Side = 'left' | 'right';

export interface ReviewComment {
  id: string;
  author: string;
  body: string;
  bodyHTML: string;
  url: string;
  pending: boolean;
}

export interface ReviewThread {
  id: string;
  side: Side;
  /** 1부터, 끝 포함 */
  start: number;
  end: number;
  resolved: boolean;
  canReply: boolean;
  comments: ReviewComment[];
}

export interface FileInfo {
  path: string;
  /** 이름이 바뀐 파일의 옛 경로. 모르면 null */
  oldPath: string | null;
  changeType: string;
  threads: ReviewThread[];
}

export interface PrData {
  baseOid: string;
  headOid: string;
  pendingReviewId: string | null;
  files: Map<string, FileInfo>;
}

export interface CommentTarget {
  path: string;
  side: Side;
  start: number;
  end: number;
}

/** single = 바로 올리기, review = 보류 중인 리뷰에 넣기(없으면 리뷰 시작) */
export type PostMode = 'single' | 'review';

export class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }

  /** 그 줄에 코멘트를 받지 않는다는 GitHub 응답 */
  get lineNotResolved(): boolean {
    return this.status === 422 && /line could not be resolved/i.test(this.message);
  }
}

type Json = Record<string, unknown>;
const rec = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null);

export function prRef(url: string): PrRef | null {
  try {
    const m = new URL(url).pathname.match(PR_PATH);
    return m ? { owner: m[1], repo: m[2], number: Number(m[3]) } : null;
  } catch {
    return null;
  }
}

/** 커밋 일부만 보는 화면(`/changes/<sha>`·`/files/<범위>`)인가 — 그때 줄 번호는 PR 전체 기준이 아니라 코멘트를 막는다 */
export function isCommitRangeView(url: string): boolean {
  try {
    return /^\/[^/]+\/[^/]+\/pull\/\d+\/(?:changes|files)\/[^/]/.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

export const prKey = (pr: PrRef): string => `${pr.owner}/${pr.repo}#${pr.number}`;
const prUrl = (pr: PrRef, rest: string): string => `/${pr.owner}/${pr.repo}/pull/${pr.number}/${rest}`;
const encodePath = (path: string): string => path.split('/').map(encodeURIComponent).join('/');

async function request(url: string, init: { method?: string; body?: unknown } = {}): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const hasBody = init.body !== undefined;
    const res = await fetch(url, {
      method: init.method ?? 'GET',
      credentials: 'include',
      headers: hasBody ? { ...HEADERS, 'Content-Type': 'application/json' } : HEADERS,
      body: hasBody ? JSON.stringify(init.body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // 로그인 화면처럼 JSON이 아닌 응답
    }
    if (!res.ok) {
      const j = rec(json);
      throw new RequestError(res.status, str(j?.message) ?? str(j?.error) ?? `HTTP ${res.status}`);
    }
    if (json === null && text) throw new RequestError(res.status, 'unexpected response');
    return json;
  } finally {
    clearTimeout(timer);
  }
}

function lineKey(key: string | null): { side: Side; line: number } | null {
  const m = key?.match(LINE_KEY);
  return m ? { side: m[1] === 'L' ? 'left' : 'right', line: Number(m[2]) } : null;
}

function toComment(raw: unknown): ReviewComment | null {
  const c = rec(raw);
  const id = str(c?.databaseId) ?? str(c?.id);
  if (!c || !id) return null;
  return {
    id,
    author: str(rec(c.author)?.login) ?? '',
    body: str(c.body) ?? '',
    bodyHTML: str(c.bodyHTML) ?? '',
    url: str(c.url) ?? '',
    pending: c.state === 'pending',
  };
}

/**
 * `GET /pull/:n/changes`(JSON)을 읽는다. 스레드 위치는 파일 요약의 `markersMap` 키에만 있다 —
 * `R12`는 새 파일 12번째 줄, `L4`는 원래 파일 4번째 줄. 범위 코멘트는 끝 줄이 키이고 `start`에 첫 줄이 있다.
 */
export function parsePrData(json: unknown): PrData {
  const route = rec(rec(rec(json)?.payload)?.pullRequestsChangesRoute);
  const full = rec(rec(route?.comparison)?.fullDiff);
  const baseOid = str(full?.baseOid);
  const headOid = str(full?.headOid);
  if (!route || !baseOid || !headOid) throw new RequestError(0, 'unexpected route data');
  const threadData = rec(rec(route.markers)?.threads) ?? {};
  const oldPaths = new Map<string, string>();
  for (const c of arr(route.diffContents)) {
    const path = str(rec(c)?.path);
    const old = str(rec(rec(c)?.oldTreeEntry)?.path);
    if (path && old) oldPaths.set(path, old);
  }
  const files = new Map<string, FileInfo>();
  for (const s of arr(route.diffSummaries)) {
    const sum = rec(s);
    const path = str(sum?.path);
    if (!sum || !path) continue;
    const threads: ReviewThread[] = [];
    for (const [key, marker] of Object.entries(rec(sum.markersMap) ?? {})) {
      const end = lineKey(key);
      if (!end) continue;
      for (const ref of arr(rec(marker)?.threads)) {
        const id = str(rec(ref)?.id);
        const t = rec(id ? threadData[id] : null);
        if (!id || !t || t.subjectType === 'FILE') continue;
        const start = lineKey(str(rec(ref)?.start));
        const comments = arr(rec(t.commentsData)?.comments).flatMap((c) => toComment(c) ?? []);
        if (comments.length === 0) continue;
        threads.push({
          id: str(t.id) ?? id,
          side: end.side,
          start: start && start.side === end.side && start.line <= end.line ? start.line : end.line,
          end: end.line,
          resolved: t.isResolved === true,
          canReply: t.viewerCanReply !== false,
          comments,
        });
      }
    }
    threads.sort((a, b) => a.end - b.end);
    files.set(path, { path, oldPath: oldPaths.get(path) ?? null, changeType: str(sum.changeType) ?? 'MODIFIED', threads });
  }
  return { baseOid, headOid, pendingReviewId: str(rec(route.viewerPendingReview)?.id), files };
}

export async function fetchPrData(pr: PrRef): Promise<PrData> {
  return parsePrData(await request(prUrl(pr, 'changes')));
}

/** JSON 안 어딘가의 `rawLines`(문자열 배열) — 응답 모양이 바뀌어도 찾도록 깊이 6까지 훑는다 */
export function findRawLines(v: unknown, depth = 0): string[] | null {
  if (depth > 6 || !v || typeof v !== 'object') return null;
  const r = rec(v);
  const lines = r?.rawLines;
  if (Array.isArray(lines) && lines.every((l) => typeof l === 'string')) return lines as string[];
  for (const child of Array.isArray(v) ? v : Object.values(v)) {
    const found = findRawLines(child, depth + 1);
    if (found) return found;
  }
  return null;
}

/** 커밋 하나의 파일 원문. GitHub 파일 보기가 쓰는 `_styled` JSON을 먼저, 안 되면 `raw`를 쓴다 */
export async function fetchFileText(pr: PrRef, oid: string, path: string): Promise<string> {
  const at = `${oid}/${encodePath(path)}`;
  try {
    const lines = findRawLines(await request(`/${pr.owner}/${pr.repo}/_styled/${at}`));
    if (lines) return lines.join('\n');
  } catch {
    // 아래 raw로 다시
  }
  const res = await fetch(`/${pr.owner}/${pr.repo}/raw/${at}`);
  if (!res.ok) throw new RequestError(res.status, `HTTP ${res.status}`);
  return res.text();
}

export function commentPayload(t: CommentTarget, text: string, mode: PostMode, d: Pick<PrData, 'baseOid' | 'headOid'>): Json {
  const sideOid = t.side === 'left' ? d.baseOid : d.headOid;
  const common = {
    comparisonStartOid: d.baseOid,
    comparisonEndOid: d.headOid,
    path: t.path,
    line: t.end,
    side: t.side,
    submitBatch: mode === 'single',
    text,
  };
  const ids = { baseCommitOid: d.baseOid, headCommitOid: d.headOid };
  if (t.start >= t.end) {
    return { ...common, subjectType: 'line', positioning: { type: 'line', ...ids, commitOid: sideOid, line: t.end, path: t.path } };
  }
  return {
    ...common,
    startLine: t.start,
    startSide: t.side,
    subjectType: 'multiline',
    positioning: {
      type: 'multiline',
      ...ids,
      startPath: t.path,
      startLine: t.start,
      startCommitOid: sideOid,
      endPath: t.path,
      endLine: t.end,
      endCommitOid: sideOid,
    },
  };
}

export function replyPayload(thread: ReviewThread, path: string, text: string, mode: PostMode, d: Pick<PrData, 'baseOid' | 'headOid'>): Json {
  return {
    text,
    submitBatch: mode === 'single',
    inReplyTo: Number(thread.comments[0].id),
    path,
    comparisonStartOid: d.baseOid,
    comparisonEndOid: d.headOid,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 코멘트·답글을 올린다. GitHub 화면도 가끔 422를 받으므로, 줄 문제가 아닌 422는 한 번 더 보낸다 */
export async function postComment(pr: PrRef, payload: Json): Promise<void> {
  const url = prUrl(pr, 'page_data/create_review_comment');
  try {
    await request(url, { method: 'POST', body: payload });
  } catch (e) {
    if (!(e instanceof RequestError) || e.status !== 422 || e.lineNotResolved) throw e;
    await sleep(400);
    await request(url, { method: 'POST', body: payload });
  }
}

export async function setThreadResolved(pr: PrRef, threadId: string, resolved: boolean): Promise<void> {
  await request(prUrl(pr, resolved ? 'page_data/resolve_thread' : 'page_data/unresolve_thread'), {
    method: 'POST',
    body: { threadId },
  });
}

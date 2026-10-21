/**
 * 렌더링 보기에서 코멘트 달기 — 블록에 마우스를 올리면 "+"가 나오고, 누르거나 다른 블록까지 끌면 그 원문 줄에 코멘트를 단다.
 * 이미 달린 스레드도 블록 아래에 보여 주고 답글·해결을 할 수 있다. 원문은 처음 필요할 때만 받는다.
 */
import { CommentController, type CommentBackend, type CommentState } from './comment-controller';
import {
  REMOVED_CHANGE,
  RequestError,
  commentPayload,
  deleteComment,
  isCommitRangeView,
  isGitHubChange,
  postComment,
  prKey,
  previewMarkdown,
  prRef,
  replyPayload,
  setThreadResolved,
  updateComment,
  type PrData,
  type PrRef,
} from './github-api';
import { domBlocks, mapBlocks, mappingFromAttributes, type BlockTarget } from './dom-blocks';
import { loadPr, loadText } from './pr-cache';
import { NOTICE, noticeBox } from './comment-ui';
import { t } from './i18n';
import { HEAD_ATTR, LOCAL_ATTR, MDF_ATTR, viewButton } from './selectors';
import { sourceBlocks } from './source-blocks';
import type { PostMode, ReviewComment, ReviewThread } from './types';

const LOG = '[github-md-diff]';
/** 화면 동작(comment-controller.ts)이 정한다 — 예전처럼 여기서도 가져올 수 있게 다시 내보낸다 */
export { HOST_ATTR } from './comment-controller';
/** 잠깐의 실패(네트워크·5xx) 뒤 다시 시도하는 간격 */
export const RETRY_MS = 60_000;

/**
 * 코멘트 기능 상태 — PR마다. GitHub 내부 요청이 바뀐 것으로 보이면 `broken`이 되어 코멘트를 끄고,
 * 스레드가 있는 파일은 예전처럼 원문 보기로 두며, 툴바 아이콘에 "!"로 알린다(content.ts). 접기·표 합치기는 그대로다.
 */
export type CommentHealth = 'loading' | 'ok' | 'broken' | 'unavailable';
const health = new Map<string, { state: CommentHealth; at: number; detail: string }>();
let healthListener: () => void = () => {};

export function onCommentHealthChange(fn: () => void): void {
  healthListener = fn;
}

/** 문제 보고에 넣을 짧은 설명 — 어느 요청이 어떻게 실패했나. 저장소 이름·주소는 넣지 않는다 */
function describe(step: string, e: unknown): string {
  return `${step}: ${e instanceof RequestError ? (e.status ? `HTTP ${e.status} ${e.message}` : e.message) : String(e)}`.slice(0, 200);
}

function setHealth(key: string, state: CommentHealth, detail = ''): void {
  const prev = health.get(key)?.state;
  health.set(key, { state, at: Date.now(), detail });
  if (state === 'broken') detachAllComments();
  if (prev !== state) healthListener();
}

function healthOf(url: string): CommentHealth | null {
  const pr = prRef(url);
  if (!pr || isCommitRangeView(url)) return null;
  return health.get(prKey(pr))?.state ?? null;
}

/** 이 PR에서 코멘트를 쓸 수 있는지 PR 데이터를 한 번 읽어 본다. 로그인한 PR 화면을 훑을 때마다 불러도 된다 */
export function prepareComments(url: string): void {
  const pr = prRef(url);
  if (!pr || isCommitRangeView(url)) return;
  const key = prKey(pr);
  const h = health.get(key);
  if (h && !(h.state === 'unavailable' && Date.now() - h.at > RETRY_MS)) return;
  setHealth(key, 'loading');
  loadPr(pr).then(
    () => setHealth(key, 'ok'),
    (e: unknown) => {
      console.warn(LOG, e);
      setHealth(key, isGitHubChange(e) ? 'broken' : 'unavailable', describe('GET pull/:n/changes', e));
    },
  );
}

/** 코멘트가 꺼진 까닭(문제 보고용). 없으면 '' */
export function commentsBrokenDetail(url: string): string {
  const pr = prRef(url);
  return (pr && health.get(prKey(pr))?.detail) || '';
}

/** PR 데이터를 읽었고 모양도 맞다 — 그때만 "+"를 달고, 스레드가 있는 파일도 렌더링으로 연다 */
export const commentsReady = (url: string): boolean => healthOf(url) === 'ok';
/** GitHub 내부 요청이 바뀐 것으로 보인다 — 툴바 아이콘에 알린다 */
export const commentsBroken = (url: string): boolean => healthOf(url) === 'broken';

/** 사람에게 보일 오류 문구로 바꾼다. GitHub 쪽이 바뀐 것이면 이 PR의 코멘트 기능을 끈다 */
function userError(e: unknown, pr: PrRef, step: string): Error {
  if (e instanceof RequestError && e.lineNotResolved) return new Error(t('errorLineNotResolved'));
  if (isGitHubChange(e)) {
    setHealth(prKey(pr), 'broken', describe(step, e));
    return new Error(t('errorChanged'));
  }
  return new Error(t('errorPost', [e instanceof Error ? e.message : String(e)]));
}

/**
 * 편집·삭제·미리보기 실패 — 그 자리에 이유만 보인다. 이 요청들이 바뀌어도 코멘트 달기(별도 요청)는 살아 있을 수 있으니
 * 코멘트 기능 전체를 끄지는 않는다(코멘트 달기·스레드 읽기가 실패할 때만 끈다)
 */
function softError(e: unknown): Error {
  return new Error(t('errorPost', [e instanceof Error ? e.message : String(e)]));
}

const controllers = new Map<HTMLElement, CommentController>();

/** 이름이 바뀐 파일은 "옛 → 새"로 나온다 — 코멘트는 새 경로에 단다 */
export function commentPath(displayPath: string): string {
  return displayPath.split('→').pop()?.trim() ?? displayPath;
}

/** 렌더링 본문 하나에 코멘트 기능을 붙인다. 이미 붙어 있으면 그대로 */
export function attachComments(file: HTMLElement, body: HTMLElement, path: string, hadThreads: boolean): void {
  for (const [b, c] of controllers) {
    if (!b.isConnected || !c.alive()) {
      c.dispose();
      controllers.delete(b);
    }
  }
  if (controllers.has(body)) return;
  const pr = prRef(location.href);
  if (!pr || isCommitRangeView(location.href)) return;
  controllers.set(body, new CommentController(body, new GitHubCommentBackend(file, body, commentPath(path), pr, hadThreads)));
}

/** 확장을 끌 때 — 이벤트를 떼고 표시를 지운다(만든 요소는 undoAll이 걷는다) */
export function detachAllComments(): void {
  for (const c of controllers.values()) c.dispose();
  controllers.clear();
}

/**
 * GitHub 백엔드 — 로그인 세션으로 GitHub 내부 요청을 보내 스레드를 읽고, 원문을 받아 블록과 줄을 잇고, 코멘트를 올린다.
 * 화면 동작은 CommentController가 맡는다. 실패는 사람에게 보일 문구로 바꿔 던진다(GitHub 쪽이 바뀐 것이면 이 PR의 코멘트를 끈다)
 */
class GitHubCommentBackend implements CommentBackend {
  readonly expectThreads: boolean;
  private data: PrData | null = null;
  /** 첫 load는 PR 데이터 캐시를 쓰고, 그 뒤(올리기·답글 등 뒤 다시 그리기)는 새로 읽는다 */
  private loaded = false;
  private headOid = '';
  /** 머리 커밋의 파일 원문 줄 — 제안 버튼이 원래 줄을 가져온다 */
  private headLines: string[] | null = null;

  constructor(
    private readonly file: HTMLElement,
    private readonly body: HTMLElement,
    private readonly path: string,
    private readonly pr: PrRef,
    hadThreads: boolean,
  ) {
    this.expectThreads = hadThreads;
  }

  async load(): Promise<CommentState> {
    // 붙을 때(start)는 캐시를 쓰고, 그 뒤 다시 그리기는 늘 새로 읽는다 — 첫 읽기가 실패했어도 그다음부터는 새로
    const fresh = this.loaded;
    this.loaded = true;
    const d = await loadPr(this.pr, fresh);
    this.data = d;
    return { threads: d.files.get(this.path)?.threads ?? [], pendingReview: Boolean(d.pendingReviewId) };
  }

  async mapping(body: HTMLElement): Promise<Map<HTMLElement, BlockTarget>> {
    try {
      return await this.buildMapping(body);
    } catch (e) {
      // 예전 FileComments는 경고에 파일 경로를 함께 남겼다(console.warn(LOG, path, e)) — 탐험 보고서가 그 글을 모은다
      throw new Error(`${this.path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async buildMapping(body: HTMLElement): Promise<Map<HTMLElement, BlockTarget>> {
    const d = this.data ?? (await loadPr(this.pr));
    const info = d.files.get(this.path);
    const local = body.closest(`[${LOCAL_ATTR}]`);
    if (local) {
      // 확장이 엔진으로 그린 본문(docs/local-render) — 엔진이 그 두 커밋의 원문으로 잎마다 줄을 달았다. 그린 머리 커밋으로 올려야
      // 그 사이 새 커밋이 올라왔을 때 send()가 멈춘다. 머리 원문은 제안 버튼용(같은 캐시)
      const headOid = local.getAttribute(HEAD_ATTR) || d.headOid;
      const head = REMOVED_CHANGE.has(info?.changeType ?? '') ? null : await loadText(this.pr, headOid, this.path).catch(() => null);
      this.headOid = headOid;
      this.headLines = head === null ? null : head.split('\n');
      return mappingFromAttributes(body);
    }
    const blocks = domBlocks(body);
    const removedFile = REMOVED_CHANGE.has(info?.changeType ?? '');
    const needBase = removedFile || (info?.changeType !== 'ADDED' && blocks.some((b) => b.side === 'left'));
    const [head, base] = await Promise.all([
      removedFile ? null : loadText(this.pr, d.headOid, this.path).catch(() => null),
      needBase ? loadText(this.pr, d.baseOid, info?.oldPath ?? this.path).catch(() => null) : null,
    ]);
    if (head === null && base === null) throw new Error('no source text');
    this.headOid = d.headOid;
    this.headLines = head === null ? null : head.split('\n');
    return mapBlocks(blocks, head === null ? null : sourceBlocks(head), base === null ? null : sourceBlocks(base));
  }

  /** 제안 버튼에 넣을 원래 줄 — 오른쪽(머리 커밋) 줄만. GitHub도 지운 쪽 줄에는 제안을 못 단다 */
  suggestion(span: BlockTarget): string | undefined {
    if (span.side !== 'right' || !this.headLines) return undefined;
    const rows = this.headLines.slice(span.start - 1, span.end);
    return rows.length ? rows.join('\n').replace(/\r/g, '') : undefined;
  }

  post(span: BlockTarget, text: string, mode: PostMode): Promise<void> {
    return this.send((d) => commentPayload({ path: this.path, ...span }, text, d.pendingReviewId ? 'review' : mode, d));
  }

  reply(thread: ReviewThread, text: string, mode: PostMode): Promise<void> {
    return this.send((d) => replyPayload(thread, this.path, text, d.pendingReviewId ? 'review' : mode, d));
  }

  async resolve(thread: ReviewThread, resolved: boolean): Promise<void> {
    try {
      await setThreadResolved(this.pr, thread.id, resolved);
    } catch (e) {
      throw userError(e, this.pr, 'POST page_data/(un)resolve_thread');
    }
  }

  async edit(comment: ReviewComment, text: string): Promise<void> {
    try {
      await updateComment(this.pr, comment.id, comment.bodyVersion, text);
    } catch (e) {
      throw softError(e);
    }
  }

  async remove(comment: ReviewComment): Promise<void> {
    try {
      await deleteComment(this.pr, comment.id);
    } catch (e) {
      throw softError(e);
    }
  }

  /** 코멘트 상자의 미리보기 — GitHub에 렌더링을 맡긴다 */
  async preview(text: string): Promise<string> {
    try {
      return await previewMarkdown(text, { repositoryId: this.data?.repositoryId ?? null, pullRequestId: this.data?.pullRequestId ?? null });
    } catch (e) {
      throw softError(e);
    }
  }

  /** 스레드를 보여 줄 수 없을 때 — 원문 보기로 가는 버튼 */
  unavailable(): void {
    if (this.body.querySelector(`[${MDF_ATTR}="${NOTICE}"]`)) return;
    this.body.prepend(noticeBox(this.body.ownerDocument, t('threadsUnavailable'), t('showSource'), () => viewButton(this.file, 'source')?.click()));
  }

  /** 최신 PR 데이터로 올린다 — 그 사이 새 커밋이 올라왔으면 멈춘다. 다시 그리기는 CommentController가 한다 */
  private async send(build: (d: PrData) => Record<string, unknown>): Promise<void> {
    let fresh: PrData;
    try {
      fresh = await loadPr(this.pr, true);
    } catch (e) {
      throw userError(e, this.pr, 'GET pull/:n/changes');
    }
    if (this.headOid && fresh.headOid !== this.headOid) throw new Error(t('errorStale'));
    try {
      await postComment(this.pr, build(fresh));
    } catch (e) {
      throw userError(e, this.pr, 'POST page_data/create_review_comment');
    }
  }
}

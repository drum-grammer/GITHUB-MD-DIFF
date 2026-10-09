/**
 * 렌더링 보기에서 코멘트 달기 — 블록에 마우스를 올리면 "+"가 나오고, 누르거나 다른 블록까지 끌면 그 원문 줄에 코멘트를 단다.
 * 이미 달린 스레드도 블록 아래에 보여 주고 답글·해결을 할 수 있다. 원문은 처음 필요할 때만 받는다.
 */
import { refold } from './fold';
import {
  RequestError,
  commentPayload,
  deleteComment,
  fetchFileText,
  fetchPrData,
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
  type ReviewComment,
  type ReviewThread,
} from './github-api';
import { domBlocks, mapBlocks, spanOf, type BlockTarget } from './dom-blocks';
import {
  FILE_THREADS,
  FORM,
  NOTICE,
  THREAD,
  UNPLACED,
  addButton,
  commentForm,
  fileThreadsBox,
  lineLabel,
  noticeBox,
  placeBox,
  replyDraft,
  threadBox,
  topLevel,
  unplacedBox,
} from './comment-ui';
import { t } from './i18n';
import { MDF_ATTR, PIN_ATTR, viewButton } from './selectors';
import { sourceBlocks } from './source-blocks';
import { mergedRow, originRow } from './table-render';

const LOG = '[github-md-diff]';
export const HOST_ATTR = 'data-mdf-comments';
const SELECTED = 'mdf-selected';
/** 원래 파일이 없는(삭제된) 파일의 종류 이름 — GitHub 내부 JSON은 REMOVED, GraphQL은 DELETED */
const REMOVED_FILE = new Set(['REMOVED', 'DELETED']);
/** PR 데이터를 다시 쓰는 시간 — 그보다 오래되면 새 파일 묶음이 붙을 때 다시 읽는다 */
const PR_TTL_MS = 60_000;
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

const prCache = new Map<string, { at: number; data: Promise<PrData> }>();
const textCache = new Map<string, Promise<string>>();

function loadPr(pr: PrRef, fresh = false): Promise<PrData> {
  const key = prKey(pr);
  const hit = prCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < PR_TTL_MS) return hit.data;
  const data = fetchPrData(pr);
  prCache.set(key, { at: Date.now(), data });
  data.catch(() => prCache.delete(key));
  return data;
}

function loadText(pr: PrRef, oid: string, path: string): Promise<string> {
  const key = `${prKey(pr)}:${oid}:${path}`;
  let text = textCache.get(key);
  if (!text) {
    text = fetchFileText(pr, oid, path);
    textCache.set(key, text);
    text.catch(() => textCache.delete(key));
  }
  return text;
}

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

const controllers = new Map<HTMLElement, FileComments>();

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
  controllers.set(body, new FileComments(file, body, commentPath(path), pr, hadThreads));
}

/** 확장을 끌 때 — 이벤트를 떼고 표시를 지운다(만든 요소는 undoAll이 걷는다) */
export function detachAllComments(): void {
  for (const c of controllers.values()) c.dispose();
  controllers.clear();
}

interface Hit {
  el: HTMLElement;
  target: BlockTarget;
}

class FileComments {
  private mapping: Map<HTMLElement, BlockTarget> | null = null;
  private loading: Promise<Map<HTMLElement, BlockTarget> | null> | null = null;
  private data: PrData | null = null;
  private headOid = '';
  private readonly host: HTMLElement;
  private readonly button: HTMLButtonElement;
  private hovered: HTMLElement | null = null;
  private drag: { side: BlockTarget['side']; from: HTMLElement; to: HTMLElement } | null = null;
  /** 열린 코멘트 상자 → 그 상자가 가리키는 블록. 상자가 열려 있는 동안 노란 음영을 둔다(GitHub 원문 보기처럼) */
  private readonly formBlocks = new Map<HTMLElement, HTMLElement[]>();
  private disposed = false;

  constructor(
    private readonly file: HTMLElement,
    private readonly body: HTMLElement,
    private readonly path: string,
    private readonly pr: PrRef,
    private readonly hadThreads: boolean,
  ) {
    this.host = body.closest<HTMLElement>('.prose-diff') ?? body;
    this.host.setAttribute(HOST_ATTR, '');
    this.button = addButton(body.ownerDocument);
    this.host.append(this.button);
    this.host.addEventListener('mousemove', this.onMove);
    this.host.addEventListener('mouseleave', this.onLeave);
    this.button.addEventListener('mousedown', this.onButtonDown);
    this.button.addEventListener('click', this.onButtonClick);
    void this.start();
  }

  /** 이벤트 처리 중 예외가 나도 화면은 그대로 두고 "+"만 감춘다 */
  private guard<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
    return (...args: A) => {
      try {
        fn(...args);
      } catch (e) {
        console.warn(LOG, this.path, e);
        this.drag = null;
        this.button.hidden = true;
      }
    };
  }

  /** GitHub가 본문 안을 통째로 다시 그리면 "+"와 연결한 블록이 사라진다 — 그때는 새로 붙인다 */
  alive(): boolean {
    if (!this.button.isConnected) return false;
    const first = this.mapping?.keys().next().value;
    return !first || first.isConnected;
  }

  dispose(): void {
    this.disposed = true;
    this.host.removeEventListener('mousemove', this.onMove);
    this.host.removeEventListener('mouseleave', this.onLeave);
    this.body.ownerDocument.removeEventListener('mouseup', this.onUp);
    this.host.removeAttribute(HOST_ATTR);
    this.button.remove();
    this.formBlocks.clear();
    this.clearSelection();
  }

  /** 스레드가 있는 파일은 바로 원문을 받아 스레드를 붙인다. 없으면 마우스를 올릴 때까지 기다린다 */
  private async start(): Promise<void> {
    let d: PrData;
    try {
      d = await loadPr(this.pr);
    } catch (e) {
      console.warn(LOG, e);
      if (this.hadThreads && !this.disposed) this.showNotice();
      return;
    }
    this.data = d;
    if (this.disposed) return;
    if (d.files.get(this.path)?.threads.length) await this.showThreads(d);
    else if (this.hadThreads) this.showNotice(); // 원문 보기엔 스레드가 있었는데 여기서 못 찾았다(파일 코멘트 등)
  }

  /** 실패하면 다음에 다시 시도한다(잠깐의 요청 실패로 "+"가 영영 안 나오지 않게) */
  private ensureMapping(): Promise<Map<HTMLElement, BlockTarget> | null> {
    this.loading ??= this.buildMapping().catch((e: unknown) => {
      console.warn(LOG, this.path, e);
      this.loading = null;
      return null;
    });
    return this.loading;
  }

  private async buildMapping(): Promise<Map<HTMLElement, BlockTarget>> {
    const d = this.data ?? (await loadPr(this.pr));
    const info = d.files.get(this.path);
    const blocks = domBlocks(this.body);
    const removedFile = REMOVED_FILE.has(info?.changeType ?? '');
    const needBase = removedFile || (info?.changeType !== 'ADDED' && blocks.some((b) => b.side === 'left'));
    const [head, base] = await Promise.all([
      removedFile ? null : loadText(this.pr, d.headOid, this.path).catch(() => null),
      needBase ? loadText(this.pr, d.baseOid, info?.oldPath ?? this.path).catch(() => null) : null,
    ]);
    if (head === null && base === null) throw new Error('no source text');
    this.headOid = d.headOid;
    this.mapping = mapBlocks(blocks, head === null ? null : sourceBlocks(head), base === null ? null : sourceBlocks(base));
    return this.mapping;
  }

  private targetOf(el: Element): BlockTarget | null {
    const m = this.mapping;
    if (!m) return null;
    const own = m.get(el as HTMLElement);
    if (own) return own;
    const origin = originRow(el);
    return origin ? (m.get(origin) ?? null) : null;
  }

  /** 마우스 아래의 코멘트 블록 — 확장이 만든 상자 안이면 없다 */
  private blockAt(node: EventTarget | null): Hit | null {
    if (!(node instanceof Element) || !this.mapping) return null;
    if (node === this.button) {
      const target = this.hovered && this.targetOf(this.hovered);
      return this.hovered && target ? { el: this.hovered, target } : null;
    }
    if (node.closest(`[${MDF_ATTR}="${FORM}"], [${MDF_ATTR}="${THREAD}"], [${MDF_ATTR}="${UNPLACED}"]`)) return null;
    for (let n: Element | null = node; n && n !== this.host; n = n.parentElement) {
      const target = this.targetOf(n);
      if (target) return { el: n as HTMLElement, target };
    }
    return null;
  }

  private onMove = this.guard((e: MouseEvent): void => {
    if (!this.mapping) {
      void this.ensureMapping();
      return;
    }
    const hit = this.blockAt(e.target);
    if (this.drag) {
      if (hit && hit.target.side === this.drag.side && hit.el !== this.drag.to) {
        this.drag.to = hit.el;
        this.paintSelection();
      }
      return;
    }
    if (hit) this.showButton(hit.el);
  });

  private onLeave = (): void => {
    if (!this.drag) this.button.hidden = true;
  };

  private showButton(el: HTMLElement): void {
    const host = this.host.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    this.hovered = el;
    this.button.style.top = `${r.top - host.top}px`;
    this.button.style.left = `${Math.max(0, r.left - host.left - 26)}px`;
    this.button.hidden = false;
  }

  private onButtonDown = this.guard((e: MouseEvent): void => {
    const target = this.hovered && this.targetOf(this.hovered);
    if (e.button !== 0 || !this.hovered || !target) return;
    e.preventDefault(); // 글자 선택이 생기지 않게
    this.drag = { side: target.side, from: this.hovered, to: this.hovered };
    this.paintSelection();
    this.body.ownerDocument.addEventListener('mouseup', this.onUp, { once: true });
  });

  private onUp = this.guard((): void => {
    const d = this.drag;
    this.drag = null;
    if (d) this.openForm(d.from, d.to);
    this.paintSelection();
  });

  /** 키보드로 누른 경우(detail 0) — 그 블록 하나 */
  private onButtonClick = this.guard((e: MouseEvent): void => {
    if (e.detail === 0 && this.hovered) this.openForm(this.hovered, this.hovered);
  });

  /** from~to가 덮는 블록 — 합친 표의 행은 보이는 행으로 */
  private blocksBetween(from: HTMLElement, to: HTMLElement): HTMLElement[] {
    const a = this.targetOf(from);
    const b = this.targetOf(to);
    const span = a && b ? spanOf([a, b]) : null;
    if (!span) return [];
    const out = new Set([from, to]);
    for (const [el, tg] of this.mapping ?? []) {
      if (tg.side === span.side && tg.start >= span.start && tg.end <= span.end) out.add(this.visible(el));
    }
    return [...out];
  }

  /** 끌고 있는 범위와 열린 상자들의 범위를 칠한다 */
  private paintSelection(): void {
    this.clearSelection();
    for (const [form, blocks] of this.formBlocks) {
      if (!form.isConnected) this.formBlocks.delete(form);
      else for (const el of blocks) el.classList.add(SELECTED);
    }
    if (this.drag) for (const el of this.blocksBetween(this.drag.from, this.drag.to)) el.classList.add(SELECTED);
  }

  private clearSelection(): void {
    for (const el of this.host.querySelectorAll(`.${SELECTED}`)) el.classList.remove(SELECTED);
  }

  /** 상자를 넣고, 그 블록이 접히지 않게 고정한 뒤 접기를 다시 짠다 */
  private insertBoxes(items: Array<{ block: HTMLElement; box: HTMLElement }>, before: () => void = () => {}): void {
    refold(this.body, () => {
      before();
      for (const { block, box } of items) {
        placeBox(block, this.body, box);
        this.pin(block);
        this.pin(box);
      }
    });
  }

  /** 접히지 않게 맨 위 묶음을 고정한다. GitHub가 변경 없는 블록을 하나로 묶은 곳이면 묶음 안의 그 블록도 — 나머지는 묶음 안에서 다시 접힌다 */
  private pin(node: Element): void {
    const top = topLevel(node, this.body);
    top?.setAttribute(PIN_ATTR, '');
    if (top && top !== node && top.classList.contains('expandable')) topLevel(node, top as HTMLElement)?.setAttribute(PIN_ATTR, '');
  }

  private openForm(from: HTMLElement, to: HTMLElement): void {
    const a = this.targetOf(from);
    const b = this.targetOf(to);
    const span = a && b ? spanOf([a, b]) : null;
    if (!span) return;
    this.button.hidden = true;
    // 같은 줄의 상자가 열려 있으면 그것으로. 다른 줄의 빈 상자는 닫고, 글을 쓰던 상자는 둔다
    const key = `${span.side}:${span.start}-${span.end}`;
    for (const open of this.body.querySelectorAll<HTMLElement>(`[${MDF_ATTR}="${FORM}"]`)) {
      if (open.dataset.span === key) {
        open.querySelector('textarea')?.focus();
        return;
      }
      if (!open.querySelector('textarea')?.value.trim() && !open.dataset.busy) open.remove();
    }
    const last = from.compareDocumentPosition(to) & Node.DOCUMENT_POSITION_FOLLOWING ? to : from;
    const form = commentForm(
      this.body.ownerDocument,
      { label: lineLabel(span), pendingReview: Boolean(this.data?.pendingReviewId), singleLabel: t('commentSingle'), preview: this.preview },
      {
        onSubmit: async (text, mode) => {
          await this.post((d) => commentPayload({ path: this.path, ...span }, text, d.pendingReviewId ? 'review' : mode, d));
          form.remove();
          this.paintSelection();
        },
        onCancel: () => {
          form.remove();
          this.paintSelection();
        },
      },
    );
    form.dataset.span = key;
    this.formBlocks.set(form, this.blocksBetween(from, to));
    this.insertBoxes([{ block: last, box: form }]);
    this.paintSelection();
    form.querySelector('textarea')?.focus();
  }

  /** 최신 PR 데이터로 올린다 — 그 사이 새 커밋이 올라왔으면 멈춘다. 올린 뒤 스레드를 다시 그린다 */
  private async post(build: (d: PrData) => Record<string, unknown>): Promise<void> {
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
    await this.refresh();
  }

  /** 코멘트 상자의 미리보기 — GitHub에 렌더링을 맡긴다 */
  private preview = async (text: string): Promise<string> => {
    try {
      return await previewMarkdown(text, { repositoryId: this.data?.repositoryId ?? null, pullRequestId: this.data?.pullRequestId ?? null });
    } catch (e) {
      throw softError(e);
    }
  };

  private async refresh(): Promise<void> {
    try {
      await this.showThreads(await loadPr(this.pr, true));
    } catch (e) {
      console.warn(LOG, e);
    }
  }

  private anchorFor(thread: ReviewThread): HTMLElement | null {
    let best: { el: HTMLElement; start: number } | null = null;
    for (const [el, tg] of this.mapping ?? []) {
      if (tg.side !== thread.side || tg.start > thread.end) continue;
      if (thread.end <= tg.end) return this.visible(el);
      if (!best || tg.start > best.start) best = { el, start: tg.start };
    }
    return best ? this.visible(best.el) : null;
  }

  /** 합친 표 뒤에 숨은 GitHub 원래 표의 행이면 합친 표에서 그 행을 보여 주는 행 */
  private visible(el: HTMLElement): HTMLElement {
    return mergedRow(el) ?? el;
  }

  private async showThreads(d: PrData): Promise<void> {
    this.data = d;
    const threads = d.files.get(this.path)?.threads ?? [];
    const old = [...this.body.querySelectorAll(`[${MDF_ATTR}="${THREAD}"], [${MDF_ATTR}="${UNPLACED}"], [${MDF_ATTR}="${FILE_THREADS}"], [${MDF_ATTR}="${NOTICE}"]`)];
    // 열어 둔 답글 상자의 글은 다시 그려도 남긴다
    const drafts = new Map<string, string>();
    for (const box of this.body.querySelectorAll<HTMLElement>(`[${MDF_ATTR}="${THREAD}"]`)) {
      const draft = replyDraft(box);
      if (draft !== null && box.dataset.threadId) drafts.set(box.dataset.threadId, draft);
    }
    if (threads.length === 0) {
      for (const n of old) n.remove();
      return;
    }
    const mapping = await this.ensureMapping();
    if (this.disposed) return;
    if (!mapping) {
      this.showNotice();
      return;
    }
    const doc = this.body.ownerDocument;
    const handlers = {
      onReply: (th: ReviewThread, text: string, mode: 'single' | 'review') =>
        this.post((fresh) => replyPayload(th, this.path, text, fresh.pendingReviewId ? 'review' : mode, fresh)),
      onResolve: async (th: ReviewThread, resolved: boolean) => {
        try {
          await setThreadResolved(this.pr, th.id, resolved);
        } catch (e) {
          throw userError(e, this.pr, 'POST page_data/(un)resolve_thread');
        }
        await this.refresh();
      },
      onEdit: async (c: ReviewComment, text: string) => {
        try {
          await updateComment(this.pr, c.id, c.bodyVersion, text);
        } catch (e) {
          throw softError(e);
        }
        await this.refresh();
      },
      onDelete: async (c: ReviewComment) => {
        try {
          await deleteComment(this.pr, c.id);
        } catch (e) {
          throw softError(e);
        }
        await this.refresh();
      },
      preview: this.preview,
    };
    const placed: Array<{ block: HTMLElement; box: HTMLElement }> = [];
    const unplaced: HTMLElement[] = [];
    const wholeFile: HTMLElement[] = [];
    for (const th of threads) {
      const box = threadBox(doc, th, Boolean(d.pendingReviewId), handlers, drafts.get(th.id) ?? null);
      if (th.subject === 'file') {
        wholeFile.push(box);
        continue;
      }
      const block = this.anchorFor(th);
      if (block) placed.push({ block, box });
      else unplaced.push(box);
    }
    this.insertBoxes(placed, () => {
      for (const n of old) n.remove();
      // 파일 툴바 바로 아래 — 파일 전체 코멘트, 그다음 자리를 못 찾은 스레드
      const top = (box: HTMLElement) => {
        const bar = this.body.querySelector(`:scope > [${MDF_ATTR}="file-toolbar"]`);
        if (bar) bar.after(box);
        else this.body.prepend(box);
      };
      if (unplaced.length) top(unplacedBox(doc, unplaced));
      if (wholeFile.length) top(fileThreadsBox(doc, wholeFile));
    });
  }

  /** 스레드를 보여 줄 수 없을 때 — 원문 보기로 가는 버튼 */
  private showNotice(): void {
    if (this.body.querySelector(`[${MDF_ATTR}="${NOTICE}"]`)) return;
    this.body.prepend(noticeBox(this.body.ownerDocument, t('threadsUnavailable'), t('showSource'), () => viewButton(this.file, 'source')?.click()));
  }
}

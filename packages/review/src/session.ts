// 리뷰 세션 — 서버 하나가 쥐는 상태: 지금 그린 판, 보기 바꾸기, 폴링(그리고 Task 10의 초안·보내기·스레드)
import { randomBytes } from 'node:crypto';
import { diffMarkdown, renderMarkdown, renderProseDiff, type FileDiff } from '@markdown-diff-cat/engine';
import type { ReviewComment, ReviewThread } from '../../../src/types';
import type { Badge, DraftInput, DraftListItem, EarlierItem, FilePayload, Notice, PollPayload, PushPayload, SendPayload, ThreadsPayload, ViewKind, ViewPayload } from './api-types';
import { HttpError } from './errors';
import { repoInfo, resolveBase, type BaseInfo } from './git';
import { formatRound, isoLocal, lineLabel } from './handoff';
import { ImageIssuer } from './images';
import { fenced, sanitizeQuote, splitSuggestion } from './quote';
import type { Draft, Mark, RenderRecord, ReviewMode, Round, RoundBase, SourceSide, StoredComment } from './records';
import type { StateStore } from './state';
import { fingerprint, latestBaseline, sinceLastFiles, snapshot, type ViewFile } from './views';

export interface SessionOptions {
  root: string;
  store: StateStore;
  baseRef?: string;
  view: ViewKind;
  now?: () => Date;
}

export interface Current {
  record: RenderRecord;
  base: BaseInfo;
  /** 지난 리뷰 이후 보기의 기준 판(분기점 보기면 null) */
  from: RenderRecord | null;
  files: ViewFile[];
  diffs: Map<string, FileDiff>;
  rendered: FilePayload[];
  notices: Notice[];
  /** 그릴 때의 폴링 지문 */
  print: string;
}

export const KEEP_RENDERS = 20;
const MAX_EARLIER = 50;
const MAX_HTML_CACHE = 500;

const MAX_BODY = 65_536;

/** 사람이 쓴 코멘트 글 — 앞뒤 공백을 떼고, 비었거나 너무 길면 400 */
export function cleanBody(body: unknown): string {
  const text = String(body ?? '').trim();
  if (!text) throw new HttpError(400, 'The comment is empty.');
  if (text.length > MAX_BODY) throw new HttpError(400, 'The comment is too long.');
  return text;
}

/** 그릴 재료 — 모드마다 다르다(작업 트리: 분기점·작업 트리, PR: 받은 git 객체) */
export interface Source {
  base: BaseInfo;
  from: RenderRecord | null;
  files: ViewFile[];
  /** 렌더 판에 담을 원문 */
  recordFiles: Record<string, string | null>;
  notices: Notice[];
  /** 옛 쪽 이미지를 읽을 커밋 */
  oldOid: string;
  /** 새 쪽 이미지 id — 없으면 작업 트리에서 */
  newImage?: (rev: string, path: string) => string | null;
  /** 판에 더할 것(PR 모드의 mode·pr·baseLabel) */
  record?: Partial<RenderRecord>;
  /** 폴링 지문(PR 모드는 빈 글) */
  print: string;
}

/** 보낼 라운드에 초안과 함께 넣을 코멘트(PR 모드의 골라 넣은 GitHub 스레드) — id·round는 보내기가 매긴다 */
export type ExtraComment = Omit<StoredComment, 'id' | 'round'>;

export function toThread(id: string, side: SourceSide, start: number, end: number, comment: ReviewComment): ReviewThread {
  return { id, subject: 'line', side: side === 'old' ? 'left' : 'right', start, end, resolved: false, canReply: false, comments: [comment] };
}

export function toComment(id: string, body: string, bodyHTML: string, mine: boolean): ReviewComment {
  return { id, author: 'you', body, bodyHTML, url: '', pending: false, bodyVersion: '', canEdit: mine, canDelete: mine };
}

/** 줄 범위의 원문(LF로) */
export const quoteOf = (text: string, start: number, end: number): string => sourceLines(text).slice(start - 1, end).join('\n');

/** 초안의 쪽 원문이 지금 보기에 있는가 — 보기에 없는 파일이거나 그 쪽 원문이 없어졌으면(지운 파일의 새 쪽) false: 페이지 위 "이 보기 밖" 목록으로 */
export const onView = (files: ViewFile[], d: { path: string; side: SourceSide }): boolean => {
  const f = files.find((x) => x.path === d.path);
  return f !== undefined && (d.side === 'new' ? f.newText : f.oldText) !== null;
};

/** 원문 → 줄(CRLF·CR은 LF로) — 인용·제안·줄 범위 검사가 같은 규칙을 쓴다 */
export const sourceLines = (text: string): string[] => text.replace(/\r\n?/g, '\n').split('\n');

/** 목록에 보일 인용 한 줄(첫 글줄, 120자) */
export function excerpt(text: string): string {
  const first = (text.split('\n').find((l) => l.trim()) ?? '').trim();
  return first.length > 120 ? `${first.slice(0, 119)}…` : first;
}

/** 그 쪽 줄 범위에 걸치는 첫 잎의 종류·제목 경로. 걸치는 잎이 없으면 앞의 가장 가까운 잎(없으면 paragraph·[]) */
export function leafAt(diff: FileDiff, side: SourceSide, start: number, end: number): { kind: string; headingPath: string[] } {
  let before: { kind: string; headingPath: string[] } | null = null;
  for (const block of diff.blocks) {
    for (const op of block.leaves) {
      const range = side === 'new' ? op.leaf.new : op.leaf.old;
      if (!range) continue;
      if (range.start <= end && start <= range.end) return { kind: op.leaf.kind, headingPath: op.leaf.headingPath };
      if (range.start <= start) before = { kind: op.leaf.kind, headingPath: op.leaf.headingPath };
    }
  }
  return before ?? { kind: 'paragraph', headingPath: [] };
}

export class ReviewSession {
  readonly images: ImageIssuer;
  protected current: Current | null = null;
  private viewKind: ViewKind;
  private baseRef: string | undefined;
  private readonly htmlCache = new Map<string, string>();

  constructor(protected readonly opts: SessionOptions) {
    this.images = new ImageIssuer(opts.root);
    this.viewKind = opts.view;
    this.baseRef = opts.baseRef;
  }

  protected now(): Date {
    return this.opts.now?.() ?? new Date();
  }

  /** 이 세션의 초안 범위 — 작업 트리 모드는 없음(undefined), PR 모드는 "pr:<owner>/<repo>#<n>" */
  protected scope(): string | undefined {
    return undefined;
  }

  /** 같은 저장 폴더를 PR 세션과 같이 쓴다 — 자기 범위의 초안만 보고, 저장할 때 남의 범위 초안은 그대로 둔다 */
  protected inScope(d: Draft): boolean {
    return d.scope === this.scope();
  }

  protected ownDrafts(): Draft[] {
    return this.opts.store.drafts().filter((d) => this.inScope(d));
  }

  /** 이 모드의 라운드인가 — 작업 트리 모드는 PR 라운드를 "지난 리뷰"·"이전 코멘트"로 쓰지 않는다 */
  protected ownRound(r: Round): boolean {
    return r.mode !== 'pr';
  }

  /** mark한 판이 이 모드의 판인가(판이 지워졌으면 작업 트리 것으로 본다 — "지난 리뷰 판이 없다" 알림이 그대로 나오게) */
  protected ownMark(m: Mark): boolean {
    return this.opts.store.loadRender(m.rev)?.mode !== 'pr';
  }

  protected ownRounds(): Round[] {
    return this.opts.store.rounds().filter((r) => this.ownRound(r));
  }

  protected ownMarks(): Mark[] {
    return this.opts.store.marks().filter((m) => this.ownMark(m));
  }

  rev(): string | null {
    return this.current?.record.id ?? null;
  }

  /** 지금 판의 보기(없으면 그린다) */
  view(): ViewPayload {
    return this.payload(this.current ?? this.paint());
  }

  /** 새 판을 그린다 */
  draw(): ViewPayload {
    return this.payload(this.paint());
  }

  /** 보기를 바꾼다 — baseRef가 undefined면 그대로, null이면 기본 브랜치로 */
  setView(view: ViewKind, baseRef?: string | null): ViewPayload {
    const prev = { viewKind: this.viewKind, baseRef: this.baseRef };
    this.viewKind = view;
    if (baseRef !== undefined) this.baseRef = baseRef ?? undefined;
    try {
      return this.draw();
    } catch (e) {
      // 없는 기준(GitError) 등으로 못 그리면 앞의 보기·기준을 그대로 둔다 — 열린 페이지의 다시 그리기가 계속 된다
      this.viewKind = prev.viewKind;
      this.baseRef = prev.baseRef;
      throw e;
    }
  }

  poll(rev: string): PollPayload {
    const c = this.current;
    if (!c || c.record.id !== rev) return { changed: false, superseded: true };
    return { changed: fingerprint(this.opts.root, c.base.oid) !== c.print, superseded: false };
  }

  /** 코멘트 미리보기 — GitHub 대신 로컬 엔진(정화된 HTML) */
  preview(text: string): string {
    return this.html(text);
  }

  draftCount(): number {
    return this.ownDrafts().length;
  }

  /** 확인 상자에 보일 초안 목록(만든 순서) */
  draftList(): DraftListItem[] {
    return this.ownDrafts()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((d) => ({ id: d.id, path: d.path, lines: d.start === 0 ? 'whole file' : lineLabel(d.start, d.end), excerpt: excerpt(d.body) }));
  }

  // 라우트가 부르는 비동기 자리 — PR 모드(PrSession)는 GitHub 요청 때문에 여기서 기다린다
  async apiThreads(path: string): Promise<ThreadsPayload> {
    return this.threads(path);
  }

  async apiRedraw(): Promise<ViewPayload> {
    return this.draw();
  }

  /** include(골라 넣은 GitHub 스레드)는 PR 모드에서만 쓴다 */
  async apiSend(rev: string, _include: string[]): Promise<SendPayload> {
    return this.send(rev);
  }

  async apiDrafts(): Promise<{ drafts: DraftListItem[] }> {
    return { drafts: this.draftList() };
  }

  async apiPush(_rev: string): Promise<PushPayload> {
    throw new HttpError(404, 'Pending review is only in PR mode.');
  }

  protected html(markdown: string): string {
    let html = this.htmlCache.get(markdown);
    if (html === undefined) {
      if (this.htmlCache.size > MAX_HTML_CACHE) this.htmlCache.clear();
      html = renderMarkdown(markdown);
      this.htmlCache.set(markdown, html);
    }
    return html;
  }

  protected payload(c: Current): ViewPayload {
    const drafts = this.ownDrafts();
    return {
      rev: c.record.id,
      view: c.from ? 'since-last' : 'merge-base',
      baseText: c.from ? `review render ${c.from.id}` : `${c.base.oid.slice(0, 7)} (${c.base.label})`,
      sinceLastAvailable: this.ownRounds().length > 0 || this.ownMarks().length > 0,
      notices: c.notices,
      files: c.rendered,
      drafts: drafts.length,
      offView: drafts.filter((d) => !onView(c.files, d)).map((d) => ({ id: d.id, path: d.path, lines: lineLabel(d.start, d.end), quote: excerpt(d.quoteSanitized) })),
      earlier: this.earlier(c.record.id),
    };
  }

  /** 다른 판에서 보낸 코멘트 — 새 위치에 다시 앵커하지 않고 목록(파일·줄·인용)으로만(스펙 §5-4) */
  private earlier(rev: string): EarlierItem[] {
    const out: EarlierItem[] = [];
    for (const r of [...this.ownRounds()].reverse()) {
      if (r.rev === rev) continue;
      for (const k of r.comments) if (out.length < MAX_EARLIER) out.push({ round: r.round, path: k.path, lines: lineLabel(k.start, k.end), quote: excerpt(k.quoteSanitized) });
    }
    return out;
  }

  /** 작업 트리 모드의 재료 — HEAD가 움직였을 수 있어 저장소 정보부터 다시 읽는다 */
  protected source(): Source {
    const { root, store } = this.opts;
    const base = resolveBase(repoInfo(root), this.baseRef);
    const snap = snapshot(root, base.oid);
    const notices: Notice[] = [];
    let from: RenderRecord | null = null;
    if (this.viewKind === 'since-last') {
      const baseline = latestBaseline(this.ownRounds(), this.ownMarks());
      from = baseline ? store.loadRender(baseline.rev) : null;
      // 라운드·mark가 없으면 "아직 없음", 있는데 그 판 파일이 없으면(손으로 지움 등) "지난 리뷰 판이 없다"(스펙 §5-4)
      if (!from) notices.push(baseline ? { key: 'reviewNoticeBaselineMissing', subs: [baseline.rev] } : { key: 'reviewNoticeNoBaseline' });
    }
    if (base.headIsBase && !from) notices.push({ key: 'reviewNoticeHeadIsBase' });
    if (base.upstream && !this.baseRef) notices.push({ key: 'reviewNoticeUpstream', subs: [base.upstream] });
    for (const s of snap.skipped) notices.push({ key: 'reviewNoticeSkipped', subs: [s.path] });
    const files = from ? sinceLastFiles(root, from, snap) : snap.viewFiles;
    // 지난 리뷰 이후 보기의 옛 쪽 이미지는 판이 담지 않으므로 그 판의 기준 커밋에서 읽는다
    return { base, from, files, recordFiles: snap.files, notices, oldOid: from ? from.baseOid : base.oid, print: fingerprint(root, base.oid) };
  }

  /** 새 렌더 판 */
  protected paint(): Current {
    const { store } = this.opts;
    const src = this.source();
    const { base, from, files, notices } = src;
    const record: RenderRecord = {
      id: store.newRenderId(),
      createdAt: isoLocal(this.now()),
      mode: 'worktree',
      baseOid: base.oid,
      baseLabel: base.label,
      view: from ? { kind: 'since-last', from: from.id } : { kind: 'merge-base' },
      files: src.recordFiles,
      shown: files.map((f) => f.path),
      ...src.record,
    };
    store.saveRender(record);
    const diffs = new Map<string, FileDiff>();
    const newImage = src.newImage;
    const rendered = files.map((f) => this.renderFile(f, record.id, src.oldOid, diffs, newImage && ((p) => newImage(record.id, p))));
    const previous = this.current?.record.id;
    this.current = { record, base, from, files, diffs, rendered, notices, print: src.print };
    this.rebaseDrafts();
    this.images.forgetExcept(previous ? [record.id, previous] : [record.id]);
    store.pruneRenders(KEEP_RENDERS, [record.id]);
    return this.current;
  }

  protected renderFile(f: ViewFile, rev: string, oldOid: string, diffs: Map<string, FileDiff>, newImage?: (path: string) => string | null): FilePayload {
    const out: FilePayload = { path: f.path, ...(f.oldPath ? { oldPath: f.oldPath } : {}), status: f.status, html: '', newText: f.newText, notices: [] };
    try {
      const diff = diffMarkdown({ oldText: f.oldText, newText: f.newText, path: f.path, ...(f.oldPath ? { oldPath: f.oldPath } : {}) });
      diffs.set(f.path, diff);
      out.notices = diff.notices.map((n) => ({ kind: n.kind }));
      out.html = renderProseDiff(diff, {
        rev,
        imageId: (side, p) => (side === 'old' ? this.images.issue(rev, { kind: 'git', oid: oldOid, path: p }) : newImage ? newImage(p) : this.images.issue(rev, { kind: 'worktree', path: p })),
      });
    } catch (e) {
      out.error = e instanceof Error ? e.message : String(e);
    }
    return out;
  }

  /** 그 파일의 스레드 — 초안(고치기·지우기), 지금 판에서 보낸 코멘트(읽기 전용·"보냄") */
  threads(path: string): ThreadsPayload {
    const c = this.current ?? this.paint();
    const badges: Record<string, Badge> = {};
    const threads: ReviewThread[] = [];
    for (const d of this.ownDrafts()) {
      // 보기 밖 초안은 목록(offView)으로만, 답글 초안은 그 GitHub 스레드 안에(PR 모드)
      if (d.replyTo || d.path !== path || !onView(c.files, d)) continue;
      threads.push(toThread(d.id, d.side, d.start, d.end, toComment(d.id, d.body, this.html(d.body), true)));
      if (d.moved) badges[d.id] = 'stale';
    }
    for (const r of this.opts.store.rounds()) {
      if (r.rev !== c.record.id) continue;
      for (const k of r.comments) {
        if (k.path !== path) continue;
        const id = `s${r.round}-${k.id}`;
        const shown = k.suggestion === null ? k.body : `${k.body}\n\n${fenced(k.suggestion, 'suggestion')}`.trim();
        threads.push(toThread(id, k.side, k.start, k.end, toComment(id, shown, this.html(shown), false)));
        badges[id] = 'sent';
      }
    }
    return { threads, badges };
  }

  /** 페이지의 "Add comment" — 줄 번호는 지금 판 기준, 인용·종류·제목 경로는 서버가 판에서 채운다 */
  addDraft(input: DraftInput): Draft {
    const c = this.checkRev(input.rev, 'This view is out of date — press Redraw and comment again.');
    const file = c.files.find((f) => f.path === input.path);
    if (!file) throw new HttpError(400, `${input.path} is not in this view`);
    const side: SourceSide = input.side === 'left' ? 'old' : 'new';
    const text = side === 'new' ? file.newText : file.oldText;
    if (text === null) throw new HttpError(400, `${input.path} has no ${side} side`);
    const count = sourceLines(text).length;
    if (!Number.isInteger(input.start) || !Number.isInteger(input.end) || input.start < 1 || input.end < input.start || input.end > count) {
      throw new HttpError(400, `lines ${input.start}-${input.end} are outside ${input.path}`);
    }
    const body = cleanBody(input.body);
    const quote = quoteOf(text, input.start, input.end);
    const diff = c.diffs.get(file.path);
    const leaf = diff ? leafAt(diff, side, input.start, input.end) : { kind: 'paragraph', headingPath: [] };
    const at = isoLocal(this.now());
    const draft: Draft = {
      id: `d${randomBytes(4).toString('hex')}`,
      rev: c.record.id,
      path: file.path,
      side,
      start: input.start,
      end: input.end,
      body,
      kind: leaf.kind,
      headingPath: leaf.headingPath,
      quote,
      quoteSanitized: sanitizeQuote(quote, { code: leaf.kind === 'code' }),
      createdAt: at,
      updatedAt: at,
      ...(this.scope() ? { scope: this.scope() } : {}),
    };
    const { store } = this.opts;
    store.withLock('drafts', () => store.saveDrafts([...store.drafts(), draft]));
    return draft;
  }

  editDraft(id: string, body: string): Draft {
    const text = cleanBody(body);
    const { store } = this.opts;
    return store.withLock('drafts', () => {
      const list = store.drafts();
      const i = list.findIndex((d) => d.id === id && this.inScope(d));
      if (i < 0) throw new HttpError(404, 'This comment was already sent or deleted.');
      list[i] = { ...list[i], body: text, updatedAt: isoLocal(this.now()) };
      store.saveDrafts(list);
      return list[i];
    });
  }

  deleteDraft(id: string): void {
    const { store } = this.opts;
    store.withLock('drafts', () => {
      const list = store.drafts();
      if (!list.some((d) => d.id === id && this.inScope(d))) throw new HttpError(404, 'This comment was already sent or deleted.');
      store.saveDrafts(list.filter((d) => d.id !== id));
    });
  }

  /** "에이전트에게 보내기" — 모든 초안을 다음 라운드로. 라운드는 사람이 본 판(rev)을 기록한다 */
  send(rev: string): SendPayload {
    return this.sendRound(rev, () => ({ extra: [], fields: {} }));
  }

  protected mode(): ReviewMode {
    return 'worktree';
  }

  protected roundBase(c: Current): RoundBase {
    return c.from ? { kind: 'review-render', rev: c.from.id } : { kind: 'merge-base', oid: c.base.oid, label: c.base.label };
  }

  /** 그린 뒤 보내기 전에 파일이 바뀌었나 */
  protected changedSince(c: Current): boolean {
    return fingerprint(this.opts.root, c.base.oid) !== c.print;
  }

  /** 사람이 본 판이 지금 판인가 — 아니면 409와 그 문구 */
  protected checkRev(rev: string, message: string): Current {
    const c = this.current ?? this.paint();
    if (rev !== c.record.id) throw new HttpError(409, message);
    return c;
  }

  /** 초안(과 extra)을 다음 라운드로 — extra는 잠금 안에서 만든다(그 판의 초안을 보고 뺀 수를 셀 수 있게) */
  protected sendRound(rev: string, more: (c: Current) => { extra: ExtraComment[]; fields: Partial<Round> }): SendPayload {
    const c = this.checkRev(rev, 'This view is out of date — press Redraw, check your comments, and send again.');
    const { store } = this.opts;
    return store.withLock('rounds', () => {
      const drafts = this.ownDrafts().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const { extra, fields } = more(c);
      if (!drafts.length && !extra.length) throw new HttpError(400, 'Add a comment first.');
      const n = store.nextRoundNumber();
      const base = this.roundBase(c);
      const mode = this.mode();
      const fromDrafts: ExtraComment[] = drafts.map((d) => {
        const split = d.side === 'new' ? splitSuggestion(d.body) : { body: d.body, suggestion: null };
        return {
          rev: d.rev,
          path: d.path,
          side: d.side,
          start: d.start,
          end: d.end,
          kind: d.kind,
          headingPath: d.headingPath,
          author: 'you',
          quote: d.quote,
          quoteSanitized: d.quoteSanitized,
          body: split.body,
          suggestion: split.suggestion,
          base: c.from ? c.from.id : c.base.oid,
          mode,
          createdAt: d.createdAt,
        };
      });
      const comments: StoredComment[] = [...fromDrafts, ...extra].map((k, i) => ({ id: `c${i + 1}`, round: n, ...k }));
      const round: Round = {
        round: n,
        createdAt: isoLocal(this.now()),
        rev: c.record.id,
        mode,
        base,
        changedAfterRender: this.changedSince(c),
        files: c.record.shown,
        comments,
        ...fields,
      };
      store.saveRound(round, formatRound(round));
      store.saveDrafts(store.drafts().filter((d) => !this.inScope(d)));
      return { round: n, comments: comments.length };
    });
  }

  /** 새 판에서 초안 줄의 원문이 그대로면 새 판으로 옮기고, 달라졌으면 "위치 확인 필요". 이 보기에 없는 파일의 초안은 그대로 둔다 */
  protected rebaseDrafts(): void {
    const c = this.current!;
    const { store } = this.opts;
    store.withLock('drafts', () => {
      let touched = false;
      const next = store.drafts().map((d): Draft => {
        if (!this.inScope(d) || d.rev === c.record.id) return d;
        const f = c.files.find((x) => x.path === d.path);
        if (!f) return d;
        const text = d.side === 'new' ? f.newText : f.oldText;
        touched = true;
        if (text !== null && quoteOf(text, d.start, d.end) === d.quote) {
          const { moved: _moved, ...rest } = d;
          return { ...rest, rev: c.record.id };
        }
        return { ...d, moved: true };
      });
      if (touched) store.saveDrafts(next);
    });
  }
}

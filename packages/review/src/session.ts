// 리뷰 세션 — 서버 하나가 쥐는 상태: 지금 그린 판, 보기 바꾸기, 폴링(그리고 Task 10의 초안·보내기·스레드)
import { diffMarkdown, renderMarkdown, renderProseDiff, type FileDiff } from '@markdown-diff-cat/engine';
import type { EarlierItem, FilePayload, Notice, PollPayload, ViewKind, ViewPayload } from './api-types';
import { repoInfo, resolveBase, type BaseInfo } from './git';
import { isoLocal, lineLabel } from './handoff';
import { ImageIssuer } from './images';
import type { RenderRecord, SourceSide } from './records';
import type { StateStore } from './state';
import { fingerprint, latestBaseline, sinceLastFiles, snapshot, type ViewFile } from './views';

export interface SessionOptions {
  root: string;
  store: StateStore;
  baseRef?: string;
  view: ViewKind;
  now?: () => Date;
}

interface Current {
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
    return this.opts.store.drafts().length;
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
    const { store } = this.opts;
    const shown = new Set(c.files.map((f) => f.path));
    const drafts = store.drafts();
    return {
      rev: c.record.id,
      view: c.from ? 'since-last' : 'merge-base',
      baseText: c.from ? `review render ${c.from.id}` : `${c.base.oid.slice(0, 7)} (${c.base.label})`,
      sinceLastAvailable: store.rounds().length > 0 || store.marks().length > 0,
      notices: c.notices,
      files: c.rendered,
      drafts: drafts.length,
      offView: drafts.filter((d) => !shown.has(d.path)).map((d) => ({ id: d.id, path: d.path, lines: lineLabel(d.start, d.end), quote: excerpt(d.quoteSanitized) })),
      earlier: this.earlier(c.record.id),
    };
  }

  /** 다른 판에서 보낸 코멘트 — 새 위치에 다시 앵커하지 않고 목록(파일·줄·인용)으로만(스펙 §5-4) */
  private earlier(rev: string): EarlierItem[] {
    const out: EarlierItem[] = [];
    for (const r of [...this.opts.store.rounds()].reverse()) {
      if (r.rev === rev) continue;
      for (const k of r.comments) if (out.length < MAX_EARLIER) out.push({ round: r.round, path: k.path, lines: lineLabel(k.start, k.end), quote: excerpt(k.quoteSanitized) });
    }
    return out;
  }

  /** 새 렌더 판 — HEAD가 움직였을 수 있어 저장소 정보부터 다시 읽는다 */
  protected paint(): Current {
    const { root, store } = this.opts;
    const base = resolveBase(repoInfo(root), this.baseRef);
    const snap = snapshot(root, base.oid);
    const notices: Notice[] = [];
    let from: RenderRecord | null = null;
    if (this.viewKind === 'since-last') {
      const baseline = latestBaseline(store.rounds(), store.marks());
      from = baseline ? store.loadRender(baseline.rev) : null;
      // 라운드·mark가 없으면 "아직 없음", 있는데 그 판 파일이 없으면(손으로 지움 등) "지난 리뷰 판이 없다"(스펙 §5-4)
      if (!from) notices.push(baseline ? { key: 'reviewNoticeBaselineMissing', subs: [baseline.rev] } : { key: 'reviewNoticeNoBaseline' });
    }
    if (base.headIsBase && !from) notices.push({ key: 'reviewNoticeHeadIsBase' });
    if (base.upstream && !this.baseRef) notices.push({ key: 'reviewNoticeUpstream', subs: [base.upstream] });
    for (const s of snap.skipped) notices.push({ key: 'reviewNoticeSkipped', subs: [s.path] });
    const files = from ? sinceLastFiles(root, from, snap) : snap.viewFiles;
    const record: RenderRecord = {
      id: store.newRenderId(),
      createdAt: isoLocal(this.now()),
      mode: 'worktree',
      baseOid: base.oid,
      baseLabel: base.label,
      view: from ? { kind: 'since-last', from: from.id } : { kind: 'merge-base' },
      files: snap.files,
      shown: files.map((f) => f.path),
    };
    store.saveRender(record);
    // 지난 리뷰 이후 보기의 옛 쪽 이미지는 판이 담지 않으므로 그 판의 기준 커밋에서 읽는다
    const oldOid = from ? from.baseOid : base.oid;
    const diffs = new Map<string, FileDiff>();
    const rendered = files.map((f) => this.renderFile(f, record.id, oldOid, diffs));
    const previous = this.current?.record.id;
    this.current = { record, base, from, files, diffs, rendered, notices, print: fingerprint(root, base.oid) };
    this.images.forgetExcept(previous ? [record.id, previous] : [record.id]);
    store.pruneRenders(KEEP_RENDERS, [record.id]);
    return this.current;
  }

  private renderFile(f: ViewFile, rev: string, oldOid: string, diffs: Map<string, FileDiff>): FilePayload {
    const out: FilePayload = { path: f.path, ...(f.oldPath ? { oldPath: f.oldPath } : {}), status: f.status, html: '', newText: f.newText, notices: [] };
    try {
      const diff = diffMarkdown({ oldText: f.oldText, newText: f.newText, path: f.path, ...(f.oldPath ? { oldPath: f.oldPath } : {}) });
      diffs.set(f.path, diff);
      out.notices = diff.notices.map((n) => ({ kind: n.kind }));
      out.html = renderProseDiff(diff, {
        rev,
        imageId: (side, p) => this.images.issue(rev, side === 'old' ? { kind: 'git', oid: oldOid, path: p } : { kind: 'worktree', path: p }),
      });
    } catch (e) {
      out.error = e instanceof Error ? e.message : String(e);
    }
    return out;
  }
}

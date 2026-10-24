// PR 모드의 세션(스펙 §6) — 받은 git 객체로 그리고, GitHub 스레드를 블록 아래에 두고, 초안은 사람이 누를 때 내 보류 중 리뷰에만 넣는다.
// 작업 트리 세션과 저장 폴더를 같이 쓰되 초안은 "pr:<owner>/<repo>#<n>" 범위로 나눈다
import { randomBytes } from 'node:crypto';
import type { ReviewThread } from '../../../src/types';
import type { DraftListItem, DraftPlace, PollPayload, PushPayload, SendPayload, ThreadsPayload, ViewPayload } from './api-types';
import { HttpError } from './errors';
import type { Gh } from './gh';
import { addItems, currentHead, loadThreads, pendingReviewId, prFileInfos, type PrThreads } from './github';
import { isoLocal, lineLabel } from './handoff';
import { planUpload, type UploadItem } from './hunks';
import { checkoutWarning, prFiles } from './pr';
import { sanitizeQuote } from './quote';
import type { Draft, Mark, PrRef, ReviewMode, Round, RoundBase, SourceSide } from './records';
import { ReviewSession, cleanBody, leafAt, quoteOf, toComment, type Current, type ExtraComment, type SessionOptions, type Source } from './session';

export interface PrSessionOptions extends SessionOptions {
  pr: PrRef;
  gh: Gh;
  /** 다시 그리기 — PR을 다시 받아(새 커밋) 새 PrRef를 돌려준다. 없으면 받은 것 그대로 다시 그린다 */
  refetch?: () => Promise<PrRef>;
}

export const prLabel = (pr: Pick<PrRef, 'owner' | 'repo' | 'number'>): string => `${pr.owner}/${pr.repo}#${pr.number}`;

export const STALE_DRAFT = 'The lines changed since you wrote this — delete it and comment again in the right place.';

const placeOf = (d: Draft, item: UploadItem): DraftPlace => {
  if (item.kind === 'line') return item.start === d.start && item.end === d.end ? { kind: 'line' } : { kind: 'trimmed', lines: lineLabel(item.start, item.end) };
  if (item.kind === 'error') return { kind: 'error', error: item.error };
  return { kind: item.kind };
};

export class PrSession extends ReviewSession {
  private pr: PrRef;
  private readonly gh: Gh;
  private readonly refetch: (() => Promise<PrRef>) | undefined;
  /** 판마다 한 번 읽는 GitHub 스레드(실패하면 비워 다음에 다시) */
  private ghThreads: { rev: string; promise: Promise<PrThreads> } | null = null;
  /** 다 읽은 스레드 — 답글 초안이 그 스레드의 쪽·줄을 찾는다 */
  private loaded: { rev: string; threads: PrThreads } | null = null;

  constructor(opts: PrSessionOptions) {
    super(opts);
    this.pr = opts.pr;
    this.gh = opts.gh;
    this.refetch = opts.refetch;
  }

  prRef(): PrRef {
    return this.pr;
  }

  protected scope(): string {
    return `pr:${prLabel(this.pr)}`;
  }

  protected mode(): ReviewMode {
    return 'pr';
  }

  protected ownRound(r: Round): boolean {
    return r.base.kind === 'pr' && r.base.label === prLabel(this.pr);
  }

  /** PR 모드에는 --since-last가 없다(스펙 §6-4) */
  protected ownMark(_m: Mark): boolean {
    return false;
  }

  protected source(): Source {
    const { root } = this.opts;
    const pr = this.pr;
    const files = prFiles(root, pr);
    const label = `merge-base of ${prLabel(pr)}`;
    const recordFiles: Record<string, string | null> = {};
    for (const f of files) {
      if (f.oldPath) recordFiles[f.oldPath] = null;
      recordFiles[f.path] = f.newText;
    }
    const warn = checkoutWarning(root, pr, files.map((f) => f.path));
    this.ghThreads = null;
    this.loaded = null;
    return {
      base: { oid: pr.mergeBase, label, ref: null, headIsBase: false, upstream: null },
      from: null,
      files,
      recordFiles,
      notices: warn ? [{ key: 'reviewNoticePrCheckout', subs: [String(pr.number)] }] : [],
      oldOid: pr.mergeBase,
      newImage: (rev, p) => this.images.issue(rev, { kind: 'git', oid: pr.headOid, path: p }),
      record: { mode: 'pr', pr },
      print: '',
    };
  }

  protected payload(c: Current): ViewPayload {
    const { owner, repo, number, url, title, headOid } = this.pr;
    return { ...super.payload(c), sinceLastAvailable: false, pr: { owner, repo, number, url, title, head: headOid.slice(0, 7) } };
  }

  /** 작업 트리를 보지 않는다 — 판이 바뀌었는지만 */
  poll(rev: string): PollPayload {
    return { changed: false, superseded: this.current?.record.id !== rev };
  }

  protected changedSince(_c: Current): boolean {
    return false;
  }

  protected roundBase(_c: Current): RoundBase {
    return { kind: 'pr', oid: this.pr.mergeBase, head: this.pr.headOid, label: prLabel(this.pr) };
  }

  private threadsOf(rev: string): Promise<PrThreads> {
    if (this.ghThreads?.rev !== rev) {
      const promise = loadThreads(this.gh, this.pr, (md) => this.html(md));
      this.ghThreads = { rev, promise };
      promise.then(
        (threads) => {
          if (this.ghThreads?.promise === promise) this.loaded = { rev, threads };
        },
        () => {
          if (this.ghThreads?.promise === promise) this.ghThreads = null;
        },
      );
    }
    return this.ghThreads.promise;
  }

  private findThread(id: string): { path: string; thread: ReviewThread } | null {
    const c = this.current;
    if (!c || this.loaded?.rev !== c.record.id) return null;
    for (const [path, list] of this.loaded.threads.byPath) {
      const thread = list.find((t) => t.id === id);
      if (thread) return { path, thread };
    }
    return null;
  }

  /** GitHub 스레드(내 답글 초안을 끝에) + 줄 초안. GitHub를 못 읽어도 초안은 보이고 이유를 알린다 */
  async apiThreads(path: string): Promise<ThreadsPayload> {
    const c = this.current ?? this.paint();
    const local = this.threads(path);
    let t: PrThreads;
    try {
      t = await this.threadsOf(c.record.id);
    } catch (e) {
      return { ...local, githubError: e instanceof Error ? e.message : String(e) };
    }
    const replies = this.ownDrafts().filter((d) => d.replyTo);
    const gh = (t.byPath.get(path) ?? []).map((th) => ({
      ...th,
      comments: [...th.comments, ...replies.filter((d) => d.replyTo === th.id).map((d) => toComment(d.id, d.body, this.html(d.body), true))],
    }));
    const github: Record<string, { others: number }> = {};
    for (const th of gh) {
      const others = t.others.get(th.id);
      if (others) github[th.id] = { others };
    }
    return { threads: [...gh, ...local.threads], badges: local.badges, hidden: t.hidden.get(path) ?? 0, github };
  }

  /** 답글 초안은 그 GitHub 스레드의 쪽·줄로(파일 전체 스레드는 줄 0) */
  addDraft(input: Parameters<ReviewSession['addDraft']>[0]): Draft {
    if (!input.replyTo) return super.addDraft(input);
    const c = this.checkRev(input.rev, 'This view is out of date — press Redraw and comment again.');
    const hit = this.findThread(input.replyTo);
    if (!hit) throw new HttpError(400, 'This thread is not on the pull request any more — press Redraw.');
    const body = cleanBody(input.body);
    const { thread } = hit;
    const side: SourceSide = thread.side === 'left' ? 'old' : 'new';
    const file = c.files.find((f) => f.path === hit.path);
    const text = file ? (side === 'new' ? file.newText : file.oldText) : null;
    const line = thread.subject === 'line';
    const quote = line && text !== null ? quoteOf(text, thread.start, thread.end) : '';
    const diff = c.diffs.get(hit.path);
    const leaf = line && diff ? leafAt(diff, side, thread.start, thread.end) : { kind: line ? 'paragraph' : 'file', headingPath: [] };
    const at = isoLocal(this.now());
    const draft: Draft = {
      id: `d${randomBytes(4).toString('hex')}`,
      rev: c.record.id,
      path: hit.path,
      side,
      start: line ? thread.start : 0,
      end: line ? thread.end : 0,
      body,
      kind: leaf.kind,
      headingPath: leaf.headingPath,
      quote,
      quoteSanitized: sanitizeQuote(quote, { code: leaf.kind === 'code' }),
      createdAt: at,
      updatedAt: at,
      scope: this.scope(),
      replyTo: thread.id,
    };
    const { store } = this.opts;
    store.withLock('drafts', () => store.saveDrafts([...store.drafts(), draft]));
    return draft;
  }

  /** 새 커밋을 받아 다시 그린다(refetch가 있으면) */
  async apiRedraw(): Promise<ViewPayload> {
    if (this.refetch) this.pr = await this.refetch();
    return this.draw();
  }

  /** 에이전트에게 보내기 — 초안 + 사람이 고른 GitHub 스레드의 코멘트. 남의 것은 넣은 수·뺀 수를 밝힌다(스펙 §6-4·§7-4) */
  async apiSend(rev: string, include: string[]): Promise<SendPayload> {
    const c = this.checkRev(rev, 'This view is out of date — press Redraw, check your comments, and send again.');
    const t = include.length ? await this.threadsOf(c.record.id) : null;
    const extra: ExtraComment[] = [];
    let othersIn = 0;
    for (const id of include) {
      const hit = this.findThread(id);
      if (!hit) throw new HttpError(400, 'A selected thread is not on the pull request any more — press Redraw.');
      const { thread } = hit;
      const side: SourceSide = thread.side === 'left' ? 'old' : 'new';
      const file = c.files.find((f) => f.path === hit.path);
      const text = file ? (side === 'new' ? file.newText : file.oldText) : null;
      const line = thread.subject === 'line';
      const quote = line && text !== null ? quoteOf(text, thread.start, thread.end) : '';
      const diff = c.diffs.get(hit.path);
      const leaf = line && diff ? leafAt(diff, side, thread.start, thread.end) : { kind: line ? 'paragraph' : 'file', headingPath: [] };
      for (const k of thread.comments) {
        const mine = k.author === t!.viewer;
        if (!mine) othersIn++;
        extra.push({
          rev: c.record.id,
          path: hit.path,
          side,
          start: line ? thread.start : 0,
          end: line ? thread.end : 0,
          kind: leaf.kind,
          headingPath: leaf.headingPath,
          author: mine ? 'you' : `@${k.author}`,
          quote,
          quoteSanitized: sanitizeQuote(quote, { code: leaf.kind === 'code' }),
          body: k.body,
          suggestion: null,
          base: this.pr.mergeBase,
          mode: 'pr',
          createdAt: isoLocal(this.now()),
        });
      }
    }
    // 뺀 수 — 화면에 보이는 남의 코멘트 가운데 넣지 않은 것. 스레드를 아직 안 읽었으면 읽어서 센다
    const all = t ?? (await this.threadsOf(c.record.id).catch(() => null));
    // 화면에 그린 md 파일의 스레드만 — md가 아닌 파일의 남의 코멘트는 사람이 고를 수 없었다
    const shownThreads = all ? c.record.shown.flatMap((p) => all.byPath.get(p) ?? []) : [];
    const othersAll = all ? shownThreads.reduce((n, th) => n + (all.others.get(th.id) ?? 0), 0) : 0;
    const warning = checkoutWarning(this.opts.root, this.pr, c.record.shown);
    return this.sendRound(rev, () => ({ extra, fields: { excluded: Math.max(0, othersAll - othersIn), ...(warning ? { warning } : {}) } }));
  }

  /** 다시 그린 판에서 줄이 바뀐 초안 — 옛 줄 번호로 넣으면 엉뚱한 줄에 간다 */
  private isStale(d: Draft, c: Current): boolean {
    return d.moved === true || d.rev !== c.record.id;
  }

  /** 확인 상자 — 초안마다 어디에 들어가나. GitHub를 못 읽으면 미리보기 없이 목록만 */
  async apiDrafts(): Promise<{ drafts: DraftListItem[] }> {
    const c = this.current ?? this.paint();
    const list = this.draftList();
    let files;
    try {
      files = await prFileInfos(this.gh, this.pr);
    } catch {
      return { drafts: list };
    }
    const drafts = this.ownDrafts();
    const plan = new Map(planUpload(drafts.filter((d) => !this.isStale(d, c)), files).map((i) => [i.draft, i]));
    return {
      drafts: list.map((item) => {
        const d = drafts.find((x) => x.id === item.id)!;
        const p = plan.get(item.id);
        return { ...item, place: p ? placeOf(d, p) : { kind: 'stale' } };
      }),
    };
  }

  /** 보류 중 리뷰에 넣기(스펙 §6-3) — 넣기 직전 head를 다시 읽고, GitHub hunk로 줄을 맞춰 하나씩. 성공한 초안만 지운다. 줄이 바뀐 초안은 넣지 않는다 */
  async apiPush(rev: string): Promise<PushPayload> {
    const c = this.checkRev(rev, 'This view is out of date — press Redraw, check your comments, and add them again.');
    const drafts = this.ownDrafts().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (!drafts.length) throw new HttpError(400, 'Add a comment first.');
    const pr = this.pr;
    const fresh = drafts.filter((d) => !this.isStale(d, c));
    const results: Array<{ draft: string; error?: string }> = drafts.filter((d) => this.isStale(d, c)).map((d) => ({ draft: d.id, error: STALE_DRAFT }));
    if (fresh.length) {
      if ((await currentHead(this.gh, pr)) !== pr.headOid) {
        throw new HttpError(409, `New commits were pushed to ${prLabel(pr)} after this view — press Redraw, check your comments, and add them again.`);
      }
      const items = planUpload(fresh, await prFileInfos(this.gh, pr));
      results.push(...(await addItems(this.gh, await pendingReviewId(this.gh, pr), items)));
    }
    const added = new Set(results.filter((r) => !r.error).map((r) => r.draft));
    const { store } = this.opts;
    store.withLock('drafts', () => store.saveDrafts(store.drafts().filter((d) => !added.has(d.id))));
    this.ghThreads = null;
    this.loaded = null;
    const failed = results
      .filter((r) => r.error)
      .map((r) => {
        const d = drafts.find((x) => x.id === r.draft)!;
        return { id: d.id, path: d.path, lines: d.start === 0 ? 'whole file' : lineLabel(d.start, d.end), error: r.error! };
      });
    return { added: added.size, failed, url: `${pr.url}/files` };
  }
}

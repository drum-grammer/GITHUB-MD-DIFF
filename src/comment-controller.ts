/**
 * 렌더링 보기에서 코멘트 달기의 화면 동작 — 블록에 마우스를 올리면 "+"가 나오고, 누르거나 다른 블록까지 끌면 그 원문 줄에 코멘트 상자를 연다.
 * 스레드는 블록 아래(줄 코멘트)·파일 맨 위(파일 전체·자리를 못 찾은 것)에 둔다.
 * 요청은 모른다 — 스레드 읽기·원문 줄 연결·올리기는 백엔드(CommentBackend)가 맡는다. 확장은 comments.ts의 GitHub 백엔드, 로컬 페이지는 자기 백엔드를 넘긴다
 */
import { refold } from './fold';
import { spanOf, type BlockTarget } from './dom-blocks';
import {
  FILE_THREADS,
  FORM,
  NOTICE,
  THREAD,
  UNPLACED,
  addButton,
  commentForm,
  fileThreadsBox,
  formLabel,
  placeBox,
  replyDraft,
  threadBox,
  topLevel,
  unplacedBox,
  type Preview,
  type ThreadHandlers,
} from './comment-ui';
import { t } from './i18n';
import { MDF_ATTR, PIN_ATTR } from './prose-markup';
import { mergedRow, originRow } from './table-render';
import type { PostMode, ReviewComment, ReviewThread } from './types';

const LOG = '[github-md-diff]';
/** 코멘트 기능이 붙은 렌더링 diff(.prose-diff) — "+" 버튼 자리를 잡는 기준(styles.css) */
export const HOST_ATTR = 'data-mdf-comments';
const SELECTED = 'mdf-selected';

export interface CommentState {
  threads: ReviewThread[];
  pendingReview: boolean;
}

export interface CommentBackend {
  /** 붙을 때 한 번, 그리고 올리기·답글·해결·편집·삭제가 성공한 뒤마다 — 지금 스레드. 실패하면 던진다 */
  load(): Promise<CommentState>;
  /** 블록 → 원문 줄. 처음 필요할 때(마우스를 올리거나 스레드를 그릴 때) 한 번. 실패하면 던지고, 다음에 다시 불린다 */
  mapping(body: HTMLElement): Promise<Map<HTMLElement, BlockTarget>>;
  /** 제안 버튼에 넣을 원래 줄(오른쪽 쪽만, mapping 뒤에 불린다). 없으면 undefined */
  suggestion(span: BlockTarget): string | undefined;
  post(span: BlockTarget, text: string, mode: PostMode): Promise<void>;
  reply?(thread: ReviewThread, text: string, mode: PostMode): Promise<void>;
  resolve?(thread: ReviewThread, resolved: boolean): Promise<void>;
  edit?(comment: ReviewComment, text: string): Promise<void>;
  remove?(comment: ReviewComment): Promise<void>;
  preview?(text: string): Promise<string>;
  /** 상자 모양. 확장은 생략(기본값) */
  form?: { buttons?: 'github' | 'local'; showAvatar?: boolean; singleLabel?: string };
  /** 처음부터 스레드가 있어야 하는 파일인가(확장: 원문 보기에 스레드가 있었다). load가 실패하거나 스레드를 못 그리면 unavailable()을 부른다 */
  expectThreads?: boolean;
  unavailable?(): void;
}

interface Hit {
  el: HTMLElement;
  target: BlockTarget;
}

export class CommentController {
  private mapping: Map<HTMLElement, BlockTarget> | null = null;
  private loading: Promise<Map<HTMLElement, BlockTarget> | null> | null = null;
  private state: CommentState | null = null;
  private readonly host: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly preview: Preview | undefined;
  private hovered: HTMLElement | null = null;
  private drag: { side: BlockTarget['side']; from: HTMLElement; to: HTMLElement } | null = null;
  /** 열린 코멘트 상자 → 그 상자가 가리키는 블록. 상자가 열려 있는 동안 노란 음영을 둔다(GitHub 원문 보기처럼) */
  private readonly formBlocks = new Map<HTMLElement, HTMLElement[]>();
  private disposed = false;
  /** 다시 그리기 세대 — 겹친 load·줄 연결 기다림 가운데 마지막에 시작한 것만 그린다(빠른 백엔드에서 refresh 둘이 같은 틱에 겹치면 상자가 두 번 그려졌다) */
  private drawGen = 0;

  constructor(
    private readonly body: HTMLElement,
    private readonly backend: CommentBackend,
  ) {
    this.preview = backend.preview?.bind(backend);
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
        console.warn(LOG, e);
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

  /** 지금 스레드를 다시 읽어 다시 그린다. 실패하면 콘솔에만 남긴다(그리던 것은 그대로) */
  async refresh(): Promise<void> {
    const gen = ++this.drawGen;
    try {
      const s = await this.backend.load();
      if (gen === this.drawGen) await this.showThreads(s, gen);
    } catch (e) {
      console.warn(LOG, e);
    }
  }

  /** 스레드가 있으면 바로 원문 줄을 연결해 붙인다. 없으면 마우스를 올릴 때까지 기다린다 */
  private async start(): Promise<void> {
    const gen = ++this.drawGen;
    let s: CommentState;
    try {
      s = await this.backend.load();
    } catch (e) {
      console.warn(LOG, e);
      if (this.backend.expectThreads && !this.disposed) this.backend.unavailable?.();
      return;
    }
    this.state = s;
    if (this.disposed) return;
    if (s.threads.length) {
      if (gen === this.drawGen) await this.showThreads(s, gen);
    } else if (this.backend.expectThreads) this.backend.unavailable?.(); // 스레드가 있어야 하는데 여기서 못 찾았다(파일 코멘트 등)
  }

  /** 실패하면 다음에 다시 시도한다(잠깐의 요청 실패로 "+"가 영영 안 나오지 않게) */
  private ensureMapping(): Promise<Map<HTMLElement, BlockTarget> | null> {
    // 백엔드가 동기로 던져도 거부된 약속으로 받는다(처음 그리기에서 unhandled rejection이 되고 unavailable이 안 불렸다)
    this.loading ??= Promise.resolve()
      .then(() => this.backend.mapping(this.body))
      .then(
        (m) => (this.mapping = m),
        (e: unknown) => {
          console.warn(LOG, e);
          this.loading = null;
          return null;
        },
      );
    return this.loading;
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
    const look = this.backend.form ?? {};
    const form = commentForm(
      this.body.ownerDocument,
      {
        label: formLabel(span),
        pendingReview: this.state?.pendingReview ?? false,
        singleLabel: look.singleLabel ?? t('commentSingle'),
        preview: this.preview,
        suggestion: this.backend.suggestion(span),
        buttons: look.buttons,
        showAvatar: look.showAvatar,
      },
      {
        onSubmit: async (text, mode) => {
          await this.backend.post(span, text, mode);
          await this.refresh();
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

  /** 성공하면 스레드를 다시 그린다 — 실패는 그대로 던져 상자가 이유를 보이게 */
  private andRefresh<A extends unknown[]>(run: ((...args: A) => Promise<void>) | undefined): ((...args: A) => Promise<void>) | undefined {
    if (!run) return undefined;
    return async (...args: A) => {
      await run(...args);
      await this.refresh();
    };
  }

  private async showThreads(s: CommentState, gen: number): Promise<void> {
    this.state = s;
    const threads = s.threads;
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
    if (this.disposed || gen !== this.drawGen) return;
    if (!mapping) {
      this.backend.unavailable?.();
      return;
    }
    const doc = this.body.ownerDocument;
    const b = this.backend;
    const look = b.form;
    const handlers: ThreadHandlers = {
      // 백엔드에 없는 동작은 넘기지 않는다 — 그 버튼은 그려지지 않는다(comment-ui)
      onReply: this.andRefresh(b.reply?.bind(b)),
      onResolve: this.andRefresh(b.resolve?.bind(b)),
      onEdit: this.andRefresh(b.edit?.bind(b)),
      onDelete: this.andRefresh(b.remove?.bind(b)),
      preview: this.preview,
      // 파일 전체 스레드는 줄이 없어 제안을 못 단다
      suggestion: (th: ReviewThread) => (th.subject === 'line' ? b.suggestion(th) : undefined),
      form: look ? { buttons: look.buttons, showAvatar: look.showAvatar } : undefined,
    };
    const placed: Array<{ block: HTMLElement; box: HTMLElement }> = [];
    const unplaced: HTMLElement[] = [];
    const wholeFile: HTMLElement[] = [];
    for (const th of threads) {
      const box = threadBox(doc, th, s.pendingReview, handlers, drafts.get(th.id) ?? null);
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
}

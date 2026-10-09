/** 코멘트 상자·스레드 상자 같은 화면 조각 — 요청은 모르고, 누르면 받은 함수를 부른다 */
import type { PostMode, ReviewComment, ReviewThread } from './github-api';
import type { BlockTarget } from './dom-blocks';
import { t } from './i18n';
import { CHANGE_WRAPPER, MDF_ATTR } from './selectors';

export const ADD = 'add-comment';
export const FORM = 'comment-form';
export const THREAD = 'thread';
export const UNPLACED = 'threads-unplaced';
export const FILE_THREADS = 'threads-file';
export const NOTICE = 'comment-notice';
const BOX = `[${MDF_ATTR}="${THREAD}"], [${MDF_ATTR}="${FORM}"]`;
const DANGEROUS = 'script, style, iframe, object, embed, link, meta, base, form';
const URL_ATTRS = /^(href|src|xlink:href|action|formaction|srcset)$/i;

/** 브라우저가 읽는 그대로(탭·줄바꿈이 낀 javascript:도) 풀어서 http·https·mailto·상대 주소만 */
function safeUrl(value: string): boolean {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(value, 'https://github.com/').protocol);
  } catch {
    return false;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

function button(doc: Document, label: string, className = 'mdf-btn'): HTMLButtonElement {
  const b = el(doc, 'button', className, label);
  b.type = 'button';
  return b;
}

export function lineLabel(target: Pick<BlockTarget, 'side' | 'start' | 'end'> & { subject?: 'line' | 'file' }): string {
  if (target.subject === 'file') return t('wholeFile');
  const lines = target.start >= target.end ? t('lineOne', [target.end]) : t('lineRange', [target.start, target.end]);
  return target.side === 'left' ? `${lines} · ${t('sideOriginal')}` : lines;
}

/** GitHub가 준 코멘트 HTML(GitHub가 이미 정리한 것)을 한 번 더 걸러 붙인다 — 스크립트·이벤트 속성·javascript: 주소는 뺀다 */
export function safeFragment(doc: Document, html: string): DocumentFragment {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  for (const n of parsed.querySelectorAll(DANGEROUS)) n.remove();
  for (const node of parsed.body.querySelectorAll('*')) {
    for (const a of [...node.attributes]) {
      if (/^on/i.test(a.name) || (URL_ATTRS.test(a.name) && !safeUrl(a.value))) node.removeAttribute(a.name);
    }
  }
  const frag = doc.createDocumentFragment();
  frag.append(...[...parsed.body.childNodes].map((n) => doc.importNode(n, true)));
  return frag;
}

export function addButton(doc: Document): HTMLButtonElement {
  const b = button(doc, '+', 'mdf-add');
  b.setAttribute(MDF_ATTR, ADD);
  b.setAttribute('aria-label', t('commentAdd'));
  b.title = t('commentAddHint');
  b.hidden = true;
  return b;
}

export interface FormOptions {
  label: string;
  /** 보류 중인 리뷰가 있으면 리뷰에 넣기만 보인다 */
  pendingReview: boolean;
  singleLabel: string;
  /** 있으면 쓰기·미리보기 탭을 둔다 — 글을 GitHub가 렌더링한 HTML로 바꿔 준다 */
  preview?: Preview;
}

/** 글 → GitHub가 렌더링한 HTML */
export type Preview = (text: string) => Promise<string>;

interface Editor {
  wrap: HTMLElement;
  area: HTMLTextAreaElement;
}

/**
 * 글 입력란. `preview`가 있으면 위에 쓰기·미리보기 탭 — 미리보기는 GitHub에 렌더링을 맡겨(멘션·이슈 링크까지 같게)
 * 입력란 자리에 보여 준다. 실패하면 그 자리에 이유를 쓴다
 */
function editor(doc: Document, initial: string, preview?: Preview): Editor {
  const wrap = el(doc, 'div', 'mdf-editor');
  const area = el(doc, 'textarea', 'mdf-textarea');
  area.placeholder = t('commentPlaceholder');
  area.rows = 4;
  area.value = initial;
  if (!preview) {
    wrap.append(area);
    return { wrap, area };
  }
  const tabs = el(doc, 'div', 'mdf-tabs');
  tabs.setAttribute('role', 'tablist');
  const write = button(doc, t('tabWrite'), 'mdf-tab');
  const show = button(doc, t('tabPreview'), 'mdf-tab');
  // markdown-body를 붙이지 않는다 — 렌더링 본문(.prose-diff .markdown-body)이 둘로 보여 본문을 찾는 코드가 헷갈린다. 글꼴·목록 모양은 둘러싼 본문에서 물려받는다
  const pane = el(doc, 'div', 'mdf-preview');
  pane.hidden = true;
  let seq = 0;
  const select = (previewing: boolean) => {
    for (const [b, on] of [[write, !previewing], [show, previewing]] as const) {
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(on));
    }
    area.hidden = previewing;
    pane.hidden = !previewing;
  };
  write.addEventListener('click', () => {
    select(false);
    area.focus();
  });
  show.addEventListener('click', async () => {
    select(true);
    const text = area.value.trim();
    const mine = ++seq;
    if (!text) {
      pane.textContent = t('previewEmpty');
      return;
    }
    pane.textContent = t('previewLoading');
    try {
      const html = await preview(text);
      if (mine === seq) pane.replaceChildren(safeFragment(doc, html));
    } catch (e) {
      if (mine === seq) pane.textContent = e instanceof Error ? e.message : String(e);
    }
  });
  select(false);
  tabs.append(write, show);
  wrap.append(tabs, area, pane);
  return { wrap, area };
}

export interface FormHandlers {
  /** 실패하면 사람에게 보일 문구를 담은 Error를 던진다 */
  onSubmit(text: string, mode: PostMode): Promise<void>;
  onCancel(): void;
}

/** 코멘트 입력 상자. ⌘/Ctrl+Enter는 바로 올리기(보류 중인 리뷰가 있으면 리뷰에 넣기) */
export function commentForm(doc: Document, opt: FormOptions, h: FormHandlers): HTMLElement {
  const box = el(doc, 'div', 'mdf-comment-form');
  box.setAttribute(MDF_ATTR, FORM);
  const label = el(doc, 'div', 'mdf-comment-label', opt.label);
  const { wrap, area } = editor(doc, '', opt.preview);
  const error = el(doc, 'div', 'mdf-comment-error');
  error.hidden = true;
  const actions = el(doc, 'div', 'mdf-comment-actions');
  const cancel = button(doc, t('cancel'));
  const single = opt.pendingReview ? null : button(doc, opt.singleLabel);
  const review = button(doc, opt.pendingReview ? t('commentReviewAdd') : t('commentReviewStart'), 'mdf-btn mdf-btn-primary');
  actions.append(cancel, ...(single ? [single] : []), review);
  box.append(label, wrap, error, actions);

  const buttons = [cancel, single, review].filter((b): b is HTMLButtonElement => b !== null);
  const submit = async (mode: PostMode, b: HTMLButtonElement) => {
    if (box.dataset.busy) return; // 올리는 중 — ⌘Enter를 또 눌러도 한 번만
    const text = area.value.trim();
    if (!text) {
      area.focus();
      return;
    }
    const idle = b.textContent;
    box.dataset.busy = '1';
    for (const x of buttons) x.disabled = true;
    area.readOnly = true;
    b.textContent = t('posting');
    error.hidden = true;
    try {
      await h.onSubmit(text, mode);
    } catch (e) {
      error.textContent = e instanceof Error ? e.message : String(e);
      error.hidden = false;
      b.textContent = idle;
    } finally {
      delete box.dataset.busy;
      for (const x of buttons) x.disabled = false;
      area.readOnly = false;
    }
  };
  cancel.addEventListener('click', () => h.onCancel());
  single?.addEventListener('click', () => void submit('single', single));
  review.addEventListener('click', () => void submit('review', review));
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void (single ? submit('single', single) : submit('review', review));
    } else if (e.key === 'Escape' && !area.value.trim()) {
      e.preventDefault();
      h.onCancel();
    }
  });
  return box;
}

export interface ThreadHandlers {
  onReply(thread: ReviewThread, text: string, mode: PostMode): Promise<void>;
  onResolve(thread: ReviewThread, resolved: boolean): Promise<void>;
  /** 내 코멘트 고치기·지우기(성공하면 스레드를 다시 그린다) */
  onEdit(comment: ReviewComment, text: string): Promise<void>;
  onDelete(comment: ReviewComment): Promise<void>;
  preview?: Preview;
}

/** 지우기는 두 번 눌러야 — 처음 누르면 "정말 삭제"로 바뀌고 4초 안에 다시 누를 때만 지운다 */
const CONFIRM_MS = 4000;

function commentView(doc: Document, c: ReviewComment, h?: ThreadHandlers): HTMLElement {
  const item = el(doc, 'div', 'mdf-comment');
  const meta = el(doc, 'div', 'mdf-comment-meta');
  meta.append(el(doc, 'strong', '', c.author || '?'));
  if (c.pending) {
    const p = el(doc, 'span', 'mdf-pending', t('pending'));
    p.title = t('pendingHint');
    meta.append(p);
  }
  if (c.url) {
    const a = el(doc, 'a', 'mdf-comment-link', t('viewOnGitHub'));
    a.href = c.url;
    meta.append(a);
  }
  const body = el(doc, 'div', 'mdf-comment-body');
  if (c.bodyHTML) body.append(safeFragment(doc, c.bodyHTML));
  else {
    body.textContent = c.body;
    body.classList.add('mdf-plain');
  }
  item.append(meta, body);
  if (h && (c.canEdit || c.canDelete)) item.append(...ownActions(doc, c, h, meta, body));
  return item;
}

/** 내 코멘트의 편집·삭제 — 메타 줄 오른쪽 작은 버튼. 편집은 본문 자리에 입력란을 연다. 고친 상자를 함께 돌려준다 */
function ownActions(doc: Document, c: ReviewComment, h: ThreadHandlers, meta: HTMLElement, body: HTMLElement): HTMLElement[] {
  const error = el(doc, 'div', 'mdf-comment-error');
  error.hidden = true;
  const fail = (e: unknown) => {
    error.textContent = e instanceof Error ? e.message : String(e);
    error.hidden = false;
  };
  const tools = el(doc, 'span', 'mdf-comment-tools');
  if (c.canEdit) {
    const edit = button(doc, t('edit'), 'mdf-link');
    edit.addEventListener('click', () => {
      const { wrap, area } = editor(doc, c.body, h.preview);
      const form = el(doc, 'div', 'mdf-comment-edit');
      const actions = el(doc, 'div', 'mdf-comment-actions');
      const cancel = button(doc, t('cancel'));
      const save = button(doc, t('save'), 'mdf-btn mdf-btn-primary');
      actions.append(cancel, save);
      form.append(wrap, actions);
      const close = () => {
        form.remove();
        body.hidden = false;
        tools.hidden = false;
      };
      cancel.addEventListener('click', close);
      save.addEventListener('click', async () => {
        const text = area.value.trim();
        if (!text) return area.focus();
        save.disabled = cancel.disabled = true;
        error.hidden = true;
        try {
          await h.onEdit(c, text);
          close();
        } catch (e) {
          fail(e);
          save.disabled = cancel.disabled = false;
        }
      });
      area.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          save.click();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          close();
        }
      });
      body.hidden = true;
      tools.hidden = true;
      body.after(form);
      area.focus();
    });
    tools.append(edit);
  }
  if (c.canDelete) {
    const del = button(doc, t('delete'), 'mdf-link');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reset = () => {
      del.textContent = t('delete');
      del.classList.remove('mdf-danger');
    };
    del.addEventListener('click', async () => {
      if (!del.classList.contains('mdf-danger')) {
        del.textContent = t('deleteConfirm');
        del.classList.add('mdf-danger');
        timer = setTimeout(reset, CONFIRM_MS);
        return;
      }
      clearTimeout(timer);
      del.disabled = true;
      error.hidden = true;
      try {
        await h.onDelete(c);
      } catch (e) {
        fail(e);
        del.disabled = false;
        reset();
      }
    });
    tools.append(del);
  }
  meta.append(tools);
  return [error];
}

/** 열려 있는 답글 상자의 쓰다 만 글(올리는 중인 것은 빼고) — 스레드를 다시 그릴 때 되살린다 */
export function replyDraft(box: Element): string | null {
  const form = box.querySelector<HTMLElement>('.mdf-comment-form');
  const text = form?.querySelector('textarea')?.value;
  return form && !form.dataset.busy && text !== undefined ? text : null;
}

/** 스레드 하나. 해결된 스레드는 접어 둔다. `draft`가 있으면 답글 상자를 그 글로 열어 둔다 */
export function threadBox(doc: Document, thread: ReviewThread, pendingReview: boolean, h: ThreadHandlers, draft: string | null = null): HTMLElement {
  const box = el(doc, 'div', 'mdf-thread');
  box.setAttribute(MDF_ATTR, THREAD);
  box.dataset.threadId = thread.id;
  box.dataset.resolved = String(thread.resolved); // 파일 툴바 요약의 미해결 수
  const head = button(doc, '', 'mdf-thread-head');
  const n = thread.comments.length;
  head.textContent = [n === 1 ? t('commentsOne') : t('commentsMany', [n]), lineLabel(thread), ...(thread.resolved ? [t('resolved')] : [])].join(' · ');
  const inner = el(doc, 'div', 'mdf-thread-body');
  inner.append(...thread.comments.map((c) => commentView(doc, c, h)));
  const actions = el(doc, 'div', 'mdf-comment-actions');
  const error = el(doc, 'div', 'mdf-comment-error');
  error.hidden = true;
  const resolve = button(doc, thread.resolved ? t('unresolve') : t('resolve'));
  resolve.addEventListener('click', async () => {
    resolve.disabled = true;
    error.hidden = true;
    try {
      await h.onResolve(thread, !thread.resolved);
    } catch (e) {
      error.textContent = e instanceof Error ? e.message : String(e);
      error.hidden = false;
      resolve.disabled = false;
    }
  });
  let openReply: ((text: string) => void) | null = null;
  if (thread.canReply) {
    const reply = button(doc, t('reply'));
    openReply = (text: string) => {
      reply.hidden = true;
      const close = () => {
        form.remove();
        reply.hidden = false;
      };
      const form = commentForm(
        doc,
        { label: t('replyTo'), pendingReview, singleLabel: t('reply'), preview: h.preview },
        {
          onSubmit: async (body, mode) => {
            await h.onReply(thread, body, mode);
            close();
          },
          onCancel: close,
        },
      );
      form.removeAttribute(MDF_ATTR); // 스레드 상자 안이라 따로 걷지 않는다
      form.querySelector('textarea')!.value = text;
      inner.append(form);
      form.querySelector('textarea')?.focus();
    };
    reply.addEventListener('click', () => openReply?.(''));
    actions.append(reply);
  }
  actions.append(resolve);
  inner.append(error, actions);
  const setOpen = (open: boolean) => {
    head.setAttribute('aria-expanded', String(open));
    inner.hidden = !open;
  };
  head.addEventListener('click', () => setOpen(head.getAttribute('aria-expanded') !== 'true'));
  setOpen(!thread.resolved || draft !== null);
  box.append(head, inner);
  if (draft !== null) openReply?.(draft);
  return box;
}

/** 렌더링 보기에서 자리를 못 찾은 스레드 묶음 — 파일 맨 위 */
export function unplacedBox(doc: Document, boxes: HTMLElement[]): HTMLElement {
  const wrap = el(doc, 'div', 'mdf-unplaced');
  wrap.setAttribute(MDF_ATTR, UNPLACED);
  wrap.append(el(doc, 'div', 'mdf-comment-label', t('threadsUnplaced')), ...boxes);
  return wrap;
}

/** 파일 전체에 단 스레드 묶음 — 파일 맨 위(블록 아래가 아니다) */
export function fileThreadsBox(doc: Document, boxes: HTMLElement[]): HTMLElement {
  const wrap = el(doc, 'div', 'mdf-unplaced mdf-file-threads');
  wrap.setAttribute(MDF_ATTR, FILE_THREADS);
  wrap.append(el(doc, 'div', 'mdf-comment-label', t('threadsFile')), ...boxes);
  return wrap;
}

export function noticeBox(doc: Document, text: string, actionLabel: string, onAction: () => void): HTMLElement {
  const box = el(doc, 'div', 'mdf-notice');
  box.setAttribute(MDF_ATTR, NOTICE);
  const b = button(doc, actionLabel);
  b.addEventListener('click', onAction);
  box.append(el(doc, 'span', '', text), b);
  return box;
}

/**
 * 블록 바로 뒤에 상자를 넣는다. 목록 항목은 항목 안(안쪽 목록 앞), 표 행은 표 뒤.
 * 바꾸기 표시(ins·del·.added·.removed) 안이면 그 밖으로 나가 취소선·밑줄을 물려받지 않게 한다. 이미 붙은 상자가 있으면 그 뒤.
 */
export function placeBox(block: HTMLElement, body: HTMLElement, box: HTMLElement): void {
  const insideChange = (n: Element): boolean => {
    for (let up: Element | null = n; up && up !== body; up = up.parentElement) if (up.matches(CHANGE_WRAPPER)) return true;
    return false;
  };
  if (block.tagName === 'LI' && !insideChange(block)) {
    const nested = [...block.children].find((c) => c.tagName === 'UL' || c.tagName === 'OL') ?? null;
    block.insertBefore(box, nested);
    return;
  }
  let host: Element = block;
  if (block.tagName === 'TR') {
    const table = block.closest('table') ?? block;
    host = table.closest(`[${MDF_ATTR}="table"]`) ?? table.closest('markdown-accessiblity-table') ?? table;
  }
  for (let up = host.parentElement; up && up !== body; up = up.parentElement) if (up.matches(CHANGE_WRAPPER)) host = up;
  host = mergedGroupEnd(host);
  let after: Element = host;
  while (after.nextElementSibling?.matches(BOX)) after = after.nextElementSibling;
  after.after(box);
}

/**
 * 합친 표는 [합친 표 묶음][숨긴 <del>][숨긴 <ins>]가 붙어 있어야 한다(합치기·원래 표 전환이 그 순서를 본다).
 * 그 셋 중 하나 뒤에 넣으려 하면 <ins> 뒤로 보낸다.
 */
function mergedGroupEnd(host: Element): Element {
  const isWrap = (n: Element | null) => n?.getAttribute(MDF_ATTR) === 'table';
  if (isWrap(host) && host.nextElementSibling?.tagName === 'DEL' && host.nextElementSibling.nextElementSibling?.tagName === 'INS') {
    return host.nextElementSibling.nextElementSibling;
  }
  if (host.tagName === 'DEL' && isWrap(host.previousElementSibling) && host.nextElementSibling?.tagName === 'INS') {
    return host.nextElementSibling;
  }
  return host;
}

/** 본문 바로 아래 조상(접기 단위) */
export function topLevel(node: Element, body: HTMLElement): Element | null {
  let n: Element | null = node;
  while (n && n.parentElement !== body) n = n.parentElement;
  return n;
}

// 리뷰 페이지 화면 — 머리(기준·보내기)·알림·파일 목록·파일마다 렌더링 diff. 렌더링 diff는 확장과 같은 순서로 다듬는다(applyBody)
import { applyBody, wireSourceToggles } from '../../../../src/apply';
import { CommentController } from '../../../../src/comment-controller';
import { safeFragment } from '../../../../src/comment-ui';
import { t } from '../../../../src/i18n';
import { changeTargets } from '../../../../src/nav';
import { MDF_ATTR } from '../../../../src/prose-markup';
import type { Badge, DraftListItem, FilePayload, PollPayload, PushPayload, SendPayload, ThreadsPayload, ViewPayload } from '../api-types';
import { ApiError, type Api } from './api';
import { LocalBackend } from './local-backend';

export interface PageDeps {
  api: Api;
  doc: Document;
  /** 원격 이미지 보기로 연 페이지인가(CSP가 https:를 허용한다) */
  remote: boolean;
  mermaid(root: HTMLElement): Promise<void>;
  navigate(url: string): void;
}

const STATUS_KEY = { modified: 'reviewStatusModified', added: 'reviewStatusAdded', deleted: 'reviewStatusDeleted', renamed: 'reviewStatusRenamed' } as const;
const FILE_NOTICE_KEY: Record<string, string> = {
  'line-endings': 'reviewFileNoticeLineEndings',
  whitespace: 'reviewFileNoticeWhitespace',
  'source-only': 'reviewFileNoticeSourceOnly',
  'unreferenced-footnote': 'reviewFileNoticeFootnote',
};
const TOAST_MS = 5000;

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

/** "원문만 바뀜" 막대 — 확장의 로컬 렌더링과 같이 쓰려고 src/apply.ts로 옮겼다(applyBody도 부른다). 예전처럼 여기서도 가져올 수 있다 */
export { wireSourceToggles };

/** 확장 threadBox 머리에 배지 — 보냄(읽기 전용)·위치 확인 필요(줄이 바뀐 초안) */
export function decorateThreads(body: HTMLElement, badges: Map<string, Badge>): void {
  for (const box of body.querySelectorAll<HTMLElement>(`[${MDF_ATTR}="thread"]`)) {
    const badge = badges.get(box.dataset.threadId ?? '');
    const head = box.querySelector('.mdf-thread-head');
    if (!badge || !head || head.querySelector('.mdc-badge')) continue;
    head.append(el(box.ownerDocument, 'span', `mdc-badge mdc-badge-${badge}`, t(badge === 'sent' ? 'reviewBadgeSent' : 'reviewBadgeStale')));
  }
}

/** 엔진이 막아 둔 원격 이미지(src 비움, data-mdc-remote) — https만 싣는다(CSP도 https:만 더했다) */
export function showRemoteImages(root: ParentNode): number {
  let n = 0;
  for (const img of root.querySelectorAll<HTMLImageElement>('img[data-mdc-remote]')) {
    const url = img.getAttribute('data-mdc-remote') ?? '';
    if (/^https:\/\//i.test(url)) {
      img.setAttribute('src', url);
      n++;
    }
  }
  return n;
}

export function countRemoteImages(files: FilePayload[]): number {
  return files.reduce((n, f) => n + (f.html.match(/data-mdc-remote=/g)?.length ?? 0), 0);
}

interface Mounted {
  file: FilePayload;
  body: HTMLElement;
  row: HTMLElement;
}

export class ReviewPage {
  private view: ViewPayload | null = null;
  private mounted: Mounted[] = [];
  private controllers: CommentController[] = [];
  private observers: MutationObserver[] = [];
  private readonly badges = new Map<string, Badge>();
  private banner: HTMLElement | null = null;
  private bannerState = '';
  private sendButton: HTMLButtonElement | null = null;
  private pushButton: HTMLButtonElement | null = null;
  private drafts = 0;
  /** PR 모드 — 에이전트에게 보내기에 넣을 GitHub 스레드(사람이 고른 것) */
  private readonly include = new Set<string>();
  /** PR 모드 — GitHub 스레드 id → 남의 코멘트 수(포함 상자를 다는 스레드) */
  private readonly github = new Map<string, { others: number }>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly deps: PageDeps,
  ) {}

  /** 보기를 받아 그린다 — 실패하면 그 이유를 화면에 */
  async load(method: 'GET' | 'POST' = 'GET', path = '/api/view', body?: unknown): Promise<void> {
    try {
      this.render(await this.deps.api<ViewPayload>(method, path, body));
    } catch (e) {
      this.fail(e);
    }
  }

  render(view: ViewPayload): void {
    this.dispose();
    this.view = view;
    this.include.clear();
    const doc = this.deps.doc;
    this.banner = el(doc, 'div', 'mdc-banner');
    this.banner.hidden = true;
    this.banner.setAttribute('role', 'status');
    this.bannerState = '';
    const parts: HTMLElement[] = [this.header(view), this.banner];
    for (const n of view.notices) parts.push(el(doc, 'p', 'mdc-notice', t(n.key, n.subs ?? [])));
    if (view.earlier.length) parts.push(this.list('mdc-earlier', t('reviewEarlier'), view.earlier.map((e) => t('reviewEarlierItem', [e.round, e.path, e.lines, e.quote]))));
    if (view.offView.length) parts.push(this.list('mdc-offview', t('reviewOffView'), view.offView.map((d) => `${d.path} · ${d.lines} · ${d.quote}`)));
    if (!view.files.length) parts.push(el(doc, 'p', 'mdc-empty', t('reviewNoChanges')));
    const nav = el(doc, 'nav', 'mdc-filelist');
    nav.setAttribute('aria-label', t('reviewFiles'));
    const list = el(doc, 'ul');
    nav.append(el(doc, 'h2', '', t('reviewFiles')), list);
    if (view.files.length) parts.push(nav);
    const sections: HTMLElement[] = [];
    view.files.forEach((file, i) => {
      const { section, body } = this.section(file, i);
      const row = this.row(file, i);
      list.append(row);
      sections.push(section);
      this.mounted.push({ file, body, row });
    });
    this.root.replaceChildren(...parts, ...sections);
    for (const m of this.mounted) this.mount(m);
    this.updateCounts();
    void this.deps.mermaid(this.root);
  }

  /** "에이전트에게 보내기" — 사람이 본 판(rev)을 보낸다. PR 모드는 고른 GitHub 스레드도 */
  async send(): Promise<void> {
    if (!this.view || !this.sendButton) return;
    this.sendButton.disabled = true;
    try {
      const r = await this.deps.api<SendPayload>('POST', '/api/send', { rev: this.view.rev, ...(this.include.size ? { include: [...this.include] } : {}) });
      await this.load();
      this.toast(r.comments === 1 ? t('reviewSentOne', [r.round]) : t('reviewSent', [r.round, r.comments]));
    } catch (e) {
      this.toast(e instanceof Error ? e.message : String(e));
      await this.refreshSummary();
    }
  }

  /**
   * PR 모드 "보류 중 리뷰에 넣기" — 확인 상자(PR·건수·글)를 거쳐야 넣는다. 페이지는 에이전트도 누를 수 있는 브라우저에서 열리므로
   * 공개는 하지 않고 보류 중 리뷰에만, 제출은 사람이 GitHub에서(스펙 §6-3)
   */
  async push(): Promise<void> {
    const view = this.view;
    if (!view?.pr) return;
    let list: DraftListItem[];
    try {
      list = (await this.deps.api<{ drafts: DraftListItem[] }>('GET', '/api/drafts')).drafts;
    } catch (e) {
      this.toast(e instanceof Error ? e.message : String(e));
      return;
    }
    const doc = this.deps.doc;
    doc.querySelector('.mdc-confirm')?.remove();
    const label = `${view.pr.owner}/${view.pr.repo}#${view.pr.number}`;
    const overlay = el(doc, 'div', 'mdc-confirm');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    const box = el(doc, 'div', 'mdc-confirm-box');
    const title = el(doc, 'h2', '', t('reviewPushConfirm', [list.length, label]));
    title.id = 'mdc-confirm-title';
    overlay.setAttribute('aria-labelledby', title.id);
    const ul = el(doc, 'ul');
    const fill = (items: string[]): void => ul.replaceChildren(...items.map((text) => el(doc, 'li', '', text)));
    fill(list.map((d) => `${d.path} · ${d.lines} · ${d.excerpt}`));
    const hint = el(doc, 'p', 'mdc-confirm-hint', t('reviewPushHint'));
    const error = el(doc, 'p', 'mdc-confirm-error');
    error.hidden = true;
    error.setAttribute('role', 'alert');
    const cancel = button(doc, t('cancel'), 'mdf-btn mdc-confirm-cancel');
    const add = button(doc, t('reviewPushAdd'), 'mdf-btn mdf-btn-primary mdc-confirm-add');
    cancel.addEventListener('click', () => overlay.remove());
    add.addEventListener('click', async () => {
      add.disabled = true;
      error.hidden = true;
      try {
        const r = await this.deps.api<PushPayload>('POST', '/api/review', { rev: view.rev });
        if (!r.failed.length) {
          this.toast(t('reviewPushed', [r.added]), { text: t('reviewPushedLink'), href: r.url });
          overlay.remove();
          await this.load();
          return;
        }
        title.textContent = t('reviewPushFailed', [r.added]);
        fill(r.failed.map((f) => `${f.path} · ${f.lines} · ${f.error}`));
        hint.hidden = true;
        add.hidden = true;
        cancel.textContent = t('reviewPushClose');
        if (r.added) void this.load();
      } catch (e) {
        error.textContent = e instanceof Error ? e.message : String(e);
        error.hidden = false;
        add.disabled = false;
      }
    });
    const actions = el(doc, 'div', 'mdc-confirm-actions');
    actions.append(cancel, add);
    box.append(title, ul, hint, error, actions);
    overlay.append(box);
    doc.body.append(overlay);
    add.focus();
  }

  /** 파일이 바뀌었거나 기준이 바뀌었으면 위에 알림 — 저절로 다시 그리지 않는다(쓰던 상자를 잃지 않게) */
  async checkPoll(): Promise<void> {
    const view = this.view;
    if (!view || !this.banner) return;
    let p: PollPayload;
    try {
      p = await this.deps.api<PollPayload>('GET', `/api/poll?rev=${encodeURIComponent(view.rev)}`);
    } catch {
      return;
    }
    const state = p.superseded ? 'base' : p.changed ? 'files' : '';
    if (state === this.bannerState) return;
    this.bannerState = state;
    if (!state) {
      this.banner.hidden = true;
      return;
    }
    const doc = this.deps.doc;
    const redraw = button(doc, t('reviewRedraw'));
    redraw.addEventListener('click', () => void (state === 'base' ? this.load() : this.load('POST', '/api/redraw')));
    this.banner.replaceChildren(el(doc, 'span', '', t(state === 'base' ? 'reviewBannerBase' : 'reviewBannerFiles')), redraw);
    this.banner.hidden = false;
  }

  startPolling(ms = 2000): void {
    clearInterval(this.timer);
    this.timer = setInterval(() => void this.checkPoll(), ms);
  }

  private mount(m: Mounted): void {
    const { body, file } = m;
    // 엔진이 정화한 HTML을 한 번 더 거른다(스크립트·이벤트 속성·위험한 주소) — CSP가 그 뒤를 받친다
    body.replaceChildren(safeFragment(this.deps.doc, file.html));
    wireSourceToggles(body);
    if (this.deps.remote) showRemoteImages(body);
    applyBody(body);
    const view = this.view!;
    const backend = new LocalBackend({
      api: this.deps.api,
      path: file.path,
      rev: () => view.rev,
      newText: () => file.newText,
      badges: this.badges,
      onChange: () => void this.refreshSummary(),
      pr: Boolean(view.pr),
      onThreads: (data) => this.onThreads(body, data),
    });
    this.controllers.push(new CommentController(body, backend));
    const observer = new MutationObserver(() => {
      decorateThreads(body, this.badges);
      this.decorateIncludes(body);
      this.updateCounts();
    });
    observer.observe(body, { childList: true, subtree: true });
    this.observers.push(observer);
  }

  /** PR 모드 — 숨긴 낡은 스레드 수·GitHub를 못 읽은 이유를 파일 머리에, 포함 상자를 달 스레드를 기억한다 */
  private onThreads(body: HTMLElement, data: ThreadsPayload): void {
    for (const [id, g] of Object.entries(data.github ?? {})) this.github.set(id, g);
    const section = body.closest('section');
    const prose = section?.querySelector('.prose-diff');
    if (!section || !prose) return;
    const notice = (cls: string, text: string): void => {
      let p = section.querySelector<HTMLElement>(`.${cls}`);
      if (!text) {
        p?.remove();
        return;
      }
      p ??= el(this.deps.doc, 'p', `mdc-file-notice ${cls}`);
      p.textContent = text;
      if (!p.isConnected) section.insertBefore(p, prose);
    };
    notice('mdc-outdated', data.hidden ? t('reviewOutdatedHidden', [data.hidden]) : '');
    notice('mdc-github-error', data.githubError ? t('reviewGithubError', [data.githubError]) : '');
  }

  /** 남의 코멘트가 있는 GitHub 스레드에 "에이전트에게 보내기에 넣기" 상자 — 기본은 넣지 않는다(스펙 §6-4) */
  private decorateIncludes(body: HTMLElement): void {
    for (const box of body.querySelectorAll<HTMLElement>(`[${MDF_ATTR}="thread"]`)) {
      const id = box.dataset.threadId ?? '';
      if (!this.github.has(id) || box.querySelector('.mdc-include')) continue;
      const doc = box.ownerDocument;
      const label = el(doc, 'label', 'mdc-include');
      const input = el(doc, 'input', 'mdc-include-box');
      input.type = 'checkbox';
      input.checked = this.include.has(id);
      input.addEventListener('change', () => {
        if (input.checked) this.include.add(id);
        else this.include.delete(id);
        this.setDrafts(this.drafts);
      });
      label.append(input, doc.createTextNode(t('reviewIncludeThread')));
      box.querySelector('.mdf-thread-head')?.after(label);
    }
  }

  private header(view: ViewPayload): HTMLElement {
    const doc = this.deps.doc;
    const header = el(doc, 'header', 'mdc-header');
    if (view.pr) {
      const pr = view.pr;
      const link = el(doc, 'a', 'mdc-pr-link', `${pr.owner}/${pr.repo}#${pr.number}`);
      link.setAttribute('href', pr.url);
      link.setAttribute('rel', 'noreferrer');
      link.title = pr.title;
      header.append(el(doc, 'h1', 'mdc-title', t('reviewTitle')), link, el(doc, 'span', 'mdc-base', t('reviewPrBaseLine', [view.baseText, pr.head])));
      this.headerButtons(header, view);
      return header;
    }
    const select = el(doc, 'select', 'mdc-base-select');
    select.setAttribute('aria-label', t('reviewBaseLabel'));
    for (const [value, key] of [
      ['merge-base', 'reviewBaseMergeBase'],
      ['since-last', 'reviewBaseSinceLast'],
    ] as const) {
      const option = el(doc, 'option', '', t(key));
      option.value = value;
      option.selected = view.view === value;
      select.append(option);
    }
    select.disabled = !view.sinceLastAvailable;
    select.addEventListener('change', () => void this.load('POST', '/api/base', { view: select.value }));
    header.append(el(doc, 'h1', 'mdc-title', t('reviewTitle')), el(doc, 'span', 'mdc-base', t('reviewBaseLine', [view.baseText])), select);
    const remote = countRemoteImages(view.files);
    if (remote || this.deps.remote) {
      const r = button(doc, this.deps.remote ? t('reviewRemoteHide') : t('reviewRemoteShow', [remote]), 'mdf-btn mdc-remote');
      r.addEventListener('click', () => this.deps.navigate(this.deps.remote ? '/' : '/?remote=1'));
      header.append(r);
    }
    this.headerButtons(header, view);
    return header;
  }

  /** 작업 트리 모드는 "에이전트에게 보내기"가 주 버튼, PR 모드는 "보류 중 리뷰에 넣기"가 주 버튼이고 보내기는 옆에 */
  private headerButtons(header: HTMLElement, view: ViewPayload): void {
    const doc = this.deps.doc;
    const send = button(doc, '', view.pr ? 'mdf-btn mdc-send' : 'mdf-btn mdf-btn-primary mdc-send');
    send.addEventListener('click', () => void this.send());
    this.sendButton = send;
    header.append(send);
    this.pushButton = null;
    if (view.pr) {
      const push = button(doc, '', 'mdf-btn mdf-btn-primary mdc-push');
      push.addEventListener('click', () => void this.push());
      this.pushButton = push;
      header.append(push);
    }
    this.setDrafts(view.drafts);
  }

  private setDrafts(n: number): void {
    this.drafts = n;
    if (this.pushButton) {
      this.pushButton.textContent = n ? t('reviewPushCount', [n]) : t('reviewPush');
      this.pushButton.disabled = n === 0;
    }
    if (!this.sendButton) return;
    const count = n + this.include.size;
    this.sendButton.textContent = count ? t('reviewSendCount', [count]) : t('reviewSend');
    this.sendButton.disabled = count === 0;
    this.sendButton.title = count ? '' : t('reviewSendEmpty');
  }

  private async refreshSummary(): Promise<void> {
    try {
      this.setDrafts((await this.deps.api<{ drafts: number }>('GET', '/api/summary')).drafts);
    } catch {
      // 다음 동작에서 다시 센다
    }
  }

  private section(file: FilePayload, i: number): { section: HTMLElement; body: HTMLElement } {
    const doc = this.deps.doc;
    const section = el(doc, 'section', 'mdc-file');
    section.id = `file-${i + 1}`;
    const head = el(doc, 'div', 'mdc-file-head');
    head.append(el(doc, 'span', `mdc-status mdc-status-${file.status}`, t(STATUS_KEY[file.status])), el(doc, 'span', 'mdc-path', file.oldPath ? `${file.oldPath} → ${file.path}` : file.path));
    section.append(head);
    for (const n of file.notices) {
      const key = FILE_NOTICE_KEY[n.kind];
      if (key) section.append(el(doc, 'p', 'mdc-file-notice', t(key)));
    }
    if (file.error) section.append(el(doc, 'p', 'mdc-file-notice mdc-error', t('reviewRenderFailed', [file.error])));
    const prose = el(doc, 'div', 'prose-diff');
    prose.setAttribute('oai-annotation-container', ''); // Codex 주석 UI가 이 안의 oai-annotatable만 짚는다(스펙 §7-2)
    const body = el(doc, 'div', 'markdown-body');
    prose.append(body);
    section.append(prose);
    return { section, body };
  }

  private row(file: FilePayload, i: number): HTMLElement {
    const doc = this.deps.doc;
    const li = el(doc, 'li', 'mdc-filerow');
    const link = el(doc, 'a', 'mdc-path', file.oldPath ? `${file.oldPath} → ${file.path}` : file.path);
    link.href = `#file-${i + 1}`;
    li.append(
      el(doc, 'span', `mdc-status mdc-status-${file.status}`, t(STATUS_KEY[file.status])),
      link,
      el(doc, 'span', 'mdc-count mdc-count-changes'),
      el(doc, 'span', 'mdc-count mdc-count-comments'),
      el(doc, 'span', 'mdc-count mdc-count-invisible'),
    );
    return li;
  }

  /** 파일 목록의 수 — 바뀐 곳(확장 nav와 같은 셈)·코멘트·보이지 않는 변경 */
  private updateCounts(): void {
    for (const { body, row } of this.mounted) {
      const changes = changeTargets(body).length;
      const comments = body.querySelectorAll(`[${MDF_ATTR}="thread"]`).length;
      const invisible = body.querySelectorAll('.mdc-source-only').length;
      const set = (cls: string, text: string): void => {
        const span = row.querySelector(`.${cls}`);
        if (span && span.textContent !== text) span.textContent = text;
      };
      set('mdc-count-changes', changes === 1 ? t('navChangesOne') : t('navChanges', [changes]));
      set('mdc-count-comments', comments === 0 ? '' : comments === 1 ? t('commentsOne') : t('commentsMany', [comments]));
      set('mdc-count-invisible', invisible ? t('reviewFileInvisible', [invisible]) : '');
    }
  }

  private list(className: string, title: string, items: string[]): HTMLElement {
    const doc = this.deps.doc;
    const box = el(doc, 'div', className);
    const ul = el(doc, 'ul');
    for (const text of items) ul.append(el(doc, 'li', '', text));
    box.append(el(doc, 'strong', '', title), ul);
    return box;
  }

  private toast(text: string, link?: { text: string; href: string }): void {
    const doc = this.deps.doc;
    doc.querySelector('.mdc-toast')?.remove();
    const box = el(doc, 'div', 'mdc-toast', text);
    if (link) {
      const a = el(doc, 'a', '', link.text);
      a.setAttribute('href', link.href);
      a.setAttribute('rel', 'noreferrer');
      box.append(' ', a);
    }
    box.setAttribute('role', 'status');
    doc.body.append(box);
    setTimeout(() => box.remove(), TOAST_MS);
  }

  private fail(e: unknown): void {
    const text = e instanceof ApiError && e.status === 403 ? t('reviewCodeExpired') : t('reviewError', [e instanceof Error ? e.message : String(e)]);
    this.root.replaceChildren(el(this.deps.doc, 'p', 'mdc-expired', text));
  }

  private dispose(): void {
    for (const c of this.controllers) c.dispose();
    for (const o of this.observers) o.disconnect();
    this.controllers = [];
    this.observers = [];
    this.mounted = [];
  }
}

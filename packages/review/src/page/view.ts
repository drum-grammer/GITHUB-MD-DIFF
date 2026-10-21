// 리뷰 페이지 화면 — 머리(기준·보내기)·알림·파일 목록·파일마다 렌더링 diff. 렌더링 diff는 확장과 같은 순서로 다듬는다(applyBody)
import { applyBody, wireSourceToggles } from '../../../../src/apply';
import { CommentController } from '../../../../src/comment-controller';
import { safeFragment } from '../../../../src/comment-ui';
import { t } from '../../../../src/i18n';
import { changeTargets } from '../../../../src/nav';
import { MDF_ATTR } from '../../../../src/prose-markup';
import type { Badge, FilePayload, PollPayload, SendPayload, ViewPayload } from '../api-types';
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

  /** "에이전트에게 보내기" — 사람이 본 판(rev)을 보낸다 */
  async send(): Promise<void> {
    if (!this.view || !this.sendButton) return;
    this.sendButton.disabled = true;
    try {
      const r = await this.deps.api<SendPayload>('POST', '/api/send', { rev: this.view.rev });
      await this.load();
      this.toast(r.comments === 1 ? t('reviewSentOne', [r.round]) : t('reviewSent', [r.round, r.comments]));
    } catch (e) {
      this.toast(e instanceof Error ? e.message : String(e));
      await this.refreshSummary();
    }
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
    const backend = new LocalBackend({ api: this.deps.api, path: file.path, rev: () => view.rev, newText: () => file.newText, badges: this.badges, onChange: () => void this.refreshSummary() });
    this.controllers.push(new CommentController(body, backend));
    const observer = new MutationObserver(() => {
      decorateThreads(body, this.badges);
      this.updateCounts();
    });
    observer.observe(body, { childList: true, subtree: true });
    this.observers.push(observer);
  }

  private header(view: ViewPayload): HTMLElement {
    const doc = this.deps.doc;
    const header = el(doc, 'header', 'mdc-header');
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
    const send = button(doc, '', 'mdf-btn mdf-btn-primary mdc-send');
    send.addEventListener('click', () => void this.send());
    this.sendButton = send;
    this.setDrafts(view.drafts);
    header.append(send);
    return header;
  }

  private setDrafts(n: number): void {
    if (!this.sendButton) return;
    this.sendButton.textContent = n ? t('reviewSendCount', [n]) : t('reviewSend');
    this.sendButton.disabled = n === 0;
    this.sendButton.title = n ? '' : t('reviewSendEmpty');
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

  private toast(text: string): void {
    const doc = this.deps.doc;
    doc.querySelector('.mdc-toast')?.remove();
    const box = el(doc, 'div', 'mdc-toast', text);
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

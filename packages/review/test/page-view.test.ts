// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import extEn from '../../../static/_locales/en/messages.json';
import { useMessages } from '../../../src/i18n';
import reviewEn from '../locales/en.json';
import type { FilePayload, ThreadsPayload, ViewPayload } from '../src/api-types';
import { ApiError, type Api } from '../src/page/api';
import { ReviewPage, decorateThreads, wireSourceToggles } from '../src/page/view';

beforeAll(() => useMessages({ ...extEn, ...reviewEn }));

const HTML = [
  '<h1 class="rich-diff-level-zero vicinity" data-mdc-new="1-1" data-mdc-old="1-1">Guide</h1>',
  '<div class="changed rich-diff-level-zero"><p class="rich-diff-level-one" data-mdc-new="3-3" data-mdc-old="3-3">Install with <del>one</del><ins>a single</ins> command.</p></div>',
  '<div class="expandable unchanged js-expandable"><p class="rich-diff-level-zero unchanged" data-mdc-new="5-5" data-mdc-old="5-5">Same one.</p><p class="rich-diff-level-zero unchanged" data-mdc-new="7-7" data-mdc-old="7-7">Same two.</p></div>',
  '<div class="changed mdc-source-only rich-diff-level-zero" data-mdc-new="9-9" data-mdc-old="9-9"><button type="button" class="mdc-source-only-toggle" aria-expanded="false">Source changed — not visible in the rendering</button><pre class="mdc-source-diff" hidden><span class="mdc-del">- *b*</span>\n<span class="mdc-ins">+ _b_</span></pre></div>',
].join('');
const NO_THREADS: ThreadsPayload = { threads: [], badges: {} };
const file = (extra: Partial<FilePayload> = {}): FilePayload => ({ path: 'docs/guide.md', status: 'modified', html: HTML, newText: '# Guide\n', notices: [], ...extra });
const view = (extra: Partial<ViewPayload> = {}): ViewPayload => ({ rev: 'r00001', view: 'merge-base', baseText: '1a2b3c4 (merge-base main)', sinceLastAvailable: false, notices: [], files: [file()], drafts: 0, offView: [], earlier: [], ...extra });

function mount(v: ViewPayload, opts: { remote?: boolean; poll?: { changed: boolean; superseded: boolean }; threads?: ThreadsPayload } = {}) {
  document.body.innerHTML = '<main id="mdc-app"></main>';
  const root = document.getElementById('mdc-app')!;
  const calls: string[] = [];
  const api = vi.fn(async (method: string, path: string, body?: unknown) => {
    calls.push(`${method} ${path}${body === undefined ? '' : ` ${JSON.stringify(body)}`}`);
    if (path === '/api/view' || path === '/api/redraw' || path === '/api/base') return v;
    if (path.startsWith('/api/threads')) return opts.threads ?? NO_THREADS;
    if (path === '/api/summary') return { drafts: 2 };
    if (path === '/api/send') return { round: 3, comments: 2 };
    if (path.startsWith('/api/poll')) return opts.poll ?? { changed: false, superseded: false };
    throw new Error(`unexpected ${method} ${path}`);
  });
  const navigate = vi.fn();
  const mermaid = vi.fn(async () => {});
  const page = new ReviewPage(root, { api: api as unknown as Api, doc: document, remote: opts.remote ?? false, mermaid, navigate });
  return { root, page, calls, navigate, mermaid };
}

describe('ReviewPage', () => {
  it('머리·파일 목록(상태·바뀐 곳·보이지 않는 변경)·확장 접기와 툴바를 그린다', async () => {
    const { root, page, mermaid } = mount(view());
    await page.load();
    expect(root.querySelector('.mdc-title')!.textContent).toBe('Markdown Diff Cat');
    expect(root.querySelector('.mdc-base')!.textContent).toBe('1a2b3c4 (merge-base main) → working tree');
    expect(root.querySelector<HTMLSelectElement>('.mdc-base-select')!.disabled).toBe(true);
    const row = root.querySelector('.mdc-filerow')!;
    expect(row.querySelector('.mdc-status')!.textContent).toBe('modified');
    expect(row.querySelector('.mdc-path')!.getAttribute('href')).toBe('#file-1');
    expect(row.querySelector('.mdc-count-changes')!.textContent).toBe('2 changes');
    expect(row.querySelector('.mdc-count-invisible')!.textContent).toBe('1 invisible');
    const body = root.querySelector<HTMLElement>('#file-1 .prose-diff > .markdown-body')!;
    expect(body.querySelector('[data-mdf="fold"]')).not.toBeNull();
    expect(body.querySelector('[data-mdf="file-toolbar"]')).not.toBeNull();
    expect(root.querySelector<HTMLButtonElement>('.mdc-send')!.disabled).toBe(true);
    expect(mermaid).toHaveBeenCalledWith(root);
  });
  it('이 판에서 보낸 코멘트는 확장 스레드 상자로 그려지고 "Sent" 배지와 코멘트 수가 붙는다', async () => {
    const sent: ThreadsPayload = {
      threads: [{ id: 's1-c1', subject: 'line', side: 'right', start: 3, end: 3, resolved: false, canReply: false, comments: [{ id: 's1-c1', author: 'you', body: 'x', bodyHTML: '<p>x</p>', url: '', pending: false, bodyVersion: '', canEdit: false, canDelete: false }] }],
      badges: { 's1-c1': 'sent' },
    };
    const { root, page } = mount(view(), { threads: sent });
    await page.load();
    await vi.waitFor(() => expect(root.querySelector('[data-mdf="thread"] .mdc-badge-sent')?.textContent).toBe('Sent'));
    expect(root.querySelector('[data-mdf="thread"]')!.querySelector('button.mdf-link')).toBeNull();
    await vi.waitFor(() => expect(root.querySelector('.mdc-count-comments')!.textContent).toBe('1 comment'));
  });
  it('보내기 — 초안 수, POST /api/send, 다시 그리기, 안내', async () => {
    const { root, page, calls } = mount(view({ drafts: 2 }));
    await page.load();
    const send = root.querySelector<HTMLButtonElement>('.mdc-send')!;
    expect(send.textContent).toBe('Send to agent (2)');
    expect(send.disabled).toBe(false);
    await page.send();
    expect(calls).toContain('POST /api/send {"rev":"r00001"}');
    expect(calls.filter((c) => c === 'GET /api/view')).toHaveLength(2);
    expect(document.querySelector('.mdc-toast')!.textContent).toBe('Sent round 3 (2 comments). The agent can read them now.');
  });
  it('폴링 — 파일이 바뀌면 배너와 Redraw(POST /api/redraw)', async () => {
    const { root, page, calls } = mount(view(), { poll: { changed: true, superseded: false } });
    await page.load();
    await page.checkPoll();
    const banner = root.querySelector<HTMLElement>('.mdc-banner')!;
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toContain('Files changed on disk.');
    banner.querySelector('button')!.click();
    await vi.waitFor(() => expect(calls).toContain('POST /api/redraw'));
  });
  it('기준이 바뀌었으면(다른 판) 배너의 Redraw는 지금 판을 다시 받는다', async () => {
    const { root, page, calls } = mount(view(), { poll: { changed: false, superseded: true } });
    await page.load();
    await page.checkPoll();
    expect(root.querySelector('.mdc-banner')!.textContent).toContain('The review base changed.');
    root.querySelector<HTMLButtonElement>('.mdc-banner button')!.click();
    await vi.waitFor(() => expect(calls.filter((c) => c === 'GET /api/view')).toHaveLength(2));
  });
  it('기준 고르기 — 라운드나 mark가 있으면 켜지고, 고르면 POST /api/base', async () => {
    const { root, page, calls } = mount(view({ sinceLastAvailable: true }));
    await page.load();
    const select = root.querySelector<HTMLSelectElement>('.mdc-base-select')!;
    expect(select.disabled).toBe(false);
    select.value = 'since-last';
    select.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(calls).toContain('POST /api/base {"view":"since-last"}'));
  });
  it('원격 이미지 — 기본은 막고 단추만, 원격 보기에서는 https만 싣는다', async () => {
    const html = '<p class="rich-diff-level-zero" data-mdc-new="1-1"><img src="" data-mdc-remote="https://example.com/a.png" alt="a"><img src="" data-mdc-remote="http://plain.example/b.png" alt="b"></p>';
    const off = mount(view({ files: [file({ html })] }));
    await off.page.load();
    const btn = off.root.querySelector<HTMLButtonElement>('.mdc-remote')!;
    expect(btn.textContent).toBe('Show remote images (2)');
    expect(off.root.querySelector('img')!.getAttribute('src')).toBe('');
    btn.click();
    expect(off.navigate).toHaveBeenCalledWith('/?remote=1');
    const on = mount(view({ files: [file({ html })] }), { remote: true });
    await on.page.load();
    const imgs = on.root.querySelectorAll('img');
    expect(imgs[0].getAttribute('src')).toBe('https://example.com/a.png');
    expect(imgs[1].getAttribute('src')).toBe('');
    expect(on.root.querySelector('.mdc-remote')!.textContent).toBe('Hide remote images');
  });
  it('알림·지난 라운드 목록·보기 밖 초안·파일 알림·파일 실패', async () => {
    const { root, page } = mount(
      view({
        notices: [{ key: 'reviewNoticeUpstream', subs: ['upstream/main'] }],
        earlier: [{ round: 1, path: 'a.md', lines: 'L3', quote: 'old text' }],
        offView: [{ id: 'd00000001', path: 'gone.md', lines: 'L2–4', quote: 'q' }],
        files: [file({ notices: [{ kind: 'line-endings' }] }), file({ path: 'bad.md', html: '', error: 'boom' })],
      }),
    );
    await page.load();
    expect(root.querySelector('.mdc-notice')!.textContent).toBe('This repository has an upstream remote. For a fork, compare with --base upstream/main.');
    expect(root.querySelector('.mdc-earlier li')!.textContent).toBe('Round 1 · a.md · L3 · old text');
    expect(root.querySelector('.mdc-offview li')!.textContent).toBe('gone.md · L2–4 · q');
    expect(root.querySelector('#file-1 .mdc-file-notice')!.textContent).toBe('Only line endings or trailing spaces changed in this file.');
    expect(root.querySelector('#file-2 .mdc-error')!.textContent).toBe('Could not render this file: boom');
  });
  it('세션이 없거나 서버가 다시 떴으면(403) --reopen 안내', async () => {
    document.body.innerHTML = '<main id="mdc-app"></main>';
    const root = document.getElementById('mdc-app')!;
    const api = vi.fn(async () => {
      throw new ApiError(403, 'forbidden');
    });
    await new ReviewPage(root, { api: api as unknown as Api, doc: document, remote: false, mermaid: async () => {}, navigate: () => {} }).load();
    expect(root.querySelector('.mdc-expired')!.textContent).toContain('markdown-diff-cat review --reopen');
  });
});

describe('조각 함수', () => {
  it('원문만 바뀜 막대 — 누르면 원문 줄 diff를 펼치고 다시 누르면 접는다(두 번 이어도 한 번만)', () => {
    const b = document.createElement('div');
    b.innerHTML = HTML;
    wireSourceToggles(b);
    wireSourceToggles(b);
    const toggle = b.querySelector<HTMLButtonElement>('.mdc-source-only-toggle')!;
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(b.querySelector<HTMLElement>('.mdc-source-diff')!.hidden).toBe(false);
    toggle.click();
    expect(b.querySelector<HTMLElement>('.mdc-source-diff')!.hidden).toBe(true);
  });
  it('배지는 스레드 머리에 한 번만', () => {
    const b = document.createElement('div');
    b.innerHTML = '<div data-mdf="thread" data-thread-id="s1-c1"><button class="mdf-thread-head">1 comment</button></div><div data-mdf="thread" data-thread-id="d00000001"><button class="mdf-thread-head">1 comment</button></div>';
    const badges = new Map([['s1-c1', 'sent' as const]]);
    decorateThreads(b, badges);
    decorateThreads(b, badges);
    expect(b.querySelectorAll('.mdc-badge')).toHaveLength(1);
    expect(b.querySelector('.mdc-badge-sent')!.textContent).toBe('Sent');
  });
});

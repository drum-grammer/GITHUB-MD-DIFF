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
  it('파일마다 렌더링 본문을 Codex 주석 컨테이너로 감싼다(스펙 §7-2)', async () => {
    const { root, page } = mount(view());
    await page.load();
    const prose = root.querySelectorAll('.prose-diff');
    expect(prose.length).toBe(1);
    expect(prose[0].hasAttribute('oai-annotation-container')).toBe(true);
  });

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

describe('PR 모드 페이지', () => {
  const PR = { owner: 'acme', repo: 'docs', number: 7, url: 'https://github.com/acme/docs/pull/7', title: 'Docs', head: '9f8e7d6' };
  const prView = (extra: Partial<ViewPayload> = {}): ViewPayload => view({ pr: PR, baseText: '1a2b3c4 (merge-base of acme/docs#7)', ...extra });
  const DRAFTS = {
    drafts: [
      { id: 'd1', path: 'docs/guide.md', lines: 'L3', excerpt: 'Shorter.', place: { kind: 'line' } },
      { id: 'd2', path: 'docs/guide.md', lines: 'whole file', excerpt: 'Reply text', place: { kind: 'reply' } },
      { id: 'd3', path: 'docs/guide.md', lines: 'L2–5', excerpt: 'Range', place: { kind: 'trimmed', lines: 'L3–5' } },
      { id: 'd4', path: 'docs/guide.md', lines: 'L9', excerpt: 'Folded', place: { kind: 'file' } },
      { id: 'd5', path: 'docs/guide.md', lines: 'L7', excerpt: 'Old', place: { kind: 'stale' } },
      { id: 'd6', path: 'docs/x.md', lines: 'L1', excerpt: 'Elsewhere', place: { kind: 'error', error: 'docs/x.md is not among the changed files of the pull request' } },
    ],
  };
  const comment = (id: string, author: string, mine = false) => ({ id, author, body: 'b', bodyHTML: '<p>b</p>', url: mine ? '' : 'https://github.com/x', pending: false, bodyVersion: '', canEdit: mine, canDelete: mine });
  const GH_THREADS: ThreadsPayload = {
    threads: [
      { id: 'PRRT_1', subject: 'line', side: 'right', start: 3, end: 3, resolved: false, canReply: true, comments: [comment('C1', 'octocat')] },
      { id: 'd00000001', subject: 'line', side: 'right', start: 3, end: 3, resolved: false, canReply: false, comments: [comment('d00000001', 'you', true)] },
    ],
    badges: {},
    hidden: 2,
    github: { PRRT_1: { others: 1 } },
  };

  function mountPr(v: ViewPayload, push: unknown = { added: 2, failed: [], url: 'https://github.com/acme/docs/pull/7/files' }, threads: ThreadsPayload = NO_THREADS) {
    document.body.innerHTML = '<main id="mdc-app"></main>';
    const root = document.getElementById('mdc-app')!;
    const calls: string[] = [];
    const api = vi.fn(async (method: string, path: string, body?: unknown) => {
      calls.push(`${method} ${path}${body === undefined ? '' : ` ${JSON.stringify(body)}`}`);
      if (path === '/api/view' || path === '/api/redraw') return v;
      if (path.startsWith('/api/threads')) return threads;
      if (path === '/api/summary') return { drafts: v.drafts };
      if (path === '/api/drafts' && method === 'GET') return DRAFTS;
      if (path === '/api/send') return { round: 1, comments: 3 };
      if (path === '/api/review') {
        if (push instanceof Error) throw push;
        return push;
      }
      if (path.startsWith('/api/poll')) return { changed: false, superseded: false };
      throw new Error(`unexpected ${method} ${path}`);
    });
    const page = new ReviewPage(root, { api: api as unknown as Api, doc: document, remote: false, mermaid: vi.fn(async () => {}), navigate: vi.fn() });
    return { root, page, calls };
  }

  it('PR 머리 — 링크·→ head·기준 고르기 없음·보류 중 리뷰 버튼 수', async () => {
    const { root, page } = mountPr(prView({ drafts: 2 }));
    await page.load();
    const link = root.querySelector<HTMLAnchorElement>('.mdc-pr-link')!;
    expect(link.textContent).toBe('acme/docs#7');
    expect(link.getAttribute('href')).toBe('https://github.com/acme/docs/pull/7');
    expect(link.getAttribute('rel')).toBe('noreferrer');
    expect(root.querySelector('.mdc-base')!.textContent).toBe('1a2b3c4 (merge-base of acme/docs#7) → head 9f8e7d6');
    expect(root.querySelector('.mdc-base-select')).toBeNull();
    const push = root.querySelector<HTMLButtonElement>('.mdc-push')!;
    expect(push.textContent).toBe('Add to pending review (2)');
    expect(push.disabled).toBe(false);
    expect(push.classList.contains('mdf-btn-primary')).toBe(true);
    const send = root.querySelector<HTMLButtonElement>('.mdc-send')!;
    expect(send.textContent).toBe('Send to agent (2)');
    expect(send.classList.contains('mdf-btn-primary')).toBe(false);
    const empty = mountPr(prView({ drafts: 0 }));
    await empty.page.load();
    expect(empty.root.querySelector<HTMLButtonElement>('.mdc-push')!.textContent).toBe('Add to pending review');
    expect(empty.root.querySelector<HTMLButtonElement>('.mdc-push')!.disabled).toBe(true);
  });

  it('넣기 — 확인 상자에 PR·건수·글, Cancel이면 요청 없음, Add면 POST /api/review 뒤 알림과 다시 그리기', async () => {
    const { root, page, calls } = mountPr(prView({ drafts: 2 }));
    await page.load();
    await page.push();
    const box = document.querySelector<HTMLElement>('.mdc-confirm')!;
    expect(box.getAttribute('role')).toBe('dialog');
    expect(box.getAttribute('aria-modal')).toBe('true');
    expect(box.querySelector('h2')!.textContent).toBe('Add 4 to your pending review on acme/docs#7?');
    expect([...box.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'docs/guide.md · L3 · Shorter.',
      'docs/guide.md · whole file · Reply text → reply',
      'docs/guide.md · L2–5 · Range → trimmed to L3–5, the changed lines GitHub accepts',
      'docs/guide.md · L9 · Folded → added as a whole-file comment with the quoted lines',
      'docs/guide.md · L7 · Old → not added — the lines changed since you wrote this',
      'docs/x.md · L1 · Elsewhere → not added — docs/x.md is not among the changed files of the pull request',
    ]);
    expect(box.querySelector('.mdc-confirm-hint')!.textContent).toBe('Nothing is published until you submit the review on GitHub.');
    box.querySelector<HTMLButtonElement>('.mdc-confirm-cancel')!.click();
    expect(document.querySelector('.mdc-confirm')).toBeNull();
    expect(calls.some((c) => c.startsWith('POST /api/review'))).toBe(false);
    await page.push();
    document.querySelector<HTMLButtonElement>('.mdc-confirm-add')!.click();
    await vi.waitFor(() => expect(document.querySelector('.mdc-confirm')).toBeNull());
    expect(calls).toContain('POST /api/review {"rev":"r00001"}');
    const toast = document.querySelector('.mdc-toast')!;
    expect(toast.textContent).toBe('Added 2 to your pending review. Submit it on GitHub');
    expect(toast.querySelector('a')!.getAttribute('href')).toBe('https://github.com/acme/docs/pull/7/files');
    expect(calls.filter((c) => c === 'GET /api/view')).toHaveLength(2);
    expect(root.querySelector('.mdc-push')).not.toBeNull();
  });

  it('넣기 실패 — 넣지 못한 것은 이유와 함께 상자에 남고, 요청 오류는 상자에 그 문구', async () => {
    const partial = mountPr(prView({ drafts: 2 }), { added: 1, failed: [{ id: 'd2', path: 'docs/guide.md', lines: 'L9', error: 'docs/guide.md is not among the changed files of the pull request' }], url: 'u' });
    await partial.page.load();
    await partial.page.push();
    document.querySelector<HTMLButtonElement>('.mdc-confirm-add')!.click();
    await vi.waitFor(() => expect(document.querySelector('.mdc-confirm h2')!.textContent).toBe('Added 1. Not added — still drafts here:'));
    const box = document.querySelector<HTMLElement>('.mdc-confirm')!;
    expect([...box.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['docs/guide.md · L9 · docs/guide.md is not among the changed files of the pull request']);
    expect(box.querySelector<HTMLButtonElement>('.mdc-confirm-add')!.hidden).toBe(true);
    expect(box.querySelector('.mdc-confirm-cancel')!.textContent).toBe('Close');

    const refused = mountPr(prView({ drafts: 2 }), new ApiError(409, 'New commits were pushed to acme/docs#7 after this view — press Redraw, check your comments, and add them again.'));
    await refused.page.load();
    await refused.page.push();
    document.querySelector<HTMLButtonElement>('.mdc-confirm-add')!.click();
    await vi.waitFor(() => expect(document.querySelector('.mdc-confirm-error')!.textContent).toContain('New commits were pushed'));
    expect(document.querySelector<HTMLButtonElement>('.mdc-confirm-add')!.disabled).toBe(false);
    // 새 커밋(409)이면 상자 안에서 바로 다시 그린다 — 막다른 길이 아니게
    document.querySelector<HTMLButtonElement>('.mdc-confirm-redraw')!.click();
    await vi.waitFor(() => expect(refused.calls).toContain('POST /api/redraw'));
    expect(document.querySelector('.mdc-confirm')).toBeNull();
  });

  it('확인 상자 — 넣는 동안 Cancel은 꺼지고, 쉬는 동안 Escape로 닫는다', async () => {
    let finish!: (v: unknown) => void;
    const slow = new Promise((ok) => (finish = ok));
    const { page } = mountPr(prView({ drafts: 2 }), { then: (ok: (v: unknown) => void) => slow.then(ok) });
    await page.load();
    await page.push();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.mdc-confirm')).toBeNull();
    await page.push();
    document.querySelector<HTMLButtonElement>('.mdc-confirm-add')!.click();
    await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>('.mdc-confirm-cancel')!.disabled).toBe(true));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.mdc-confirm')).not.toBeNull();
    finish({ added: 1, failed: [{ id: 'd2', path: 'docs/guide.md', lines: 'L9', error: 'nope' }], url: 'u' });
    await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>('.mdc-confirm-cancel')!.disabled).toBe(false));
    expect(document.querySelector('.mdc-confirm li')!.textContent).toBe('docs/guide.md · L9 · nope');
  });

  it('PR 머리에는 늘 Redraw — PR을 다시 받아 그린다(새 커밋)', async () => {
    const { root, page, calls } = mountPr(prView({ drafts: 1 }));
    await page.load();
    const redraw = root.querySelector<HTMLButtonElement>('.mdc-header .mdc-redraw')!;
    expect(redraw.textContent).toBe('Redraw');
    redraw.click();
    await vi.waitFor(() => expect(calls).toContain('POST /api/redraw'));
  });

  it('PR 모드에도 원격 이미지 보기', async () => {
    const remote = file({ html: '<p class="rich-diff-level-zero vicinity" data-mdc-new="1-1"><img data-mdc-remote="https://example.com/a.png" alt="a"></p>' });
    const { root, page } = mountPr(prView({ files: [remote] }));
    await page.load();
    expect(root.querySelector('.mdc-remote')!.textContent).toBe('Show remote images (1)');
  });

  it('남의 코멘트가 있는 스레드에만 포함 상자, 고른 것이 보내기 include로, 숨긴 낡은 스레드 수 알림', async () => {
    const { root, page, calls } = mountPr(prView({ drafts: 2 }), undefined, GH_THREADS);
    await page.load();
    await vi.waitFor(() => expect(root.querySelectorAll('[data-mdf="thread"]')).toHaveLength(2));
    const boxes = root.querySelectorAll<HTMLElement>('[data-mdf="thread"]');
    const include = boxes[0].querySelector<HTMLInputElement>('input.mdc-include-box')!;
    expect(include.closest('label')!.textContent).toBe('Include in Send to agent');
    expect(boxes[1].querySelector('input.mdc-include-box')).toBeNull();
    include.checked = true;
    include.dispatchEvent(new Event('change'));
    expect(root.querySelector('.mdc-send')!.textContent).toBe('Send to agent (3)');
    await page.send();
    expect(calls).toContain('POST /api/send {"rev":"r00001","include":["PRRT_1"]}');
    expect(root.querySelector('#file-1 .mdc-outdated')!.textContent).toBe('2 outdated threads hidden — see them on GitHub');
  });

  it('숨긴 낡은 스레드가 하나면 단수', async () => {
    const { root, page } = mountPr(prView(), undefined, { threads: [], badges: {}, hidden: 1 });
    await page.load();
    await vi.waitFor(() => expect(root.querySelector('#file-1 .mdc-outdated')!.textContent).toBe('1 outdated thread hidden — see it on GitHub'));
  });

  it('GitHub를 못 읽으면 파일 머리에 그 이유', async () => {
    const { root, page } = mountPr(prView(), undefined, { threads: [], badges: {}, githubError: 'gh api: HTTP 502' });
    await page.load();
    await vi.waitFor(() => expect(root.querySelector('#file-1 .mdc-github-error')!.textContent).toBe('Could not read review threads from GitHub: gh api: HTTP 502'));
  });
});


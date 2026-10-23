// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import extEn from '../../../static/_locales/en/messages.json';
import type { CommentBackend } from '../../../src/comment-controller';
import type { ReviewThread } from '../../../src/types';
import { useMessages } from '../../../src/i18n';
import reviewEn from '../locales/en.json';
import type { Badge } from '../src/api-types';
import { ApiError, createApi, sessionSecret, type Api } from '../src/page/api';
import { LocalBackend, mappingFromAttributes } from '../src/page/local-backend';

beforeAll(() => useMessages({ ...extEn, ...reviewEn }));

const HTML = `
<h1 class="rich-diff-level-zero vicinity" data-mdc-new="1-1" data-mdc-old="1-1">Guide</h1>
<div class="changed rich-diff-level-zero"><p class="rich-diff-level-one" data-mdc-new="3-3" data-mdc-old="3-3">Install the tool with <del>one</del><ins>a single</ins> command.</p></div>
<del class="rich-diff-level-zero"><p data-mdc-old="5-6">Removed paragraph.</p></del>
<ul class="rich-diff-level-zero"><li class="removed" data-mdc-old="8-8">gone item</li><li data-mdc-new="8-8" data-mdc-old="9-9">kept item</li></ul>
<div data-mdf="table"><table><tr data-mdc-new="10-10"><td>copy</td></tr></table></div>
<p class="rich-diff-level-zero">no line attribute</p>`;

function body(): HTMLElement {
  const b = document.createElement('div');
  b.className = 'markdown-body';
  b.innerHTML = HTML;
  return b;
}

describe('mappingFromAttributes', () => {
  it('지운 블록(del·.removed 안)은 옛 쪽(left), 나머지는 새 쪽(right) — 확장이 만든 사본·줄 속성 없는 블록은 뺀다', () => {
    const map = mappingFromAttributes(body());
    const rows = [...map].map(([el, t]) => `${el.tagName} ${el.textContent!.trim().slice(0, 12)} → ${t.side} ${t.start}-${t.end}`);
    expect(rows).toEqual(['H1 Guide → right 1-1', 'P Install the  → right 3-3', 'P Removed para → left 5-6', 'LI gone item → left 8-8', 'LI kept item → right 8-8']);
  });
});

describe('mappingFromAttributes — 엔진이 고친 잎의 옛 사본에 단 두 줄 속성', () => {
  it('.removed 옛 사본은 data-mdc-new도 달지만 옛 쪽(left) 줄로 읽는다(M1 최종 검토)', () => {
    const b = document.createElement('div');
    b.innerHTML = '<ul><li class="removed" data-mdc-new="4-4" data-mdc-old="3-3">old words</li><li class="added" data-mdc-new="4-4" data-mdc-old="3-3">new words</li></ul>';
    expect([...mappingFromAttributes(b).values()].map((t) => `${t.side} ${t.start}-${t.end}`)).toEqual(['left 3-3', 'right 4-4']);
  });
});

describe('LocalBackend', () => {
  const make = (api: Api, newText: string | null = 'one\r\ntwo\r\nthree\r\n', extra: { pr?: boolean; onThreads?: (d: unknown) => void } = {}) => {
    const badges = new Map<string, Badge>();
    const onChange = vi.fn();
    return { backend: new LocalBackend({ api, path: '문서/a b.md', rev: () => 'r00001', newText: () => newText, badges, onChange, ...extra }), badges, onChange };
  };
  it('PR 모드 — 답글은 그 스레드의 쪽·줄과 replyTo를 담은 초안, load는 받은 스레드 정보를 페이지에 넘긴다', async () => {
    const api = vi.fn(async () => ({ threads: [], badges: {}, hidden: 2 }));
    const onThreads = vi.fn();
    const { backend, onChange } = make(api as unknown as Api, 'x\n', { pr: true, onThreads });
    const thread: ReviewThread = { id: 'PRRT_1', subject: 'line', side: 'right', start: 3, end: 4, resolved: false, canReply: true, comments: [] };
    await backend.reply!(thread, 'Agreed.', 'single');
    expect(api).toHaveBeenLastCalledWith('POST', '/api/drafts', { rev: 'r00001', path: '문서/a b.md', side: 'right', start: 3, end: 4, body: 'Agreed.', replyTo: 'PRRT_1' });
    expect(onChange).toHaveBeenCalledTimes(1);
    await backend.load();
    expect(onThreads).toHaveBeenCalledWith({ threads: [], badges: {}, hidden: 2 });
  });
  it('상자 모양 — 버튼 하나("Add comment"), 아바타 없음, 답글·해결 없음', () => {
    const { backend } = make(vi.fn() as unknown as Api);
    expect(backend.form).toEqual({ buttons: 'local', showAvatar: false, singleLabel: 'Add comment' });
    const asBackend: CommentBackend = backend;
    expect(asBackend.reply).toBeUndefined();
    expect(asBackend.resolve).toBeUndefined();
  });
  it('load는 그 파일의 스레드를 받아 배지를 기록한다', async () => {
    const api = vi.fn(async () => ({ threads: [{ id: 's1-c1' }], badges: { 's1-c1': 'sent' } }));
    const { backend, badges } = make(api as unknown as Api);
    expect(await backend.load()).toEqual({ threads: [{ id: 's1-c1' }], pendingReview: false });
    expect(api).toHaveBeenCalledWith('GET', `/api/threads?path=${encodeURIComponent('문서/a b.md')}`);
    expect(badges.get('s1-c1')).toBe('sent');
  });
  it('post·edit·remove는 초안 API를 부르고 onChange를 알린다', async () => {
    const api = vi.fn(async () => ({}));
    const { backend, onChange } = make(api as unknown as Api);
    await backend.post({ side: 'left', start: 5, end: 6 }, 'why?', 'single');
    await backend.edit!({ id: 'd0000abcd' } as never, 'why!');
    await backend.remove!({ id: 'd0000abcd' } as never);
    expect(api.mock.calls).toEqual([
      ['POST', '/api/drafts', { rev: 'r00001', path: '문서/a b.md', side: 'left', start: 5, end: 6, body: 'why?' }],
      ['PATCH', '/api/drafts/d0000abcd', { body: 'why!' }],
      ['DELETE', '/api/drafts/d0000abcd'],
    ]);
    expect(onChange).toHaveBeenCalledTimes(3);
  });
  it('제안 원래 줄 — 새 쪽만, CRLF는 지우고 줄 범위 그대로', () => {
    const { backend } = make(vi.fn() as unknown as Api);
    expect(backend.suggestion({ side: 'right', start: 2, end: 3 })).toBe('two\nthree');
    expect(backend.suggestion({ side: 'left', start: 2, end: 3 })).toBeUndefined();
    expect(make(vi.fn() as unknown as Api, null).backend.suggestion({ side: 'right', start: 1, end: 1 })).toBeUndefined();
  });
  it('미리보기는 로컬 엔진(POST /api/preview)', async () => {
    const api = vi.fn(async () => ({ html: '<p>x</p>' }));
    expect(await make(api as unknown as Api).backend.preview!('x')).toBe('<p>x</p>');
    expect(api).toHaveBeenCalledWith('POST', '/api/preview', { text: 'x' });
  });
});

describe('api.ts', () => {
  it('세션 비밀 — meta가 있으면 그 탭의 sessionStorage에 두고, 없으면 거기서 읽는다', () => {
    document.head.innerHTML = '<meta name="mdc-session" content="abc">';
    expect(sessionSecret(document, sessionStorage)).toBe('abc');
    document.head.innerHTML = '';
    expect(sessionSecret(document, sessionStorage)).toBe('abc');
    sessionStorage.clear();
    expect(sessionSecret(document, sessionStorage)).toBeNull();
  });
  it('요청마다 세션 헤더를 싣고, 실패하면 서버 문구를 담은 ApiError', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: 'Add a comment first.' }), { status: 400 }));
    const api = createApi('s3cret', fetchImpl as unknown as typeof fetch);
    await expect(api('POST', '/api/send', { rev: 'r1' })).rejects.toEqual(new ApiError(400, 'Add a comment first.'));
    const [path, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe('/api/send');
    expect(init.headers).toEqual({ 'X-MDC-Session': 's3cret', 'Content-Type': 'application/json' });
    expect(init.credentials).toBe('omit');
  });
});

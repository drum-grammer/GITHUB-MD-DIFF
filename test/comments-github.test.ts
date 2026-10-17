// GitHub 백엔드로 붙인 코멘트 기능의 겉동작 — comments.ts를 comment-controller.ts로 나누기 전(ffc671e)에도 같은 결과여야 한다.
// fetch는 가짜(GitHub 내부 요청 모양 그대로), 화면은 jsdom. PR 데이터 캐시가 모듈 안에 있어 시험마다 PR 번호를 다르게 쓴다
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachComments, detachAllComments } from '../src/comments';
import { fakeFile } from './helpers';

const LINES = ['# Title', '', 'First paragraph.', '', 'Second paragraph.', '', 'Third paragraph.'];
const PROSE =
  '<div class="prose-diff"><div><div class="markdown-body">' +
  '<h1 class="vicinity" id="title">Title</h1><p class="vicinity" id="first">First paragraph.</p>' +
  '<p class="changed" id="second">Second paragraph.</p><p class="vicinity" id="third">Third paragraph.</p>' +
  '</div></div></div>';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const settle = () => new Promise((r) => setTimeout(r, 0));

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown> | undefined;
}

/** PR n의 가짜 GitHub — changes 응답의 머리 커밋은 heads 차례대로(다 쓰면 마지막 것), threads는 R5 줄 스레드를 넣을지 */
function github(n: number, opt: { heads?: string[]; threads?: boolean; pending?: boolean } = {}): Call[] {
  const heads = [...(opt.heads ?? ['h1'])];
  const calls: Call[] = [];
  const route = (head: string) => ({
    payload: {
      pullRequestsChangesRoute: {
        comparison: { fullDiff: { baseOid: 'b1', headOid: head } },
        diffSummaries: [{ path: 'docs/a.md', changeType: 'MODIFIED', markersMap: opt.threads ? { R5: { threads: [{ id: 't1' }] } } : {} }],
        markers: {
          threads: {
            t1: {
              id: 'T1',
              isResolved: false,
              viewerCanReply: true,
              commentsData: { comments: [{ databaseId: 11, author: { login: 'octocat' }, body: 'Looks off', bodyHTML: '<p>Looks off</p>', url: '', viewerCanUpdate: false, viewerCanDelete: false }] },
            },
          },
        },
        viewerPendingReview: opt.pending ? { id: 'PRR_1' } : null,
        pullRequest: { id: 'PR_1' },
        repository: { id: 'R_1' },
      },
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method ?? 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
      if (url === `/o/r/pull/${n}/changes`) return json(200, route(heads.length > 1 ? heads.shift()! : heads[0]));
      if (url.startsWith('/o/r/_styled/')) return json(200, { payload: { blob: { rawLines: LINES } } });
      if (url === `/o/r/pull/${n}/page_data/create_review_comment`) return json(200, {});
      return json(404, { message: 'Not Found' });
    }),
  );
  return calls;
}

/** PR n의 렌더링 본문 하나를 화면에 두고 코멘트 기능을 붙인다 */
function mount(n: number, hadThreads: boolean): HTMLElement {
  history.pushState({}, '', `/o/r/pull/${n}/changes`);
  const file = fakeFile('docs/a.md');
  file.querySelector('.diff-body')!.innerHTML = PROSE;
  const body = file.querySelector<HTMLElement>('.markdown-body')!;
  attachComments(file, body, 'docs/a.md', hadThreads);
  return body;
}

const move = (el: Element) => el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
const addButton = () => document.querySelector<HTMLButtonElement>('[data-mdf="add-comment"]')!;

/** 블록에 마우스를 올려 "+"를 띄운다 — 처음 올리면 원문을 받아 줄을 잇고, 다음에 올릴 때 나온다 */
async function hover(el: Element): Promise<void> {
  move(el);
  await vi.waitFor(async () => {
    await settle();
    move(el);
    expect(addButton().hidden).toBe(false);
  });
}

function typeAndPress(form: HTMLElement, text: string, label: string): void {
  const area = form.querySelector('textarea')!;
  area.value = text;
  area.dispatchEvent(new Event('input'));
  [...form.querySelectorAll<HTMLButtonElement>('.mdf-comment-actions > button')].find((b) => b.textContent === label)!.click();
}

describe('GitHub 백엔드로 붙인 코멘트(나누기 전과 같은 겉동작)', () => {
  afterEach(() => {
    detachAllComments();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('줄 스레드는 원문 줄이 맞는 블록 바로 뒤에 놓인다', async () => {
    github(201, { threads: true });
    const body = mount(201, true);
    await vi.waitFor(() => expect(body.querySelector('[data-mdf="thread"]')).not.toBeNull());
    expect(body.querySelector('#second')!.nextElementSibling?.getAttribute('data-mdf')).toBe('thread');
    expect(body.querySelector('[data-mdf="thread"] .mdf-thread-head')!.textContent).toContain('lineOne:5');
  });

  it('"+"를 눌러 쓴 코멘트는 그 줄로 바로 올리고(submitBatch), 올린 뒤 PR 데이터를 다시 읽는다', async () => {
    const calls = github(202);
    const body = mount(202, false);
    await hover(body.querySelector('#third')!);
    addButton().dispatchEvent(new MouseEvent('click', { detail: 0 }));
    const form = body.querySelector<HTMLElement>('[data-mdf="comment-form"]')!;
    expect(form.dataset.span).toBe('right:7-7');
    expect(form.querySelector('.mdf-comment-label')!.textContent).toBe('commentOnLine:R7');
    const changesBefore = calls.filter((c) => c.url.endsWith('/changes')).length;
    typeAndPress(form, 'Please reword', 'commentSingle');
    await vi.waitFor(() => expect(form.isConnected).toBe(false));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url).toBe('/o/r/pull/202/page_data/create_review_comment');
    expect(post.body).toMatchObject({ path: 'docs/a.md', line: 7, side: 'right', submitBatch: true, text: 'Please reword', comparisonEndOid: 'h1' });
    // 올리기 직전 한 번(새 커밋 확인) + 올린 뒤 다시 그리기 한 번
    expect(calls.filter((c) => c.url.endsWith('/changes')).length - changesBefore).toBe(2);
  });

  it('그 사이 새 커밋이 올라왔으면 올리지 않고 상자에 이유를 보인다', async () => {
    const calls = github(203, { heads: ['h1', 'h2'] });
    const body = mount(203, false);
    await hover(body.querySelector('#first')!);
    addButton().dispatchEvent(new MouseEvent('click', { detail: 0 }));
    const form = body.querySelector<HTMLElement>('[data-mdf="comment-form"]')!;
    typeAndPress(form, 'Late comment', 'commentSingle');
    await vi.waitFor(() => expect(form.querySelector<HTMLElement>('.mdf-comment-error')!.hidden).toBe(false));
    expect(form.querySelector('.mdf-comment-error')!.textContent).toBe('errorStale');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('보류 중인 리뷰가 있으면 리뷰에 넣기 버튼만 있고 리뷰로 올린다', async () => {
    const calls = github(204, { pending: true });
    const body = mount(204, false);
    await hover(body.querySelector('#first')!);
    addButton().dispatchEvent(new MouseEvent('click', { detail: 0 }));
    const form = body.querySelector<HTMLElement>('[data-mdf="comment-form"]')!;
    await vi.waitFor(() => expect([...form.querySelectorAll('.mdf-comment-actions > button')].map((b) => b.textContent)).toEqual(['cancel', 'commentReviewAdd']));
    typeAndPress(form, 'In review', 'commentReviewAdd');
    await vi.waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({ line: 3, submitBatch: false });
  });

  it('원문 보기에 스레드가 있었는데 여기서 못 찾으면 원문 보기 안내를 둔다', async () => {
    github(205, { threads: false });
    const body = mount(205, true);
    await vi.waitFor(() => expect(body.querySelector('[data-mdf="comment-notice"]')?.textContent).toContain('threadsUnavailable'));
  });

  it('끄면 "+"와 표시가 걷히고 마우스를 올려도 원문을 받지 않는다', async () => {
    const calls = github(206);
    const body = mount(206, false);
    expect(body.closest('.prose-diff')!.hasAttribute('data-mdf-comments')).toBe(true);
    detachAllComments();
    expect(document.querySelector('[data-mdf="add-comment"]')).toBeNull();
    expect(body.closest('.prose-diff')!.hasAttribute('data-mdf-comments')).toBe(false);
    move(body.querySelector('#first')!);
    await settle();
    expect(calls.some((c) => c.url.includes('/_styled/'))).toBe(false);
  });
});

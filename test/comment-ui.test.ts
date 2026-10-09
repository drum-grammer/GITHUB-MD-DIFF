import { describe, expect, it, vi } from 'vitest';
import { commentForm, fileThreadsBox, lineLabel, placeBox, safeFragment, threadBox, type ThreadHandlers } from '../src/comment-ui';
import type { ReviewComment, ReviewThread } from '../src/github-api';

function body(html: string): HTMLElement {
  document.body.innerHTML = `<div class="prose-diff"><div><div class="markdown-body">${html}</div></div></div>`;
  return document.querySelector<HTMLElement>('.markdown-body')!;
}
const box = () => Object.assign(document.createElement('div'), { className: 'box' });

describe('placeBox', () => {
  it('목록 항목은 항목 안, 안쪽 목록 앞', () => {
    const b = body('<ul><li id="a">위<ul><li>안쪽</li></ul></li></ul>');
    const x = box();
    placeBox(b.querySelector('#a')!, b, x);
    expect(x.parentElement?.id).toBe('a');
    expect(x.nextElementSibling?.tagName).toBe('UL');
  });

  it('표 행은 표(합친 표면 그 묶음) 뒤', () => {
    const b = body('<div data-mdf="table"><table><tr id="r"><td>x</td></tr></table></div><p>뒤</p>');
    const x = box();
    placeBox(b.querySelector('#r')!, b, x);
    expect(x.previousElementSibling?.getAttribute('data-mdf')).toBe('table');
  });

  it('지운 블록(<del>) 안이면 밖으로 나가고, 이미 붙은 상자가 있으면 그 뒤', () => {
    const b = body('<del><p id="p">지움</p></del><p>뒤</p>');
    const first = box();
    first.setAttribute('data-mdf', 'thread');
    placeBox(b.querySelector('#p')!, b, first);
    const second = box();
    placeBox(b.querySelector('#p')!, b, second);
    expect(first.previousElementSibling?.tagName).toBe('DEL');
    expect(second.previousElementSibling).toBe(first);
  });
});

describe('safeFragment', () => {
  it('스크립트·이벤트 속성·javascript: 주소를 뺀다', () => {
    const div = document.createElement('div');
    div.append(safeFragment(document, '<p onclick="x()">글<script>bad()</script><a href="javascript:x()">링크</a><a href="https://a.b">안전</a></p>'));
    expect(div.innerHTML).toBe('<p>글<a>링크</a><a href="https://a.b">안전</a></p>');
  });
});

describe('commentForm', () => {
  const opt = { label: 'lineOne:3', pendingReview: false, singleLabel: 'commentSingle' };

  it('바로 올리기와 리뷰 시작 — 빈 글은 보내지 않는다', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const f = commentForm(document, opt, { onSubmit, onCancel: vi.fn() });
    const [, single, review] = [...f.querySelectorAll('button')];
    single.click();
    expect(onSubmit).not.toHaveBeenCalled();
    f.querySelector('textarea')!.value = '좋아요';
    review.click();
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledWith('좋아요', 'review'));
  });

  it('보류 중인 리뷰가 있으면 리뷰에 넣기만, ⌘/Ctrl+Enter도 그쪽', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const f = commentForm(document, { ...opt, pendingReview: true }, { onSubmit, onCancel: vi.fn() });
    expect([...f.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['cancel', 'commentReviewAdd']);
    const area = f.querySelector('textarea')!;
    area.value = '글';
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledWith('글', 'review'));
  });

  it('실패하면 오류 문구를 보이고 글은 남긴다', async () => {
    const f = commentForm(document, opt, { onSubmit: vi.fn().mockRejectedValue(new Error('안 됨')), onCancel: vi.fn() });
    document.body.append(f);
    f.querySelector('textarea')!.value = '글';
    f.querySelectorAll('button')[1].click();
    await vi.waitFor(() => expect(f.querySelector<HTMLElement>('.mdf-comment-error')!.hidden).toBe(false));
    expect(f.querySelector('.mdf-comment-error')!.textContent).toBe('안 됨');
    expect(f.querySelector('textarea')!.value).toBe('글');
  });
});

describe('threadBox', () => {
  const thread: ReviewThread = {
    id: 'T1',
    subject: 'line',
    side: 'right',
    start: 3,
    end: 3,
    resolved: true,
    canReply: true,
    comments: [{ id: '1', author: 'me', body: '본문', bodyHTML: '<p>본문</p>', url: 'https://github.com/x', pending: true, bodyVersion: 'v', canEdit: false, canDelete: false }],
  };
  const handlers = (extra: Partial<ThreadHandlers> = {}): ThreadHandlers => ({ onReply: vi.fn(), onResolve: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), ...extra });

  it('해결된 스레드는 접어 두고, 머리를 누르면 펼친다', () => {
    const b = threadBox(document, thread, false, handlers());
    const inner = b.querySelector<HTMLElement>('.mdf-thread-body')!;
    expect(inner.hidden).toBe(true);
    b.querySelector<HTMLButtonElement>('.mdf-thread-head')!.click();
    expect(inner.hidden).toBe(false);
    expect(b.querySelector('.mdf-pending')).not.toBeNull();
  });

  it('해결 취소 버튼은 반대 상태로 부른다', async () => {
    const onResolve = vi.fn().mockResolvedValue(undefined);
    const b = threadBox(document, thread, false, handlers({ onResolve }));
    [...b.querySelectorAll('button')].find((x) => x.textContent === 'unresolve')!.click();
    await vi.waitFor(() => expect(onResolve).toHaveBeenCalledWith(thread, false));
  });
});

describe('내 코멘트 편집·삭제 · 미리보기(1.3.0)', () => {
  const mine = (extra: Partial<ReviewComment> = {}): ReviewComment => ({
    id: '9', author: 'me', body: '옛 **글**', bodyHTML: '<p>옛 <strong>글</strong></p>', url: '', pending: false,
    bodyVersion: 'v9', canEdit: true, canDelete: true, ...extra,
  });
  const thread = (c: ReviewComment): ReviewThread => ({ id: 'T9', subject: 'line', side: 'right', start: 2, end: 2, resolved: false, canReply: true, comments: [c] });
  const handlers = (extra: Partial<ThreadHandlers> = {}): ThreadHandlers => ({ onReply: vi.fn(), onResolve: vi.fn(), onEdit: vi.fn().mockResolvedValue(undefined), onDelete: vi.fn().mockResolvedValue(undefined), ...extra });
  const tool = (b: HTMLElement, name: string) => [...b.querySelectorAll<HTMLButtonElement>('.mdf-comment-tools button')].find((x) => x.textContent === name);

  it('고칠 수 있는 코멘트만 편집·삭제가 보인다', () => {
    expect(tool(threadBox(document, thread(mine()), false, handlers()), 'edit')).toBeTruthy();
    const other = threadBox(document, thread(mine({ canEdit: false, canDelete: false })), false, handlers());
    expect(other.querySelector('.mdf-comment-tools')).toBeNull();
  });

  it('편집 — 원래 글(마크다운)로 열고, 저장하면 onEdit(코멘트, 새 글)', async () => {
    const h = handlers();
    const b = threadBox(document, thread(mine()), false, h);
    tool(b, 'edit')!.click();
    const area = b.querySelector<HTMLTextAreaElement>('.mdf-comment-edit textarea')!;
    expect(area.value).toBe('옛 **글**');
    expect(b.querySelector<HTMLElement>('.mdf-comment-body')!.hidden).toBe(true);
    area.value = '새 글';
    [...b.querySelectorAll<HTMLButtonElement>('.mdf-comment-edit button')].find((x) => x.textContent === 'save')!.click();
    await vi.waitFor(() => expect(h.onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: '9', bodyVersion: 'v9' }), '새 글'));
  });

  it('삭제는 두 번 눌러야 — 처음엔 확인 문구로 바뀌고 4초 뒤 되돌아간다', async () => {
    vi.useFakeTimers();
    const h = handlers();
    const b = threadBox(document, thread(mine()), false, h);
    const del = tool(b, 'delete')!;
    del.click();
    expect(del.textContent).toBe('deleteConfirm');
    expect(h.onDelete).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4100);
    expect(del.textContent).toBe('delete');
    del.click();
    del.click();
    expect(h.onDelete).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('실패하면 그 코멘트 아래에 이유를 보이고 버튼을 되살린다', async () => {
    const h = handlers({ onDelete: vi.fn().mockRejectedValue(new Error('안 됨')) });
    const b = threadBox(document, thread(mine()), false, h);
    const del = tool(b, 'delete')!;
    del.click();
    del.click();
    await vi.waitFor(() => expect(b.querySelector<HTMLElement>('.mdf-comment > .mdf-comment-error')!.hidden).toBe(false));
    expect(b.querySelector('.mdf-comment > .mdf-comment-error')!.textContent).toBe('안 됨');
    expect(del.disabled).toBe(false);
  });

  it('미리보기 탭 — GitHub가 렌더링한 HTML을 걸러 보여 주고, 빈 글이면 안내만', async () => {
    const preview = vi.fn().mockResolvedValue('<p><strong>굵게</strong><img src="x" onerror="alert(1)"></p>');
    const form = commentForm(document, { label: 'L', pendingReview: false, singleLabel: 's', preview }, { onSubmit: vi.fn(), onCancel: vi.fn() });
    const [write, show] = [...form.querySelectorAll<HTMLButtonElement>('.mdf-tab')];
    const area = form.querySelector('textarea')!;
    const pane = form.querySelector<HTMLElement>('.mdf-preview')!;
    show.click();
    expect(pane.textContent).toBe('previewEmpty');
    expect(preview).not.toHaveBeenCalled();
    write.click();
    area.value = '**굵게**';
    show.click();
    await vi.waitFor(() => expect(pane.querySelector('strong')?.textContent).toBe('굵게'));
    expect(pane.querySelector('img')?.hasAttribute('onerror')).toBe(false);
    expect(area.hidden).toBe(true);
    write.click();
    expect(area.hidden).toBe(false);
  });

  it('미리보기가 없으면 탭도 없다(이전처럼 입력란만)', () => {
    const form = commentForm(document, { label: 'L', pendingReview: false, singleLabel: 's' }, { onSubmit: vi.fn(), onCancel: vi.fn() });
    expect(form.querySelector('.mdf-tabs')).toBeNull();
  });

  it('파일 전체 스레드 — 머리는 "파일 전체", 묶음은 파일 맨 위 상자', () => {
    expect(lineLabel({ subject: 'file', side: 'right', start: 0, end: 0 })).toBe('wholeFile');
    const box = threadBox(document, { ...thread(mine()), subject: 'file', start: 0, end: 0 }, false, handlers());
    expect(box.querySelector('.mdf-thread-head')?.textContent).toContain('wholeFile');
    const wrap = fileThreadsBox(document, [box]);
    expect(wrap.getAttribute('data-mdf')).toBe('threads-file');
    expect(wrap.firstElementChild?.textContent).toBe('threadsFile');
  });
});

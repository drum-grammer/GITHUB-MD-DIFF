import { describe, expect, it, vi } from 'vitest';
import { commentForm, placeBox, safeFragment, threadBox } from '../src/comment-ui';
import type { ReviewThread } from '../src/github-api';

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
    side: 'right',
    start: 3,
    end: 3,
    resolved: true,
    canReply: true,
    comments: [{ id: '1', author: 'me', body: '본문', bodyHTML: '<p>본문</p>', url: 'https://github.com/x', pending: true }],
  };

  it('해결된 스레드는 접어 두고, 머리를 누르면 펼친다', () => {
    const b = threadBox(document, thread, false, { onReply: vi.fn(), onResolve: vi.fn() });
    const inner = b.querySelector<HTMLElement>('.mdf-thread-body')!;
    expect(inner.hidden).toBe(true);
    b.querySelector<HTMLButtonElement>('.mdf-thread-head')!.click();
    expect(inner.hidden).toBe(false);
    expect(b.querySelector('.mdf-pending')).not.toBeNull();
  });

  it('해결 취소 버튼은 반대 상태로 부른다', async () => {
    const onResolve = vi.fn().mockResolvedValue(undefined);
    const b = threadBox(document, thread, false, { onReply: vi.fn(), onResolve });
    [...b.querySelectorAll('button')].find((x) => x.textContent === 'unresolve')!.click();
    await vi.waitFor(() => expect(onResolve).toHaveBeenCalledWith(thread, false));
  });
});

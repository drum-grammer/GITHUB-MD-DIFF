import { describe, expect, it, vi } from 'vitest';
import { applyBody } from '../src/apply';
import { commentForm, placeBox, safeFragment, threadBox } from '../src/comment-ui';
import { isCommitRangeView, type ReviewThread } from '../src/github-api';
import { sourceBlocks } from '../src/source-blocks';
import { mergedRow, setTableOriginal } from '../src/table-render';
import { loadFixture } from './helpers';

describe('합친 표 + 코멘트 상자', () => {
  it('합친 표의 행에 붙인 상자는 숨긴 <ins> 뒤 — 다시 훑어도 표가 둘이 되지 않고 원래 표 전환도 된다', () => {
    const body = loadFixture('handmade-prose.html');
    applyBody(body);
    const wrap = body.querySelector<HTMLElement>('[data-mdf="table"]')!;
    const row = wrap.querySelector<HTMLElement>('tr.mdf-row-changed')!;
    const box = document.createElement('div');
    box.setAttribute('data-mdf', 'thread');
    placeBox(row, body, box);
    expect(box.previousElementSibling?.tagName).toBe('INS');
    applyBody(body); // 상자를 넣어 생긴 DOM 변화로 다시 훑는다
    expect(body.querySelectorAll('[data-mdf="table"]')).toHaveLength(1);
    setTableOriginal(wrap, true);
    expect(wrap.nextElementSibling?.classList.contains('mdf-hidden')).toBe(false);
    setTableOriginal(wrap, false);
    expect(wrap.nextElementSibling?.classList.contains('mdf-hidden')).toBe(true);
  });

  it('바뀐 행은 옛 행·새 행 모두 합친 표의 같은 행으로 찾는다', () => {
    const body = loadFixture('handmade-prose.html');
    applyBody(body);
    const changed = body.querySelector('[data-mdf="table"] tr.mdf-row-changed')!;
    const [oldTable, newTable] = [...body.querySelectorAll(':scope > del table, :scope > ins table')] as HTMLTableElement[];
    const text = (changed.querySelector('td')?.textContent ?? '').trim();
    const same = (t: HTMLTableElement) => [...t.rows].find((r) => r.cells[0]?.textContent?.trim() === text)!;
    expect(mergedRow(same(newTable))).toBe(changed);
    expect(mergedRow(same(oldTable))).toBe(changed);
  });
});

describe('입력 상자', () => {
  it('⌘/Ctrl+Enter를 올리는 중에 또 눌러도 한 번만 보낸다', async () => {
    let finish!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((r) => (finish = r)));
    const f = commentForm(document, { label: '', pendingReview: false, singleLabel: 's' }, { onSubmit, onCancel: vi.fn() });
    const area = f.querySelector('textarea')!;
    area.value = '글';
    const enter = () => area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true }));
    enter();
    enter();
    finish();
    await vi.waitFor(() => expect(f.dataset.busy).toBeUndefined());
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('다시 그린 스레드는 쓰다 만 답글을 열어 둔다', () => {
    const thread: ReviewThread = {
      id: 'T',
      subject: 'line',
      side: 'right',
      start: 1,
      end: 1,
      resolved: true,
      canReply: true,
      comments: [{ id: '1', author: 'a', body: 'x', bodyHTML: '', url: '', pending: false, bodyVersion: '', canEdit: false, canDelete: false }],
    };
    const box = threadBox(document, thread, false, { onReply: vi.fn(), onResolve: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn() }, '쓰던 글');
    expect(box.querySelector('textarea')?.value).toBe('쓰던 글');
    expect(box.querySelector<HTMLElement>('.mdf-thread-body')!.hidden).toBe(false);
  });
});

describe('그 밖', () => {
  it('탭이 낀 javascript: 주소도 뺀다', () => {
    const div = document.createElement('div');
    div.append(safeFragment(document, '<a href="java&#9;script:alert(1)">x</a><a href="/o/r">y</a>'));
    expect(div.innerHTML).toBe('<a>x</a><a href="/o/r">y</a>');
  });

  it('할 일 표시([ ]·[x])는 항목 글에서 뺀다', () => {
    expect(sourceBlocks('- [x] 끝낸 일\n- [ ] 할 일').map((b) => b.text)).toEqual(['끝낸 일', '할 일']);
  });

  it('커밋 일부만 보는 화면은 코멘트를 막는다', () => {
    expect(isCommitRangeView('https://github.com/o/r/pull/1/changes')).toBe(false);
    expect(isCommitRangeView('https://github.com/o/r/pull/1/changes/abc123')).toBe(true);
    expect(isCommitRangeView('https://github.com/o/r/pull/1/files/a..b')).toBe(true);
  });
});

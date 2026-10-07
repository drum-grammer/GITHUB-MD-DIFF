import { beforeEach, describe, expect, it } from 'vitest';
import { mergeTablePair, setTableAllRows, setTableOriginal } from '../src/table-render';
import { tablePairs, type TablePair } from '../src/selectors';
import { loadFixture } from './helpers';

const hidden = (el: Element | null) => el?.classList.contains('mdf-hidden') ?? false;
const visibleRows = (wrap: HTMLElement) =>
  [...wrap.querySelectorAll<HTMLTableRowElement>('tbody > tr')].filter((r) => !hidden(r));

function makePair(oldBody: string[][], newBody: string[][], head = ['이름', '상태']): TablePair {
  const table = (rows: string[][]) =>
    `<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows
      .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
      .join('')}</tbody></table>`;
  document.body.innerHTML = `<div class="markdown-body"><del><x-t>${table(oldBody)}</x-t></del><ins><x-t>${table(newBody)}</x-t></ins></div>`;
  return tablePairs(document.querySelector('.markdown-body')!)[0];
}

describe('mergeTablePair — 고정 자료', () => {
  let body: HTMLElement;
  let pair: TablePair;
  let wrap: HTMLElement;
  beforeEach(() => {
    body = loadFixture('handmade-prose.html');
    pair = tablePairs(body)[0];
    wrap = mergeTablePair(pair)!;
  });

  it('합친 표를 del 바로 앞에 넣고 옛 표·새 표를 숨긴다', () => {
    expect(wrap.getAttribute('data-mdf')).toBe('table');
    expect(wrap.nextElementSibling).toBe(pair.del);
    expect(hidden(pair.del)).toBe(true);
    expect(hidden(pair.ins)).toBe(true);
  });

  it('보이는 행은 접기 행·바뀐 행·접기 행·추가 행', () => {
    expect(visibleRows(wrap).map((r) => r.className)).toEqual([
      'mdf-fold-row', 'mdf-row-changed', 'mdf-fold-row', 'mdf-row-added',
    ]);
    expect(wrap.querySelectorAll('thead th')).toHaveLength(2);
  });

  it('바뀐 칸은 옛 값과 새 값을 같이 보여 준다', () => {
    const changed = wrap.querySelector<HTMLTableRowElement>('tr.mdf-row-changed')!;
    expect(changed.querySelector('.mdf-cell-old')?.textContent).toBe('진행');
    expect(changed.querySelector('.mdf-cell-new')?.textContent).toBe('완료');
    expect(changed.cells[0].textContent).toBe('나');
  });

  it('접기 행 문구에 같은 행 수, 누르면 그 구간만 펼친다', () => {
    const bars = [...wrap.querySelectorAll<HTMLElement>('[data-mdf="fold-rows"]')];
    expect(bars.map((b) => b.textContent)).toEqual(['▸foldRowOne', '▸foldRows:2']);
    bars[1].click();
    expect(visibleRows(wrap).map((r) => r.cells[0].textContent)).toContain('다');
    expect(visibleRows(wrap).map((r) => r.cells[0].textContent)).not.toContain('가');
    expect(bars[1].getAttribute('aria-expanded')).toBe('true');
  });

  it('전체 행 ↔ 바뀐 행만', () => {
    const btn = wrap.querySelector<HTMLElement>('[data-mdf-action="all-rows"]')!;
    btn.click();
    expect(wrap.querySelectorAll('tr.mdf-row-same.mdf-hidden')).toHaveLength(0);
    expect(btn.textContent).toBe('tableChangedRows');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    setTableAllRows(wrap, false);
    expect(wrap.querySelectorAll('tr.mdf-row-same.mdf-hidden')).toHaveLength(3);
    expect(btn.textContent).toBe('tableAllRows');
  });

  it('원래 표 ↔ 합친 표', () => {
    const btn = wrap.querySelector<HTMLElement>('[data-mdf-action="original"]')!;
    btn.click();
    expect(hidden(wrap.querySelector('table'))).toBe(true);
    expect(hidden(pair.del)).toBe(false);
    expect(hidden(pair.ins)).toBe(false);
    expect(btn.textContent).toBe('tableMerged');
    setTableOriginal(wrap, false);
    expect(hidden(wrap.querySelector('table'))).toBe(false);
    expect(hidden(pair.del)).toBe(true);
  });

  it('이미 합친 쌍은 다시 합치지 않는다', () => {
    expect(mergeTablePair(tablePairs(body)[0])).toBeNull();
    expect(body.querySelectorAll('[data-mdf="table"]')).toHaveLength(1);
  });
});

describe('mergeTablePair — 합치지 않는 경우', () => {
  it('머리 행이 다르면', () => {
    const pair = makePair([['가', '1']], [['가', '2']]);
    pair.newTable.tHead!.rows[0].cells[1].textContent = '단계';
    expect(mergeTablePair(pair)).toBeNull();
  });

  it('병합 칸이 있으면', () => {
    const pair = makePair([['가', '1']], [['가', '2']]);
    pair.newTable.tBodies[0].rows[0].cells[0].setAttribute('colspan', '2');
    expect(mergeTablePair(pair)).toBeNull();
  });

  it('본문 행이 2,000개를 넘으면', () => {
    const many = Array.from({ length: 2001 }, (_, i) => [`k${i}`, 'v']);
    const pair = makePair(many, [...many.slice(0, 2000), ['k2000', 'w']]);
    expect(mergeTablePair(pair)).toBeNull();
  });

  it('글자로는 전부 같으면(서식만 바뀜)', () => {
    const pair = makePair([['가', '1']], [['가', '1']]);
    pair.newTable.tBodies[0].rows[0].cells[1].innerHTML = '<strong>1</strong>';
    expect(mergeTablePair(pair)).toBeNull();
    expect(hidden(pair.del)).toBe(false);
  });
});

describe('mergeTablePair — 삭제 행', () => {
  it('삭제 행은 옛 행을 복제해 원래 자리에 둔다', () => {
    const pair = makePair([['가', '1'], ['나', '2'], ['다', '3']], [['가', '1'], ['다', '3']]);
    const wrap = mergeTablePair(pair)!;
    const removed = wrap.querySelector<HTMLTableRowElement>('tr.mdf-row-removed')!;
    expect(removed.cells[0].textContent).toBe('나');
  });
});

import { describe, expect, it } from 'vitest';
import { diffRows, normalizeCell, type Row } from '../src/table-diff';

const R = (...cells: string[]): Row => cells;

describe('normalizeCell', () => {
  it('앞뒤 공백을 지우고 연속 공백을 하나로', () => {
    expect(normalizeCell('  a \n  b ')).toBe('a b');
  });
});

describe('diffRows', () => {
  it('같은 표는 전부 same', () => {
    const rows = [R('가', '1'), R('나', '2')];
    expect(diffRows(rows, rows)).toEqual([
      { kind: 'same', oldIndex: 0, newIndex: 0 },
      { kind: 'same', oldIndex: 1, newIndex: 1 },
    ]);
  });

  it('칸 하나가 바뀌면 changed와 그 칸 번호', () => {
    expect(diffRows([R('가', '대기'), R('나', '진행')], [R('가', '대기'), R('나', '완료')])).toEqual([
      { kind: 'same', oldIndex: 0, newIndex: 0 },
      { kind: 'changed', oldIndex: 1, newIndex: 1, changedCells: [1] },
    ]);
  });

  it('행 추가', () => {
    expect(diffRows([R('가'), R('다')], [R('가'), R('나'), R('다')])).toEqual([
      { kind: 'same', oldIndex: 0, newIndex: 0 },
      { kind: 'added', newIndex: 1 },
      { kind: 'same', oldIndex: 1, newIndex: 2 },
    ]);
  });

  it('행 삭제', () => {
    expect(diffRows([R('가'), R('나'), R('다')], [R('가'), R('다')])).toEqual([
      { kind: 'same', oldIndex: 0, newIndex: 0 },
      { kind: 'removed', oldIndex: 1 },
      { kind: 'same', oldIndex: 2, newIndex: 1 },
    ]);
  });

  it('첫 칸이 같은 행끼리 짝짓는다 — 순서가 바뀌어도', () => {
    expect(diffRows([R('가', '1'), R('나', '2')], [R('나', '9'), R('가', '8')])).toEqual([
      { kind: 'changed', oldIndex: 1, newIndex: 0, changedCells: [1] },
      { kind: 'changed', oldIndex: 0, newIndex: 1, changedCells: [1] },
    ]);
  });

  it('같은 첫 칸이 둘이면 그 행들은 순서로 짝짓는다', () => {
    expect(diffRows([R('미확인', 'a'), R('미확인', 'b')], [R('미확인', 'a2'), R('미확인', 'b2')])).toEqual([
      { kind: 'changed', oldIndex: 0, newIndex: 0, changedCells: [1] },
      { kind: 'changed', oldIndex: 1, newIndex: 1, changedCells: [1] },
    ]);
  });

  it('첫 칸이 빈 행은 첫 칸으로 짝짓지 않는다', () => {
    expect(diffRows([R('', 'a'), R('나', 'b')], [R('나', 'b2'), R('', 'a2')])).toEqual([
      { kind: 'changed', oldIndex: 1, newIndex: 0, changedCells: [1] },
      { kind: 'changed', oldIndex: 0, newIndex: 1, changedCells: [1] },
    ]);
  });

  it('짝이 안 맞는 나머지는 삭제 먼저, 그다음 추가', () => {
    expect(diffRows([R('가', '1')], [R('나', '2'), R('다', '3')])).toEqual([
      { kind: 'removed', oldIndex: 0 },
      { kind: 'added', newIndex: 0 },
      { kind: 'added', newIndex: 1 },
    ]);
  });

  it('짝지은 두 행의 글자가 모두 같으면 same', () => {
    // 옛 [가1, 가1] 새 [가1] — LCS가 하나를 same으로, 남은 하나는 삭제
    expect(diffRows([R('가', '1'), R('가', '1')], [R('가', '1')]).filter((o) => o.kind !== 'same')).toEqual([
      { kind: 'removed', oldIndex: 1 },
    ]);
  });

  it('칸 수가 늘면 늘어난 칸도 바뀐 칸', () => {
    expect(diffRows([R('가', '1')], [R('가', '1', 'x')])).toEqual([
      { kind: 'changed', oldIndex: 0, newIndex: 0, changedCells: [2] },
    ]);
  });

  it('빈 표', () => {
    expect(diffRows([], [])).toEqual([]);
    expect(diffRows([], [R('가')])).toEqual([{ kind: 'added', newIndex: 0 }]);
  });

  it('1,500행에서 한 행만 바뀌면 0.5초 안에 그 행만 나온다', () => {
    const old = Array.from({ length: 1500 }, (_, i) => R(`k${i}`, 'v'));
    const neu = old.map((r, i) => (i === 700 ? R(`k${i}`, 'w') : r));
    const t0 = performance.now();
    const ops = diffRows(old, neu);
    expect(performance.now() - t0).toBeLessThan(500);
    expect(ops.filter((o) => o.kind !== 'same')).toEqual([
      { kind: 'changed', oldIndex: 700, newIndex: 700, changedCells: [1] },
    ]);
  });

  it('1,500행 순서가 통째로 뒤집혀도 2초 안에 끝난다', () => {
    const old = Array.from({ length: 1500 }, (_, i) => R(`k${i}`, `v${i}`));
    const t0 = performance.now();
    const ops = diffRows(old, [...old].reverse());
    expect(performance.now() - t0).toBeLessThan(2000);
    // 뒤집힌 행은 덩어리가 갈려 삭제·추가로 나온다 — 옛 행·새 행이 각각 정확히 한 번씩
    const olds = ops.flatMap((o) => ('oldIndex' in o ? [o.oldIndex] : [])).sort((a, b) => a - b);
    const news = ops.flatMap((o) => ('newIndex' in o ? [o.newIndex] : [])).sort((a, b) => a - b);
    expect(olds).toEqual(old.map((_, i) => i));
    expect(news).toEqual(old.map((_, i) => i));
  });
});

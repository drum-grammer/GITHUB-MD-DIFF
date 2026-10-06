/** 표 행 비교 — DOM을 모르는 순수 함수. 칸 글자 배열만 받는다 */
export type Row = string[];

export type RowOp =
  | { kind: 'same'; oldIndex: number; newIndex: number }
  | { kind: 'changed'; oldIndex: number; newIndex: number; changedCells: number[] }
  | { kind: 'added'; newIndex: number }
  | { kind: 'removed'; oldIndex: number };

export function normalizeCell(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

const rowKey = (row: Row): string => row.join('\u0001');
const range = (from: number, to: number): number[] =>
  Array.from({ length: Math.max(0, to - from) }, (_, k) => from + k);

/** 글자가 같은 행 짝 [옛, 새]을 오름차순으로. 앞뒤 공통 행을 먼저 떼고 가운데만 LCS를 돈다 */
function matchSameRows(oldRows: Row[], newRows: Row[]): Array<[number, number]> {
  const a = oldRows.map(rowKey);
  const b = newRows.map(rowKey);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < start; i++) pairs.push([i, i]);

  const n = endA - start;
  const m = endB - start;
  const w = m + 1;
  // dp[i*w+j] = a[start+i..endA)와 b[start+j..endB)의 LCS 길이
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] =
        a[start + i] === b[start + j]
          ? dp[(i + 1) * w + j + 1] + 1
          : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[start + i] === b[start + j]) {
      pairs.push([start + i, start + j]);
      i++;
      j++;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  for (let k = 0; k < a.length - endA; k++) pairs.push([endA + k, endB + k]);
  return pairs;
}

function changedCells(oldRow: Row, newRow: Row): number[] {
  const out: number[] = [];
  for (let c = 0; c < Math.max(oldRow.length, newRow.length); c++) {
    if ((oldRow[c] ?? '') !== (newRow[c] ?? '')) out.push(c);
  }
  return out;
}

/** 첫 칸 → 그 첫 칸을 가진 행 번호들(빈 첫 칸은 뺀다) */
function byFirstCell(rows: Row[], idx: number[]): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (const i of idx) {
    const k = rows[i][0] ?? '';
    if (k) m.set(k, [...(m.get(k) ?? []), i]);
  }
  return m;
}

/**
 * 바뀐 덩어리 안에서 옛 행·새 행을 짝짓는다.
 * ① 첫 칸이 양쪽에 하나씩만 있으면 그 둘 ② 남은 개수가 같으면 순서대로 ③ 나머지는 삭제·추가
 */
function pairHunk(oldIdx: number[], newIdx: number[], oldRows: Row[], newRows: Row[]): RowOp[] {
  const pairedNew = new Map<number, number>(); // 새 행 → 옛 행
  const oldByKey = byFirstCell(oldRows, oldIdx);
  const newByKey = byFirstCell(newRows, newIdx);
  for (const [k, olds] of oldByKey) {
    const news = newByKey.get(k);
    if (olds.length === 1 && news?.length === 1) pairedNew.set(news[0], olds[0]);
  }
  const usedOld = new Set(pairedNew.values());
  let restOld = oldIdx.filter((i) => !usedOld.has(i));
  const restNew = newIdx.filter((i) => !pairedNew.has(i));
  if (restOld.length === restNew.length) {
    restNew.forEach((nIdx, k) => pairedNew.set(nIdx, restOld[k]));
    restOld = [];
  }

  const ops: RowOp[] = restOld.map((o) => ({ kind: 'removed', oldIndex: o }) as RowOp);
  for (const nIdx of newIdx) {
    const o = pairedNew.get(nIdx);
    if (o === undefined) {
      ops.push({ kind: 'added', newIndex: nIdx });
      continue;
    }
    const cells = changedCells(oldRows[o], newRows[nIdx]);
    ops.push(
      cells.length === 0
        ? { kind: 'same', oldIndex: o, newIndex: nIdx }
        : { kind: 'changed', oldIndex: o, newIndex: nIdx, changedCells: cells },
    );
  }
  return ops;
}

/** 옛 표 본문 행과 새 표 본문 행을 비교해 새 표 순서의 연산 목록을 돌려준다 */
export function diffRows(oldRows: Row[], newRows: Row[]): RowOp[] {
  const ops: RowOp[] = [];
  let o = 0;
  let n = 0;
  const flush = (oEnd: number, nEnd: number) => {
    const oldIdx = range(o, oEnd);
    const newIdx = range(n, nEnd);
    if (oldIdx.length || newIdx.length) ops.push(...pairHunk(oldIdx, newIdx, oldRows, newRows));
  };
  for (const [so, sn] of matchSameRows(oldRows, newRows)) {
    flush(so, sn);
    ops.push({ kind: 'same', oldIndex: so, newIndex: sn });
    o = so + 1;
    n = sn + 1;
  }
  flush(oldRows.length, newRows.length);
  return ops;
}

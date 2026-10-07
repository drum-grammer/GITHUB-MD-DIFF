/** 렌더링 블록 줄과 원문 블록 줄을 순서대로 맞춘다 — DOM을 모르는 순수 함수 */
import { normalizeText, type BlockKind } from './source-blocks';

export interface AlignItem {
  kind: BlockKind;
  text: string;
}

/** 이보다 비슷하면(글자 두 개씩 묶음의 Dice 계수) 같은 블록으로 본다 */
export const MIN_SIMILARITY = 0.6;
/** 똑같은 블록 사이 틈이 이보다 크면(칸 수) 비슷한 것은 맞추지 않는다 — 계산이 길어지지 않게 */
export const GAP_CELLS = 20_000;
/** 칸 수가 이보다 많으면 표를 만들지 않고 앞에서부터 똑같은 것을 찾는다(메모리) */
export const MAX_CELLS = 4_000_000;

type Bigrams = Map<string, number>;

function bigrams(s: string): Bigrams {
  const m: Bigrams = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

function dice(a: string, b: string, ga: Bigrams, gb: Bigrams): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const [small, large] = ga.size <= gb.size ? [ga, gb] : [gb, ga];
  let common = 0;
  for (const [g, n] of small) common += Math.min(n, large.get(g) ?? 0);
  return (2 * common) / (a.length - 1 + (b.length - 1));
}

export function similarity(a: string, b: string): number {
  return dice(a, b, bigrams(a), bigrams(b));
}

/** 글자 수만 보고 Dice가 넘을 수 없는 짝은 건너뛴다 */
const mayBeSimilar = (a: string, b: string): boolean =>
  (2 * Math.min(a.length, b.length)) / (a.length + b.length) >= MIN_SIMILARITY;

/** 똑같은 열쇠끼리의 최장 공통 부분열 — 앞뒤 공통 부분을 먼저 떼고 가운데만 표로 돈다 */
function exactPairs(a: string[], b: string[]): Array<[number, number]> {
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
  if (n * m > MAX_CELLS) {
    // 아주 긴 문서 — 같은 열쇠를 앞으로만 찾는다
    const where = new Map<string, number[]>();
    for (let j = start; j < endB; j++) where.set(b[j], [...(where.get(b[j]) ?? []), j]);
    let next = start;
    for (let i = start; i < endA; i++) {
      const j = where.get(a[i])?.find((k) => k >= next);
      if (j !== undefined) {
        pairs.push([i, j]);
        next = j + 1;
      }
    }
  } else {
    const w = m + 1;
    const dp = new Uint32Array((n + 1) * w); // dp[i*w+j] = a[start+i..), b[start+j..)의 길이
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] =
          a[start + i] === b[start + j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[start + i] === b[start + j]) {
        pairs.push([start + i, start + j]);
        i++;
        j++;
      } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++;
      else j++;
    }
  }
  for (let k = 0; endA + k < a.length; k++) pairs.push([endA + k, endB + k]);
  return pairs;
}

/**
 * dom[i]에 맞는 src 번호(없으면 -1). 먼저 종류·글자가 똑같은 블록으로 순서를 지키는 기준점을 잡고,
 * 기준점 사이 틈에서만 종류가 같고 비슷한(0.6 이상) 블록을 비슷한 정도의 합이 가장 크게 짝짓는다.
 */
export function alignBlocks(dom: AlignItem[], src: AlignItem[]): number[] {
  const a = dom.map((d) => normalizeText(d.text));
  const b = src.map((s) => normalizeText(s.text));
  const out = new Array<number>(dom.length).fill(-1);
  const anchors = exactPairs(
    dom.map((d, i) => `${d.kind}\u0001${a[i]}`),
    src.map((s, j) => `${s.kind}\u0001${b[j]}`),
  );
  for (const [i, j] of anchors) out[i] = j;

  const ga = new Map<number, Bigrams>();
  const gb = new Map<number, Bigrams>();
  const gramsA = (i: number) => ga.get(i) ?? ga.set(i, bigrams(a[i])).get(i)!;
  const gramsB = (j: number) => gb.get(j) ?? gb.set(j, bigrams(b[j])).get(j)!;
  const fillGap = (i0: number, i1: number, j0: number, j1: number): void => {
    const n = i1 - i0;
    const m = j1 - j0;
    if (n <= 0 || m <= 0 || n * m > GAP_CELLS) return;
    const score = (i: number, j: number): number => {
      if (dom[i].kind !== src[j].kind || !mayBeSimilar(a[i], b[j])) return 0;
      const s = dice(a[i], b[j], gramsA(i), gramsB(j));
      return s >= MIN_SIMILARITY ? s : 0;
    };
    const w = m + 1;
    const f = new Float64Array((n + 1) * w);
    const pick = new Float64Array(n * m);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        const s = score(i0 + i, j0 + j);
        pick[i * m + j] = s;
        const both = s > 0 ? s + f[(i + 1) * w + j + 1] : 0;
        f[i * w + j] = Math.max(both, f[(i + 1) * w + j], f[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      const s = pick[i * m + j];
      if (s > 0 && f[i * w + j] === s + f[(i + 1) * w + j + 1]) {
        out[i0 + i] = j0 + j;
        i++;
        j++;
      } else if (f[i * w + j] === f[(i + 1) * w + j]) i++;
      else j++;
    }
  };
  let prevI = -1;
  let prevJ = -1;
  for (const [i, j] of [...anchors, [dom.length, src.length] as [number, number]]) {
    fillGap(prevI + 1, i, prevJ + 1, j);
    prevI = i;
    prevJ = j;
  }
  return out;
}

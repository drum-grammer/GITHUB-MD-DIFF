/** 렌더링 블록 줄과 원문 블록 줄을 순서대로 맞춘다 — DOM을 모르는 순수 함수 */
import { normalizeText, type BlockKind } from './source-blocks';

export interface AlignItem {
  kind: BlockKind;
  text: string;
}

/** 이보다 비슷하면(글자 두 개씩 묶음의 Dice 계수) 같은 블록으로 본다 */
export const MIN_SIMILARITY = 0.6;
/** 칸 수가 이보다 많으면 비슷한 것은 보지 않고 똑같은 것만 맞춘다(아주 긴 문서에서 느려지지 않게) */
export const SIMILARITY_CELLS = 250_000;
/** 칸 수가 이보다 많으면 표를 만들지 않고 앞에서부터 똑같은 것을 찾는다(메모리) */
export const MAX_CELLS = 4_000_000;

/** 아주 긴 문서용 — 같은 종류·같은 글자인 원문 블록을 앞으로만 찾아 맞춘다 */
function alignGreedy(dom: AlignItem[], a: string[], src: AlignItem[], b: string[]): number[] {
  const where = new Map<string, number[]>();
  b.forEach((text, j) => {
    const key = `${src[j].kind}\u0001${text}`;
    where.set(key, [...(where.get(key) ?? []), j]);
  });
  let next = 0;
  return a.map((text, i) => {
    const j = where.get(`${dom[i].kind}\u0001${text}`)?.find((k) => k >= next) ?? -1;
    if (j >= 0) next = j + 1;
    return j;
  });
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const ga = bigrams(a);
  const gb = bigrams(b);
  let common = 0;
  for (const [g, n] of ga) common += Math.min(n, gb.get(g) ?? 0);
  return (2 * common) / (a.length - 1 + (b.length - 1));
}

/**
 * dom[i]에 맞는 src 번호(없으면 -1). 순서를 지키며 점수 합이 가장 큰 짝을 고른다 —
 * 종류가 같고 글자가 같으면 2점, 비슷하면 그 비슷한 정도(0.6~1). 빈 글자 블록은 같은 종류끼리만 1점.
 */
export function alignBlocks(dom: AlignItem[], src: AlignItem[]): number[] {
  const n = dom.length;
  const m = src.length;
  const a = dom.map((d) => normalizeText(d.text));
  const b = src.map((s) => normalizeText(s.text));
  if (n * m > MAX_CELLS) return alignGreedy(dom, a, src, b);
  const fuzzy = n * m <= SIMILARITY_CELLS;
  const score = (i: number, j: number): number => {
    if (dom[i].kind !== src[j].kind) return 0;
    if (a[i] === b[j]) return a[i] ? 2 : 1;
    if (!fuzzy) return 0;
    const s = similarity(a[i], b[j]);
    return s >= MIN_SIMILARITY ? s : 0;
  };
  const w = m + 1;
  // f[i*w+j] = dom[i..), src[j..)의 최고 점수
  const f = new Float64Array((n + 1) * w);
  const pick = new Float64Array(n * m); // 짝지은 경우의 점수(0이면 짝 불가)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const s = score(i, j);
      pick[i * m + j] = s;
      const both = s > 0 ? s + f[(i + 1) * w + j + 1] : 0;
      f[i * w + j] = Math.max(both, f[(i + 1) * w + j], f[i * w + j + 1]);
    }
  }
  const out = new Array<number>(n).fill(-1);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const s = pick[i * m + j];
    if (s > 0 && f[i * w + j] === s + f[(i + 1) * w + j + 1]) {
      out[i] = j;
      i++;
      j++;
    } else if (f[i * w + j] === f[(i + 1) * w + j]) i++;
    else j++;
  }
  return out;
}

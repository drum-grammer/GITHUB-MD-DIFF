/**
 * 옛 잎 ↔ 새 잎 짝짓기(스펙 §4-2 3). 확장 alignBlocks를 더 큰 한도로 쓰고, 그래도 비슷한 짝을 찾지 않은 큰 틈은
 * ① 제목 잎 경계로 쪼개 다시 맞추고 ② 그래도 크면 같은 종류끼리 개수가 같을 때 차례대로 1:1로 짝지은 뒤 Dice 0.6 미만인 짝만 푼다
 */
import { MIN_SIMILARITY, alignBlocks, similarity, type AlignItem } from '../../../src/align';
import { normalizeText } from '../../../src/source-blocks';

/** 엔진 기본 한도 — 시간 측정(test/perf.test.ts)으로 정했다. 확장 기본값은 20,000·4,000,000 */
export const ENGINE_GAP_CELLS = 250_000;
export const ENGINE_MAX_CELLS = 4_000_000;

export interface PairOptions {
  gapCells: number;
  maxCells: number;
}

/** 새 잎마다 짝인 옛 잎 번호(없으면 -1) */
export function alignLeaves(news: AlignItem[], olds: AlignItem[], opts: PairOptions): number[] {
  const out = alignBlocks(news, olds, opts);
  forEachGap(out, olds.length, (i0, i1, j0, j1) => refine(news, olds, out, i0, i1, j0, j1, opts));
  return out;
}

/** 짝 사이의 틈(양쪽 다 짝 없는 잎이 있는 구간)마다 f(새 시작, 새 끝, 옛 시작, 옛 끝) — 끝은 미포함 */
function forEachGap(out: number[], oldCount: number, f: (i0: number, i1: number, j0: number, j1: number) => void): void {
  let pi = -1;
  let pj = -1;
  const anchors = out.map((j, i) => [i, j] as [number, number]).filter(([, j]) => j >= 0);
  for (const [i, j] of [...anchors, [out.length, oldCount] as [number, number]]) {
    if (i - pi > 1 && j - pj > 1) f(pi + 1, i, pj + 1, j);
    pi = i;
    pj = j;
  }
}

function refine(news: AlignItem[], olds: AlignItem[], out: number[], i0: number, i1: number, j0: number, j1: number, opts: PairOptions): void {
  if ((i1 - i0) * (j1 - j0) <= opts.gapCells) return; // alignBlocks가 이미 비슷한 짝을 찾은 틈
  const hn = range(i0, i1).filter((i) => news[i].kind === 'heading');
  const ho = range(j0, j1).filter((j) => olds[j].kind === 'heading');
  if (hn.length && ho.length) {
    // ① 제목끼리 먼저 맞춰 틈을 쪼갠다
    const hp = alignBlocks(hn.map((i) => news[i]), ho.map((j) => olds[j]), opts);
    const cuts: Array<[number, number]> = [];
    hp.forEach((k, a) => {
      if (k >= 0) cuts.push([hn[a], ho[k]]);
    });
    if (cuts.length) {
      let pi = i0 - 1;
      let pj = j0 - 1;
      for (const [i, j] of [...cuts, [i1, j1] as [number, number]]) {
        if (i < i1) out[i] = j;
        subAlign(news, olds, out, pi + 1, i, pj + 1, j, opts);
        pi = i;
        pj = j;
      }
      return;
    }
  }
  sameCount(news, olds, out, i0, i1, j0, j1);
}

/** 쪼갠 틈 안을 다시 맞춘다. 그래도 크면 같은 개수 1:1 */
function subAlign(news: AlignItem[], olds: AlignItem[], out: number[], i0: number, i1: number, j0: number, j1: number, opts: PairOptions): void {
  if (i1 <= i0 || j1 <= j0) return;
  if ((i1 - i0) * (j1 - j0) > opts.gapCells) {
    sameCount(news, olds, out, i0, i1, j0, j1);
    return;
  }
  const sub = alignBlocks(news.slice(i0, i1), olds.slice(j0, j1), opts);
  sub.forEach((k, a) => {
    if (k >= 0) out[i0 + a] = j0 + k;
  });
}

/** ② 같은 종류끼리 개수가 같으면 차례대로 짝짓고, 비슷하지 않은(0.6 미만) 짝은 푼다 */
function sameCount(news: AlignItem[], olds: AlignItem[], out: number[], i0: number, i1: number, j0: number, j1: number): void {
  const kinds = new Set(range(i0, i1).map((i) => news[i].kind));
  const used = new Set(out.filter((j) => j >= 0));
  for (const kind of kinds) {
    const a = range(i0, i1).filter((i) => out[i] < 0 && news[i].kind === kind);
    const b = range(j0, j1).filter((j) => olds[j].kind === kind && !used.has(j));
    if (a.length !== b.length) {
      banded(news, olds, out, a, b);
      continue;
    }
    a.forEach((i, k) => {
      if (similarity(normalizeText(news[i].text), normalizeText(olds[b[k]].text)) >= MIN_SIMILARITY) out[i] = b[k];
    });
  }
}

/**
 * ③ 개수가 다르면(문단 하나를 더하거나 뺐다) 대각선 띠(폭 |개수 차| + 16) 안에서 차례를 지키며 비슷한 정도의 합이 가장 크게 짝짓는다.
 * 0.6 미만은 짝이 아니다. 띠 밖은 보지 않으므로 칸 수는 잎 수 × 띠 폭이다
 */
function banded(news: AlignItem[], olds: AlignItem[], out: number[], a: number[], b: number[]): void {
  const n = a.length;
  const m = b.length;
  const width = Math.abs(n - m) + 16;
  if (n * Math.min(m, 2 * width + 1) > 2_000_000) return; // 개수 차가 아주 크면 시간 때문에 보지 않는다
  const na = a.map((i) => normalizeText(news[i].text));
  const nb = b.map((j) => normalizeText(olds[j].text));
  const centre = (x: number): number => Math.round((x * m) / Math.max(1, n));
  const key = (x: number, y: number): number => x * (m + 1) + y;
  const sims = new Map<number, number>();
  const best = new Map<number, number>();
  const at = (x: number, y: number): number => (x >= n || y >= m ? 0 : (best.get(key(x, y)) ?? 0));
  for (let x = n - 1; x >= 0; x--) {
    for (let y = Math.min(m - 1, centre(x) + width); y >= Math.max(0, centre(x) - width); y--) {
      const raw = similarity(na[x], nb[y]);
      const s = raw >= MIN_SIMILARITY ? raw : 0;
      sims.set(key(x, y), s);
      best.set(key(x, y), Math.max(s > 0 ? s + at(x + 1, y + 1) : 0, at(x + 1, y), at(x, y + 1)));
    }
  }
  for (let x = 0, y = 0; x < n && y < m; ) {
    const s = sims.get(key(x, y)) ?? 0;
    if (s > 0 && at(x, y) === s + at(x + 1, y + 1)) {
      out[a[x]] = b[y];
      x++;
      y++;
    } else if (at(x + 1, y) >= at(x, y + 1)) x++;
    else y++;
  }
}

function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from) }, (_, k) => from + k);
}

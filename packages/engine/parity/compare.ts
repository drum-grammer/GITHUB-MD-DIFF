/**
 * 패리티 비교(스펙 §10) — 엔진 HTML과 GitHub rich diff를 블록 순서대로 (표시, 종류, 정규화 글자)로 견준다.
 * 블록은 확장 dom-blocks가 GitHub 화면에서 모으는 것과 같은 기준이다. 엔진만 내는 "원문만 바뀜" 막대는 뺀다
 */
import { domBlocks } from '../../../src/dom-blocks';
import { normalizeText } from '../../../src/source-blocks';

export type Mark = 'unchanged' | 'changed' | 'added' | 'removed';

export interface ParityBlock {
  mark: Mark;
  kind: string;
  text: string;
}

export interface Comparison {
  github: ParityBlock[];
  engine: ParityBlock[];
  matched: number;
  /** 일치한 블록 / 양쪽 중 많은 쪽 블록 수 */
  rate: number;
  onlyGithub: ParityBlock[];
  onlyEngine: ParityBlock[];
  /** 종류·글자는 같은데 표시만 다른 것 [GitHub, 엔진] */
  markOnly: Array<[ParityBlock, ParityBlock]>;
}

function markOf(el: Element): Mark {
  if (el.closest('del, .removed')) return 'removed';
  if (el.closest('ins, .added')) return 'added';
  if (el.closest('.changed') || el.querySelector('ins, del')) return 'changed';
  return 'unchanged';
}

export function parityBlocks(body: HTMLElement): ParityBlock[] {
  return domBlocks(body)
    .filter((b) => !b.el.closest('.mdc-source-only'))
    .map((b) => ({ mark: markOf(b.el), kind: b.footnote ? 'footnote' : b.kind, text: normalizeText(b.text) }));
}

const key = (b: ParityBlock): string => `${b.mark}|${b.kind}|${b.text}`;

/** 최장 공통 부분열로 맞춘 짝 [GitHub 번호, 엔진 번호] */
function lcs(a: string[], b: string[]): Array<[number, number]> {
  const w = b.length + 1;
  const dp = new Uint32Array((a.length + 1) * w);
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
  const out: Array<[number, number]> = [];
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) out.push([i++, j++]);
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++;
    else j++;
  }
  return out;
}

export function compare(githubBody: HTMLElement, engineBody: HTMLElement): Comparison {
  const github = parityBlocks(githubBody);
  const engine = parityBlocks(engineBody);
  const pairs = lcs(github.map(key), engine.map(key));
  const gi = new Set(pairs.map(([i]) => i));
  const ei = new Set(pairs.map(([, j]) => j));
  let onlyGithub = github.filter((_, i) => !gi.has(i));
  let onlyEngine = engine.filter((_, j) => !ei.has(j));
  const markOnly: Array<[ParityBlock, ParityBlock]> = [];
  for (const g of [...onlyGithub]) {
    const k = onlyEngine.findIndex((e) => e.kind === g.kind && e.text === g.text);
    if (k < 0) continue;
    markOnly.push([g, onlyEngine[k]]);
    onlyEngine = onlyEngine.filter((_, x) => x !== k);
    onlyGithub = onlyGithub.filter((x) => x !== g);
  }
  const most = Math.max(github.length, engine.length);
  return { github, engine, matched: pairs.length, rate: most ? pairs.length / most : 1, onlyGithub, onlyEngine, markOnly };
}

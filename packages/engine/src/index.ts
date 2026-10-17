/** @markdown-diff-cat/engine — 로컬 렌더링 md diff 엔진(스펙 §4). 모델(FileDiff) + GitHub rich diff와 같은 표기의 HTML */
import { makeDiff, type Options, type Plan } from './diff';
import { emit, emitPlain } from './emit';
import { ENGINE_GAP_CELLS, ENGINE_MAX_CELLS } from './pair';
import { buildSide } from './side';
import type { DiffOptions, FileDiff, RenderContext } from './types';

export * from './types';

/** 바뀐 낱말 비율이 이를 넘으면 통째로 — M1 끝에 GitHub 패리티 자료로 정했다(packages/engine/parity/run.ts의 단어 표시 표) */
export const DEFAULT_WHOLE_BLOCK_RATIO = 0.45;

/** diffMarkdown이 만든 그리기 계획 — 모델을 JSON으로 주고받은 뒤에는 기본 옵션으로 다시 만든다 */
const plans = new WeakMap<FileDiff, Plan>();

function options(opts: DiffOptions = {}): Options {
  return {
    gapCells: opts.gapCells ?? ENGINE_GAP_CELLS,
    maxCells: opts.maxCells ?? ENGINE_MAX_CELLS,
    wholeBlockRatio: opts.wholeBlockRatio ?? DEFAULT_WHOLE_BLOCK_RATIO,
  };
}

export function diffMarkdown(input: { oldText: string | null; newText: string | null; path: string; oldPath?: string }, opts?: DiffOptions): FileDiff {
  const { diff, plan } = makeDiff(input, options(opts));
  plans.set(diff, plan);
  return diff;
}

export function renderProseDiff(diff: FileDiff, ctx: RenderContext): string {
  const plan = plans.get(diff) ?? makeDiff({ oldText: diff.oldText, newText: diff.newText, path: diff.path, oldPath: diff.oldPath }, options()).plan;
  return emit(diff, plan, ctx);
}

export function renderMarkdown(text: string): string {
  return emitPlain(buildSide(text));
}

/**
 * 분류와 최상위 묶기(스펙 §4-2 3~5·7) — 잎 짝짓기 → 렌더링으로 판정 → 최상위 블록 op·지운 잎 자리·각주·알림.
 * 결과는 모델(FileDiff)과 그리기 계획(Plan). renderProseDiff는 계획만 보고 HTML을 낸다
 */
import { diffRows, normalizeCell, type Row } from '../../../src/table-diff';
import { eolCanon, eolStyle, hunks } from './lines';
import { alignLeaves, type PairOptions } from './pair';
import { invisibleChars } from './keys';
import { buildSide, type LeafUnit, type Side, type TopUnit } from './side';
import type { FileDiff, FileNotice, Leaf, LeafOp, Range, TopBlock } from './types';
import { wordDiff } from './words';

export interface Options extends PairOptions {
  wholeBlockRatio: number;
}

/** "원문만 바뀜" 막대 하나 — 그 자리의 원문 줄 diff */
export interface Bar {
  old?: Range;
  new?: Range;
  oldLines: string[];
  newLines: string[];
}

export interface RemovedInside {
  /** 지운 옛 잎 번호 */
  old: number;
  /** 기준이 되는 새 잎 번호 — 그 요소 뒤(after) 또는 앞에 넣는다 */
  anchor: number;
  after: boolean;
}

export type PlanItem =
  | { type: 'top'; block: TopBlock; newTop: number; oldTop: number | null; exclusive: boolean; removedInside: RemovedInside[]; bars: Bar[] }
  | { type: 'removed'; block: TopBlock; oldTop: number; bars: Bar[] }
  | { type: 'footnotes'; block: TopBlock; entries: Array<{ newLeaf?: number; oldLeaf?: number; op: LeafOp['op'] }> };

export interface Plan {
  oldSide: Side | null;
  newSide: Side | null;
  /** 새 잎 번호(각주 포함) → 짝인 옛 잎 번호 */
  newToOld: Map<number, number>;
  oldToNew: Map<number, number>;
  newOps: Map<number, LeafOp>;
  /** 새 잎 번호 → 단어 비교 HTML(단어 표시를 하는 고친 잎만) */
  words: Map<number, string>;
  items: PlanItem[];
}

/** 단어 표시를 하는 잎 — 표 행·코드·의사 잎은 옛·새 블록을 통째로, 각주는 옛 항목·새 항목으로(GitHub와 같음) */
const WORD_KINDS = new Set(['heading', 'paragraph', 'item']);

const blank = (s: string): boolean => s.trim() === '';
const item = (l: LeafUnit) => ({ kind: l.kind, text: l.text });
const lineSlice = (side: Side, r: Range): string[] => side.lines.slice(r.start - 1, r.end);

export function leafOf(side: Side, index: number): LeafUnit {
  return index < side.leaves.length ? side.leaves[index] : side.footnotes[index - side.leaves.length];
}

/** 블록이 표 하나뿐인가(마크다운 표·머리말·HTML 표) — 확장이 옛·새 표를 합치는 대상 */
function soleTable(top: TopUnit): boolean {
  const tables = top.container.querySelectorAll('table');
  return tables.length === 1 && (top.container.textContent ?? '').trim() === (tables[0].textContent ?? '').trim();
}

/** 표 본문 행의 칸 글자 — 머리 행(thead 첫 행, 없으면 첫 행)은 뺀다(확장 table-render와 같은 규칙) */
function bodyRows(top: TopUnit): Row[] {
  const table = top.container.querySelector('table');
  if (!table) return [];
  const rows = [...table.rows];
  const head = table.tHead?.rows[0] ?? rows[0];
  return rows.filter((r) => r !== head).map((r) => [...r.cells].map((c) => normalizeCell(c.textContent ?? '')));
}

export function makeDiff(input: { oldText: string | null; newText: string | null; path: string; oldPath?: string }, opts: Options): { diff: FileDiff; plan: Plan } {
  const { oldText, newText, path, oldPath } = input;
  const status: FileDiff['status'] = oldText === null ? 'added' : newText === null ? 'deleted' : oldPath && oldPath !== path ? 'renamed' : 'modified';
  const diff: FileDiff = { path, ...(oldPath ? { oldPath } : {}), status, oldText, newText, blocks: [], notices: [] };
  const os = oldText === null ? null : buildSide(oldText);
  const ns = newText === null ? null : buildSide(newText);
  const plan: Plan = { oldSide: os, newSide: ns, newToOld: new Map(), oldToNew: new Map(), newOps: new Map(), words: new Map(), items: [] };
  if (!ns) return { diff, plan }; // 지운 파일 — 렌더링 diff 대신 알림만(renderProseDiff)

  const newLeaves = ns.leaves;
  const oldLeaves = os?.leaves ?? [];
  const pairs = alignLeaves(newLeaves.map(item), oldLeaves.map(item), opts);
  pairs.forEach((j, i) => {
    if (j < 0) return;
    plan.newToOld.set(i, j);
    plan.oldToNew.set(j, i);
  });

  const classify = (n: LeafUnit, o: LeafUnit | undefined): LeafOp => {
    const leaf: Leaf = { kind: n.kind, new: n.range, ...(o ? { old: o.range } : {}), headingPath: n.headingPath };
    if (!o) return { op: 'added', leaf };
    if (n.key === o.key) return n.source !== o.source ? { op: 'same', leaf, sourceOnly: true } : { op: 'same', leaf };
    const op: Extract<LeafOp, { op: 'changed' }> = { op: 'changed', leaf };
    if (n.visible === o.visible) op.invisible = true;
    if (WORD_KINDS.has(n.kind) && n.el && o.el) {
      const w = wordDiff(o.el, n.el, n.kind);
      if (!w || w.ratio > opts.wholeBlockRatio) op.wholeBlock = true;
      else {
        op.words = w.ops;
        plan.words.set(n.index, w.html);
      }
    }
    return op;
  };
  const removedOp = (o: LeafUnit): LeafOp => ({ op: 'removed', leaf: { kind: o.kind, old: o.range, headingPath: o.headingPath } });
  for (const n of newLeaves) plan.newOps.set(n.index, classify(n, os && plan.newToOld.has(n.index) ? oldLeaves[plan.newToOld.get(n.index)!] : undefined));

  // 지운 잎의 자리 — 같은 옛 최상위 블록의 다른 잎에 짝이 있으면 그 짝이 든 새 블록 안, 없으면 옛 블록 통째로 지움
  const inside = new Map<number, RemovedInside[]>();
  const removedTops: number[] = [];
  for (const ot of os?.tops ?? []) {
    const paired = ot.leaves.filter((j) => plan.oldToNew.has(j));
    if (paired.length === 0) {
      removedTops.push(ot.index);
      continue;
    }
    for (const j of ot.leaves) {
      if (plan.oldToNew.has(j)) continue;
      const before = paired.filter((k) => k < j).pop();
      const anchorOld = before ?? paired.find((k) => k > j)!;
      const anchor = plan.oldToNew.get(anchorOld)!;
      const nt = newLeaves[anchor].top;
      inside.set(nt, [...(inside.get(nt) ?? []), { old: j, anchor, after: before !== undefined }]);
    }
  }
  // 통째로 지운 옛 블록은 앞에서 마지막으로 짝이 된 옛 잎의 짝이 든 새 블록 뒤에(없으면 문서 맨 앞)
  const after = new Map<number, number[]>();
  for (const ot of removedTops) {
    let k = os!.tops[ot].leaves[0] - 1;
    while (k >= 0 && !plan.oldToNew.has(k)) k--;
    const at = k >= 0 ? newLeaves[plan.oldToNew.get(k)!].top : -1;
    after.set(at, [...(after.get(at) ?? []), ot]);
  }
  const pushRemoved = (at: number): void => {
    for (const ot of after.get(at) ?? []) {
      const top = os!.tops[ot];
      const block: TopBlock = { op: 'removed', tokenType: top.tokenType, old: top.range, leaves: top.leaves.map((j) => removedOp(oldLeaves[j])) };
      const bars = top.container.innerHTML.trim() ? [] : [{ old: top.range, oldLines: lineSlice(os!, top.range), newLines: [] }];
      plan.items.push({ type: 'removed', block, oldTop: ot, bars });
    }
  };

  pushRemoved(-1);
  for (const nt of ns.tops) {
    const counts = new Map<number, number>();
    for (const i of nt.leaves) {
      const j = plan.newToOld.get(i);
      if (j !== undefined) counts.set(oldLeaves[j].top, (counts.get(oldLeaves[j].top) ?? 0) + 1);
    }
    let oldTop: number | null = null;
    for (const [t, c] of counts) if (oldTop === null || c > counts.get(oldTop)! || (c === counts.get(oldTop)! && t < oldTop)) oldTop = t;
    const ot = oldTop === null ? null : os!.tops[oldTop];
    const exclusive = ot !== null && counts.size === 1 && ot.leaves.every((j) => !plan.oldToNew.has(j) || newLeaves[plan.oldToNew.get(j)!].top === nt.index);
    const removedInside = inside.get(nt.index) ?? [];
    const ops = nt.leaves.map((i) => plan.newOps.get(i)!);
    // 모델의 잎 차례 — 지운 잎은 기준 잎 뒤(또는 앞)에
    const leaves: LeafOp[] = [];
    for (const [k, i] of nt.leaves.entries()) {
      for (const r of removedInside.filter((x) => x.anchor === i && !x.after)) leaves.push(removedOp(oldLeaves[r.old]));
      leaves.push(ops[k]);
      for (const r of removedInside.filter((x) => x.anchor === i && x.after)) leaves.push(removedOp(oldLeaves[r.old]));
    }
    const block: TopBlock = { op: 'same', tokenType: nt.tokenType, ...(ot ? { old: ot.range } : {}), new: nt.range, leaves };
    const bars: Bar[] = [];
    const empty = !nt.container.innerHTML.trim();
    if (!ot) {
      block.op = 'added';
      if (empty || invisibleChars(nt.source)) bars.push({ new: nt.range, oldLines: [], newLines: lineSlice(ns, nt.range) });
    } else if (ops.every((o) => o.op === 'same') && removedInside.length === 0) {
      if (exclusive && nt.key !== ot.key) {
        // 잎은 모두 같은데 블록 HTML이 다르다 — 잎 밖의 내용(<summary>·<img src>·표 정렬)
        block.op = 'changed';
        block.wholeBlock = true;
      } else {
        const sourceOnly = exclusive ? nt.source !== ot.source : ops.some((o) => o.op === 'same' && o.sourceOnly);
        if (sourceOnly) {
          block.sourceOnly = true;
          if (exclusive) bars.push({ old: ot.range, new: nt.range, oldLines: lineSlice(os!, ot.range), newLines: lineSlice(ns, nt.range) });
          else for (const i of nt.leaves) {
            const op = plan.newOps.get(i)!;
            const o = oldLeaves[plan.newToOld.get(i)!];
            if (op.op === 'same' && op.sourceOnly) bars.push({ old: o.range, new: newLeaves[i].range, oldLines: lineSlice(os!, o.range), newLines: lineSlice(ns, newLeaves[i].range) });
          }
        }
      }
    } else {
      block.op = 'changed';
    }
    if (block.op === 'changed') {
      for (const i of nt.leaves) {
        const op = plan.newOps.get(i)!;
        const n = newLeaves[i];
        if (op.op === 'added' && invisibleChars(n.source)) bars.push({ new: n.range, oldLines: [], newLines: lineSlice(ns, n.range) });
        if (op.op !== 'changed') continue;
        const o = oldLeaves[plan.newToOld.get(i)!];
        if (op.invisible || invisibleChars(n.source) !== invisibleChars(o.source)) bars.push({ old: o.range, new: n.range, oldLines: lineSlice(os!, o.range), newLines: lineSlice(ns, n.range) });
      }
      if (ot && soleTable(nt) && soleTable(ot)) block.rows = diffRows(bodyRows(ot), bodyRows(nt));
    }
    plan.items.push({ type: 'top', block, newTop: nt.index, oldTop, exclusive, removedInside, bars });
    pushRemoved(nt.index);
  }

  // 각주 — 렌더링 차례대로 문서 끝 한 곳에
  const nf = ns.footnotes.filter((f) => f.footnote! >= 0);
  const of = (os?.footnotes ?? []).filter((f) => f.footnote! >= 0);
  if (nf.length || of.length) {
    // 각주는 이름으로 짝짓는다(글이 많이 바뀌어도 같은 각주다)
    const fp = nf.map((n) => of.findIndex((o) => o.label === n.label));
    const nextPaired = fp.map((_, a) => Math.min(...fp.slice(a).filter((k) => k >= 0), of.length));
    const usedOld = new Set<number>();
    const entries: Array<{ newLeaf?: number; oldLeaf?: number; op: LeafOp['op'] }> = [];
    const leaves: LeafOp[] = [];
    const flushOld = (upto: number): void => {
      for (const [k, o] of of.entries()) {
        if (k >= upto || usedOld.has(k)) continue;
        usedOld.add(k);
        entries.push({ oldLeaf: o.index, op: 'removed' });
        leaves.push(removedOp(o));
      }
    };
    fp.forEach((k, a) => {
      flushOld(k >= 0 ? k : nextPaired[a]);
      const n = nf[a];
      const o = k >= 0 ? of[k] : undefined;
      if (o) {
        usedOld.add(k);
        plan.newToOld.set(n.index, o.index);
        plan.oldToNew.set(o.index, n.index);
      }
      const op = classify(n, o);
      plan.newOps.set(n.index, op);
      entries.push({ newLeaf: n.index, ...(o ? { oldLeaf: o.index } : {}), op: op.op });
      leaves.push(op);
    });
    flushOld(of.length);
    const ops = leaves.map((l) => l.op);
    const op: TopBlock['op'] = ops.every((x) => x === 'same') ? 'same' : nf.length === 0 ? 'removed' : of.length === 0 ? 'added' : 'changed';
    plan.items.push({ type: 'footnotes', block: { op, tokenType: 'footnote_block', leaves }, entries });
  }

  diff.blocks = plan.items.map((x) => x.block);

  // 파일 알림
  const notices: FileNotice[] = [];
  if (os && oldText !== newText) {
    if (eolCanon(oldText!) === eolCanon(newText!) && diff.blocks.every((b) => b.op === 'same')) {
      // 줄 끝·줄 끝 공백만 바뀐 파일 — 블록마다 막대를 달지 않고 알림 하나
      for (const b of diff.blocks) {
        delete b.sourceOnly;
        for (const l of b.leaves) if (l.op === 'same') delete l.sourceOnly;
      }
      for (const x of plan.items) if (x.type !== 'footnotes') x.bars = [];
      notices.push({ kind: 'line-endings' });
    } else {
      if (eolStyle(oldText!) !== eolStyle(newText!)) notices.push({ kind: 'line-endings' });
      // 파일 끝 줄바꿈만 더하거나 뺀 것 — git은 마지막 줄을 hunk로 낸다(split('\n')이 만든 빈 끝 줄이 아니라)
      const body = (ls: string[]): string[] => (ls.length && ls[ls.length - 1] === '' ? ls.slice(0, -1) : ls);
      const ob = body(os.lines);
      const nb = body(ns.lines);
      if ((ob.length < os.lines.length) !== (nb.length < ns.lines.length)) {
        const at = (n: number): Range => ({ start: Math.max(1, n), end: Math.max(1, n) });
        notices.push({ kind: 'whitespace', old: at(ob.length), new: at(nb.length) });
      }
      for (const h of hunks(ob, nb)) {
        if ([...h.oldLines, ...h.newLines].every(blank)) notices.push({ kind: 'whitespace', ...(h.old ? { old: h.old } : {}), ...(h.new ? { new: h.new } : {}) });
      }
    }
    // 가리키지 않은 각주 정의 — 렌더링 자리가 없으니 알림으로
    const nu = ns.footnotes.filter((f) => f.footnote! < 0);
    const ou = os.footnotes.filter((f) => f.footnote! < 0);
    const nRef = new Set(nf.map((f) => f.label));
    const oRef = new Set(of.map((f) => f.label));
    for (const n of nu) {
      const o = ou.find((x) => x.label === n.label);
      if (o ? o.source !== n.source : !oRef.has(n.label)) notices.push({ kind: 'unreferenced-footnote', ...(o ? { old: o.range } : {}), new: n.range });
    }
    for (const o of ou) if (!nu.some((x) => x.label === o.label) && !nRef.has(o.label)) notices.push({ kind: 'unreferenced-footnote', old: o.range });
  }
  for (const x of plan.items) if (x.type !== 'footnotes') for (const b of x.bars) notices.push({ kind: 'source-only', ...(b.old ? { old: b.old } : {}), ...(b.new ? { new: b.new } : {}) });
  diff.notices = notices;
  return { diff, plan };
}

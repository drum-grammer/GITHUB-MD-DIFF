/**
 * 엔진 출력이 지켜야 할 불변식(스펙 §10) — 사례마다 자동으로 돈다.
 * ① git diff의 hunk마다 화면에 보이는 표시(블록 표시·원문만 바뀜 막대·파일 알림)가 하나 이상 — 접기까지 끝난 DOM(applyBody 뒤)에서
 * ② 모든 COMMENT_BLOCK에 data-mdc-* ③ 다시 읽어도 같은 HTML(브라우저 파서 고정점)
 * ④ 확장 DOM 모듈 재사용 — 접기 막대 수·합친 표 수·이동 대상 수가 모델에서 계산한 값과 같다
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';
import { applyBody } from '../../../src/apply';
import { domBlocks } from '../../../src/dom-blocks';
import { foldBars } from '../../../src/fold';
import { changeTargets } from '../../../src/nav';
import { diffMarkdown, renderProseDiff, type FileDiff, type Range } from '../src/index';
import { INVISIBLE } from '../src/keys';
import { buildSide } from '../src/side';
import { CTX, bodyOf } from './helpers';

export { CTX, bodyOf };

export interface GitHunk {
  old?: Range;
  new?: Range;
}

/**
 * git diff --no-index -U0의 hunk — 줄 수가 0인 쪽은 없다. ignoreEol이면 줄 끝(CR·공백)만 다른 줄은 hunk가 아니다.
 * 사용자 git 설정(diff.algorithm·diff.external·textconv)이 hunk 모양을 바꾸거나 @@ 줄을 없애지 않게 전역·시스템 설정과 외부 diff를 끈다
 */
export function gitHunks(oldText: string, newText: string, ignoreEol = false): GitHunk[] {
  const dir = mkdtempSync(join(tmpdir(), 'mdc-hunk-'));
  let out = '';
  try {
    writeFileSync(join(dir, 'a.md'), oldText);
    writeFileSync(join(dir, 'b.md'), newText);
    const args = ['diff', '--no-index', '--no-ext-diff', '--no-textconv', '--no-color', '-U0', ...(ignoreEol ? ['--ignore-space-at-eol'] : []), 'a.md', 'b.md'];
    out = execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
  } catch (e) {
    out = String((e as { stdout?: string }).stdout ?? ''); // 차이가 있으면 종료 코드 1
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const hunks: GitHunk[] = [];
  for (const m of out.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    const [os, oc, ns, nc] = [Number(m[1]), m[2] === undefined ? 1 : Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
    hunks.push({ ...(oc > 0 ? { old: { start: os, end: os + oc - 1 } } : {}), ...(nc > 0 ? { new: { start: ns, end: ns + nc - 1 } } : {}) });
  }
  // 원문이 다른데 hunk가 없으면 검사가 공허하게 통과한다 — git 출력이 예상 모양이 아니다
  if (!ignoreEol && oldText !== newText && hunks.length === 0) throw new Error('git diff가 hunk를 내지 않았다 — git 설정·외부 diff를 확인');
  return hunks;
}

const parse = (v: string | null): Range | null => {
  const m = v?.match(/^(\d+)-(\d+)$/);
  return m ? { start: Number(m[1]), end: Number(m[2]) } : null;
};
const meets = (a: Range | undefined | null, b: Range | undefined | null): boolean => Boolean(a && b && a.start <= b.end && b.start <= a.end);

/**
 * 표시 요소의 줄 범위 — 자기 속성과 안쪽 잎들의 범위를 합친 것(쪽마다). 안쪽에 줄 속성이 없으면(문단 안 낱말 ins·del) 감싼 잎의 범위
 */
function spanOf(el: Element, side: 'new' | 'old'): Range | null {
  const attr = `data-mdc-${side}`;
  let all = [el, ...el.querySelectorAll(`[${attr}]`)].map((x) => parse(x.getAttribute(attr))).filter((r): r is Range => r !== null);
  if (!all.length) {
    const up = el.parentElement?.closest(`[${attr}]`);
    all = up ? [parse(up.getAttribute(attr))].filter((r): r is Range => r !== null) : [];
  }
  if (!all.length) return null;
  return { start: Math.min(...all.map((r) => r.start)), end: Math.max(...all.map((r) => r.end)) };
}

const MARKER = 'ins, del, .changed, .added, .removed, .mdc-source-only, .mdf-row-added, .mdf-row-removed, .mdf-row-changed';
/** 감싸기만 하는 것 — 바뀐 목록·인용문·알림을 감싼 div.changed. 안의 모든 줄을 덮지 않는다(안쪽 표시가 저마다 센다) */
const WRAPPER = 'div.changed:not(.mdc-source-only)';
/** 브라우저가 그리지 않는 것 — 원문 막대의 숨긴 원문(pre.mdc-source-diff)은 막대 문구가 보이므로 막대 자체는 보인다 */
const UNRENDERED = '[hidden], [popover], title, datalist, template';
/** 글이 없어도 보이는 요소 */
const ATOMIC = 'img, input, br, hr, svg, video, audio, span.katex';

/** 화면에 보이는가 — 확장이 숨긴 것(mdf-hidden)·브라우저가 그리지 않는 것 안이 아니고, 보이는 글이나 원자 요소가 있다 */
function shown(el: Element): boolean {
  if (el.closest('.mdf-hidden') || el.closest(UNRENDERED)) return false;
  const c = el.cloneNode(true) as Element;
  for (const n of c.querySelectorAll(UNRENDERED)) n.remove();
  return (c.textContent ?? '').replace(INVISIBLE, '').trim() !== '' || c.matches(ATOMIC) || c.querySelector(ATOMIC) !== null;
}

/** 쪽마다 표시가 덮는 줄 번호 */
function markedLines(markers: Element[], side: 'new' | 'old'): Set<number> {
  const out = new Set<number>();
  for (const m of markers) {
    const r = spanOf(m, side);
    if (r) for (let n = r.start; n <= r.end; n++) out.add(n);
  }
  return out;
}

/**
 * 이동처럼 최소 diff가 둘 이상이면 git과 엔진이 서로 다른 블록을 "바뀜"으로 고른다(git: A를 지우고 뒤에 넣음, 엔진: B를 앞에 넣고 뒤에서 지움).
 * 그래서 옮긴 hunk(글 있는 줄이 모두 다른 쪽에도 있다)만 양쪽 다 바뀌지 않았다고 보는 글 있는 줄 사이로 넓혀 본다
 */
function widen(r: Range, lines: string[], gitChanged: Set<number>, marked: Set<number>): Range {
  const anchor = (n: number): boolean => !gitChanged.has(n) && !marked.has(n) && (lines[n - 1] ?? '').trim() !== '';
  let start = r.start;
  while (start > 1 && !anchor(start - 1)) start--;
  let end = r.end;
  while (end < lines.length && !anchor(end + 1)) end++;
  return { start, end };
}

/** ① hunk 불변식 — 덮이지 않은 hunk 목록(비어야 한다) */
export function uncovered(diff: FileDiff, body: HTMLElement): GitHunk[] {
  const markers = [...body.querySelectorAll(MARKER)].filter((m) => !m.matches(WRAPPER) && shown(m));
  // 줄 끝 모양이 바뀐 파일은 모든 줄이 hunk다 — 줄 끝(CR·공백)만 다른 줄은 line-endings 알림 하나가 맡고, 남은 hunk에는 여전히 표시가 있어야 한다
  const all = gitHunks(diff.oldText ?? '', diff.newText ?? '', diff.notices.some((n) => n.kind === 'line-endings'));
  const lines = { old: (diff.oldText ?? '').split('\n'), new: (diff.newText ?? '').split('\n') };
  const changed = { old: new Set<number>(), new: new Set<number>() };
  for (const h of all) for (const side of ['old', 'new'] as const) if (h[side]) for (let n = h[side]!.start; n <= h[side]!.end; n++) changed[side].add(n);
  const marked = { old: markedLines(markers, 'old'), new: markedLines(markers, 'new') };
  // 파일 알림 중 source-only는 본문 막대와 하나씩 짝이다 — 막대가 없으면 덮이지 않은 것으로 센다(알림만 있고 막대를 빠뜨려도 통과하지 않게)
  const fileNotices = diff.notices.filter((x) => x.kind !== 'source-only');
  const hit = (side: 'old' | 'new', r: Range | undefined): boolean => Boolean(r && (markers.some((m) => meets(spanOf(m, side), r)) || fileNotices.some((x) => meets(x[side], r))));
  const moved = (side: 'old' | 'new', r: Range): boolean => {
    const other = new Set(lines[side === 'old' ? 'new' : 'old'].map((l) => l.trim()).filter(Boolean));
    const own = lines[side].slice(r.start - 1, r.end).map((l) => l.trim()).filter(Boolean);
    return own.length > 0 && own.every((l) => other.has(l));
  };
  return all.filter((h) => {
    if (hit('new', h.new) || hit('old', h.old)) return false;
    return !(['old', 'new'] as const).some((side) => h[side] && moved(side, h[side]!) && hit(side, widen(h[side]!, lines[side], changed[side], marked[side])));
  });
}

/** 모델로 계산한 최상위 단위 차례 — S(변경 없음)·C(바뀜). 렌더링이 없는 블록(정의·HTML 주석)은 자리를 차지하지 않는다 */
export function unitSeq(diff: FileDiff): Array<'S' | 'C'> {
  const ns = diff.newText === null ? null : buildSide(diff.newText);
  const topAt = (r?: Range) => ns?.tops.find((t) => r && t.range.start === r.start);
  const empty = (r?: Range): boolean => !topAt(r)?.container.innerHTML.trim();
  // 블록 안 잎에 붙은 "원문만 바뀜" 막대 — 블록의 마지막 단위 뒤에 바뀐 단위로 온다
  const within = (r: Range | undefined, outer: Range | undefined): boolean => Boolean(r && outer && r.start >= outer.start && r.end <= outer.end);
  const hasBar = (b: FileDiff['blocks'][number]): boolean => diff.notices.some((n) => n.kind === 'source-only' && (within(n.new, b.new) || within(n.old, b.old)));
  const seq: Array<'S' | 'C'> = [];
  for (const b of diff.blocks) {
    if (b.tokenType === 'footnote_block') {
      seq.push(b.op === 'same' ? 'S' : 'C');
      if (b.sourceOnly) seq.push('C');
    }
    else if (b.tokenType === 'alert_open' && b.op === 'changed') {
      // 고친 알림은 묶음 없이 제목 문단(변경 없음이면 S) + 본문(모두 같으면 자식마다 S, 아니면 .changed 하나)
      const [title, ...rest] = b.leaves;
      // 알림 종류를 바꿨다 — 옛 제목(지움)은 새 제목과 한 단위(del + ins)
      const body = title.op === 'added' && rest[0]?.op === 'removed' && rest[0].leaf.old?.start === b.old?.start ? rest.slice(1) : rest;
      seq.push(title.op === 'same' ? 'S' : 'C');
      const box = topAt(b.new)!.container.querySelector('.markdown-alert')!;
      if (body.every((l) => l.op === 'same')) {
        for (let k = 1; k < box.children.length; k++) seq.push('S');
        if (hasBar(b)) seq.push('C');
      } else seq.push('C');
    } else if (b.op === 'same') {
      if (!empty(b.new)) seq.push('S');
      if (b.sourceOnly) seq.push('C');
    } else seq.push('C');
  }
  return seq;
}

const runs = (seq: Array<'S' | 'C'>, kind: 'S' | 'C'): number => seq.filter((x, i) => x === kind && seq[i - 1] !== kind).length;

/** 변경 없음 묶음 수 — 바뀐 곳 바로 앞뒤(vicinity)는 묶음 밖이다 */
function expectedFolds(seq: Array<'S' | 'C'>): number {
  let n = 0;
  for (let i = 0; i < seq.length; ) {
    if (seq[i] === 'C') {
      i++;
      continue;
    }
    let j = i;
    while (j < seq.length && seq[j] === 'S') j++;
    const len = j - i - (i > 0 ? 1 : 0) - (j < seq.length ? 1 : 0);
    if (len > 0) n++;
    i = j;
  }
  return n;
}

/** 합칠 표 수 — 바뀐 표(마크다운 표·머리말·HTML 표) 중 머리 행이 같고 본문 행에 바뀐 것이 있는 것 */
function expectedTables(diff: FileDiff): number {
  return diff.blocks.filter((b) => b.op === 'changed' && b.rows && b.leaves[0]?.op === 'same' && b.rows.some((r) => r.kind !== 'same')).length;
}

export interface Checked {
  diff: FileDiff;
  html: string;
  body: HTMLElement;
}

/** 사례 하나에 불변식 전부 */
export function check(oldText: string, newText: string, path = 'docs/case.md'): Checked {
  const diff = diffMarkdown({ oldText, newText, path });
  const html = renderProseDiff(diff, CTX);
  // ③ 브라우저 파서 고정점
  const again = document.createElement('div');
  again.innerHTML = html;
  expect(again.innerHTML, '다시 읽으면 같은 HTML').toBe(html);
  const body = bodyOf(html);
  // ② 코멘트 블록마다 줄 속성
  const missing = domBlocks(body).filter((b) => !b.el.hasAttribute('data-mdc-new') && !b.el.hasAttribute('data-mdc-old'));
  expect(missing.map((b) => b.el.outerHTML.slice(0, 80)), '줄 속성이 빠진 COMMENT_BLOCK').toEqual([]);
  const seq = unitSeq(diff);
  // ④ 확장 DOM 모듈 — 표 합치기 → 접기 → 툴바
  const result = applyBody(body);
  expect(result.errors).toEqual([]);
  expect(body.querySelectorAll('[data-mdf="table"]').length, '합친 표 수').toBe(expectedTables(diff));
  expect(foldBars(body).length, '접기 막대 수').toBe(expectedFolds(seq));
  expect(changeTargets(body).length, '이동 대상 수').toBe(runs(seq, 'C'));
  // ① hunk 불변식(접기 뒤)
  expect(uncovered(diff, body), '표시가 없는 git hunk').toEqual([]);
  return { diff, html, body };
}

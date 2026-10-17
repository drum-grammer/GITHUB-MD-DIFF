/**
 * 한 쪽(옛 또는 새) 원문을 최상위 블록과 잎으로 나눈다 — 파서 둘(스펙 §4-2 1·2).
 * 잎은 확장과 같은 기본 파서의 sourceBlocks, 최상위 블록과 렌더링은 플러그인 파서. 둘은 원문 줄 범위로 잇는다
 */
import type { Token } from 'markdown-it';
import { alignBlocks } from '../../../src/align';
import { domBlocks } from '../../../src/dom-blocks';
import { frontMatterLines, sourceBlocks, type BlockKind } from '../../../src/source-blocks';
import { escapeHtml, fragment } from './dom';
import { leafKey, topKey, visibleText } from './keys';
import { markdown, newEnv } from './markdown';
import type { Kind, Range } from './types';

export interface LeafUnit {
  /** 이 쪽 잎 번호 — 본문 잎은 문서 순서, 각주는 본문 잎 뒤에 이어서 */
  index: number;
  kind: Kind;
  /** sourceBlocks 종류(렌더링 요소와 맞출 때). 의사 잎은 없다 */
  srcKind?: BlockKind;
  range: Range;
  /** 짝짓기 글 — sourceBlocks의 보이는 글, 의사 잎은 원문 */
  text: string;
  /** 든 최상위 블록 번호. 각주는 -1 */
  top: number;
  /** 렌더링 요소(최상위 조각 안). 렌더링이 없으면 null */
  el: HTMLElement | null;
  key: string;
  visible: string;
  /** 원문 줄(줄 끝 정규화 뒤) */
  source: string;
  headingPath: string[];
  /** 각주 차례(가리키지 않은 정의는 -1) */
  footnote?: number;
  label?: string;
}

export interface TopUnit {
  index: number;
  tokenType: string;
  range: Range;
  /** 정화가 끝난 렌더링 조각. 렌더링이 없는 블록(정의·HTML 주석)은 비어 있다 */
  container: HTMLDivElement;
  leaves: number[];
  key: string;
  source: string;
}

export interface Side {
  text: string;
  lines: string[];
  tops: TopUnit[];
  /** 본문 잎(각주 제외), 문서 순서 */
  leaves: LeafUnit[];
  /** 각주 정의 — 가리킨 것은 렌더링 차례대로, 가리키지 않은 것(-1)은 뒤에 */
  footnotes: LeafUnit[];
}

/** 렌더링 요소를 표시하는 엔진 내부 속성 — 최종 HTML에서는 지운다 */
export const LEAF_ATTR = 'data-mdc-leaf';

const FOOTNOTE_DEF = /^\[\^([^\]\s]+)\]:/;
const YAML_KEY = /^([^\s#:][^:]*):(?:\s+(.*))?$/;

const blank = (s: string | undefined): boolean => (s ?? '').trim() === '';
const sourceOf = (lines: string[], r: Range): string => lines.slice(r.start - 1, r.end).join('\n');
const inRange = (n: number, r: Range): boolean => n >= r.start && n <= r.end;

/** 최상위 토큰 묶음 — 여는 토큰부터 짝 닫는 토큰까지 */
function topSlices(tokens: Token[]): Token[][] {
  const out: Token[][] = [];
  for (let i = 0; i < tokens.length; i++) {
    let j = i;
    if (tokens[i].nesting === 1) {
      for (let depth = 0; j < tokens.length; j++) {
        depth += tokens[j].nesting;
        if (depth === 0) break;
      }
    }
    out.push(tokens.slice(i, j + 1));
    i = j;
  }
  return out;
}

/** 머리말 — 맨 위 키 하나가 표 한 행(키·값). sourceBlocks의 머리말 행과 같은 규칙으로 줄을 묶는다 */
function frontMatterTable(lines: string[], count: number): string {
  const rows: Array<{ key: string; value: string }> = [];
  for (let i = 1; i < count - 1; i++) {
    const m = lines[i].match(YAML_KEY);
    if (m && !/^\s/.test(lines[i])) rows.push({ key: m[1], value: m[2] ?? '' });
    else if (rows.length && lines[i].trim()) rows[rows.length - 1].value += ` ${lines[i].trim()}`;
  }
  const body = rows.map((r) => `<tr><th>${escapeHtml(r.key)}</th><td>${escapeHtml(r.value.trim())}</td></tr>`).join('');
  return `<markdown-accessiblity-table><table><tbody>${body}</tbody></table></markdown-accessiblity-table>`;
}

/** 과제 상자 id(task-item-N)는 문서 안 순번이라 앞에 항목이 늘면 바뀐다 — 렌더링 비교를 흔들지 않게 지운다 */
function tidy(container: HTMLDivElement): HTMLDivElement {
  for (const box of container.querySelectorAll('input.task-list-item-checkbox')) box.removeAttribute('id');
  return container;
}

function pseudoKind(tokenType: string): Kind {
  if (tokenType === 'hr') return 'hr';
  if (tokenType === 'math_block') return 'math';
  return 'html';
}

export function buildSide(text: string): Side {
  const md = markdown();
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const fm = frontMatterLines(lines);
  const body = lines.map((l, i) => (i < fm ? '' : l)).join('\n');
  const env = newEnv();
  const tokens = md.parse(body, env);

  // 1. 최상위 블록
  const tops: TopUnit[] = [];
  const footnoteTokens: Token[] = [];
  const addTop = (tokenType: string, range: Range, html: string): void => {
    const container = tidy(fragment(html));
    tops.push({ index: -1, tokenType, range, container, leaves: [], key: '', source: sourceOf(lines, range) });
  };
  if (fm > 0) addTop('front_matter', { start: 1, end: fm }, frontMatterTable(lines, fm));
  for (const slice of topSlices(tokens)) {
    const first = slice[0];
    if (first.type === 'footnote_block_open') footnoteTokens.push(...slice);
    else if (first.map) addTop(first.type, { start: first.map[0] + 1, end: Math.max(first.map[0] + 1, first.map[1]) }, md.renderer.render(slice, md.options, env));
  }

  // 2. 잎 — sourceBlocks를 줄 범위로 최상위 블록에 넣는다
  const blocks = sourceBlocks(text);
  const leaves: LeafUnit[] = [];
  const covered = new Set<number>();
  const cover = (r: Range): void => {
    for (let n = r.start; n <= r.end; n++) covered.add(n);
  };
  const topOf = (line: number): TopUnit | undefined => tops.find((t) => inRange(line, t.range));
  const footBlocks = blocks.filter((b) => b.footnote !== undefined);
  for (const b of blocks) {
    if (b.footnote !== undefined) continue;
    const top = topOf(b.start);
    // 수식 블록 안의 기본 파서 잎은 버린다 — 기본 파서는 $$…$$를 문단으로 읽는다(아래에서 의사 잎 하나로)
    if (!top || top.tokenType === 'math_block') continue;
    const kind: Kind = top.tokenType === 'front_matter' ? 'meta' : b.kind;
    leaves.push({ index: -1, kind, srcKind: b.kind, range: { start: b.start, end: b.end }, text: b.text, top: tops.indexOf(top), el: null, key: '', visible: '', source: sourceOf(lines, b), headingPath: [] });
  }
  for (const t of tops) cover(t.range);
  for (const b of footBlocks) cover({ start: b.start, end: b.end });

  // 3. 잎이 하나도 없는 최상위 블록은 의사 잎 하나(hr·html·math)
  tops.forEach((t, ti) => {
    if (leaves.some((l) => l.top === ti)) return;
    leaves.push({ index: -1, kind: pseudoKind(t.tokenType), range: { ...t.range }, text: t.source, top: ti, el: null, key: '', visible: '', source: t.source, headingPath: [] });
  });

  // 4. 어느 블록에도 안 든 빈 줄 아닌 줄 — 링크 참조 정의 등. 이어진 줄을 정의 의사 잎 하나로
  for (let n = fm + 1; n <= lines.length; n++) {
    if (covered.has(n) || blank(lines[n - 1])) continue;
    let end = n;
    while (end + 1 <= lines.length && !covered.has(end + 1) && !blank(lines[end])) end++;
    const range = { start: n, end };
    addTop('definition', range, '');
    leaves.push({ index: -1, kind: 'definition', range, text: sourceOf(lines, range), top: tops.length - 1, el: null, key: '', visible: '', source: sourceOf(lines, range), headingPath: [] });
    n = end;
  }

  // 최상위 블록과 잎을 문서 순서로 다시 번호 매긴다
  const order = tops.map((t, i) => ({ t, i })).sort((a, b) => a.t.range.start - b.t.range.start);
  const renumber = new Map(order.map(({ i }, k) => [i, k]));
  const sortedTops = order.map(({ t }) => t);
  sortedTops.forEach((t, k) => (t.index = k));
  for (const l of leaves) l.top = renumber.get(l.top)!;
  leaves.sort((a, b) => a.range.start - b.range.start || a.top - b.top);
  leaves.forEach((l, k) => {
    l.index = k;
    sortedTops[l.top].leaves.push(k);
  });

  // 5. 잎 ↔ 렌더링 요소 — 확장 dom-blocks로 블록을 모아 alignBlocks로 맞춘다(확장이 GitHub 화면에 쓰는 것과 같은 방법)
  for (const t of sortedTops) {
    const own = t.leaves.map((k) => leaves[k]);
    if (own.length === 1 && !own[0].srcKind) {
      own[0].el = t.container.firstElementChild as HTMLElement | null;
    } else {
      const dom = domBlocks(t.container);
      const pairs = alignBlocks(dom, own.map((l) => ({ kind: l.srcKind ?? l.kind, text: l.text })));
      pairs.forEach((j, i) => {
        if (j >= 0) own[j].el = dom[i].el;
      });
      // 남은 것은 같은 종류끼리 차례대로
      const restDom = dom.filter((_, i) => pairs[i] < 0);
      for (const l of own.filter((x) => !x.el)) {
        const k = restDom.findIndex((d) => d.kind === l.srcKind);
        if (k >= 0) l.el = restDom.splice(k, 1)[0].el;
      }
    }
    t.key = topKey(t.container);
  }
  for (const l of leaves) {
    if (l.el) {
      l.key = leafKey(l.el, l.kind);
      l.visible = visibleText(l.el, l.kind);
    } else {
      // 렌더링이 없는 잎(정의·HTML 주석) 또는 요소를 못 찾은 잎 — 블록 전체 렌더링으로 비교한다
      l.key = l.srcKind ? `missing:${l.text}` : sortedTops[l.top].key;
      l.visible = (sortedTops[l.top].container.textContent ?? '').trim();
    }
    if (l.el) l.el.setAttribute(LEAF_ATTR, String(l.index));
  }

  // 6. 각주 — 플러그인이 모은 각주 목록에서 이름으로 내용을 찾는다
  const rendered = new Map<string, string>();
  for (let i = 0; i < footnoteTokens.length; i++) {
    if (footnoteTokens[i].type !== 'footnote_open') continue;
    const label = String((footnoteTokens[i].meta as { label?: string }).label ?? '').toLowerCase();
    let j = i + 1;
    while (j < footnoteTokens.length && footnoteTokens[j].type !== 'footnote_close') j++;
    if (!rendered.has(label)) rendered.set(label, md.renderer.render(footnoteTokens.slice(i + 1, j), md.options, env));
    i = j;
  }
  const footnotes: LeafUnit[] = footBlocks
    .map((b) => {
      const label = (lines[b.start - 1].match(FOOTNOTE_DEF)?.[1] ?? '').toLowerCase();
      const html = rendered.get(label);
      let el: HTMLElement | null = null;
      if (b.footnote! >= 0 && html !== undefined) {
        el = fragment(`<li id="user-content-fn-${escapeHtml(label)}">${html}</li>`).firstElementChild as HTMLElement;
      }
      const range = { start: b.start, end: b.end };
      return {
        index: -1,
        kind: 'footnote' as const,
        srcKind: b.kind,
        range,
        text: b.text,
        top: -1,
        el,
        key: el ? leafKey(el, 'footnote') : '',
        visible: el ? visibleText(el, 'footnote') : '',
        source: sourceOf(lines, range),
        headingPath: [],
        footnote: b.footnote,
        label,
      };
    })
    .sort((a, b) => (a.footnote! < 0 ? 1 : 0) - (b.footnote! < 0 ? 1 : 0) || a.footnote! - b.footnote! || a.range.start - b.range.start);
  footnotes.forEach((f, k) => {
    f.index = leaves.length + k;
    f.el?.setAttribute(LEAF_ATTR, String(f.index));
  });

  // 7. 제목 경로 — 원문 순서로 앞 제목들의 경로(같거나 깊은 단계는 닫는다)
  const stack: Array<{ level: number; text: string }> = [];
  for (const l of [...leaves, ...footnotes].sort((a, b) => a.range.start - b.range.start)) {
    if (l.kind !== 'heading') {
      l.headingPath = stack.map((s) => s.text);
      continue;
    }
    const level = l.el ? Number(l.el.tagName.slice(1)) || 1 : 1;
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    l.headingPath = stack.map((s) => s.text);
    stack.push({ level, text: l.text.trim() });
  }

  return { text, lines, tops: sortedTops, leaves, footnotes };
}

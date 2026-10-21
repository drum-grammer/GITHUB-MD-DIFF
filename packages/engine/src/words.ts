/**
 * 블록 안 단어 비교(스펙 §4-2 6) — 렌더링된 인라인 HTML을 글 조각과 원자 요소로 나눠 비교한다(htmldiff 방식).
 * 비교 단위는 공백이 아닌 모든 조각(낱말·문장부호·기호·이모지). 낱말 경계는 Intl.Segmenter(word).
 * <ins>·<del>은 글 조각마다 감싸 태그 경계를 넘지 않고, 지운 낱말은 옛 쪽 서식 태그 안에 둔다
 */
import { ELEMENT_NODE, TEXT_NODE, escapeHtml } from './dom';
import { ITEM_NESTED } from './keys';
import type { Kind, WordOp } from './types';

const SEGMENTER = new Intl.Segmenter('und', { granularity: 'word' });
/** 쪼개지 않고 통째로 비교하는 요소 — math-renderer는 확장 빌드의 수식 표기(src/engine-math.ts, TeX 원문을 GitHub 페이지가 그린다) */
const ATOMIC = 'span.katex, math-renderer, img, input, sup.footnote-ref, br, svg, a[data-footnote-backref]';
/** 단어 표의 칸 수 상한 — 넘으면 단어 표시 없이 통째로 */
export const WORD_MAX_CELLS = 4_000_000;

interface Unit {
  /** 비교 열쇠 — 서식 태그 이름 사슬 + 글(또는 원자 요소 HTML) */
  key: string;
  /** 서식 태그 사슬(바깥부터). 잎 요소 자신은 빼고 */
  chain: Element[];
  /** 앞 공백(없으면 '') */
  lead: string;
  text: string;
  atomic: Element | null;
}

export interface WordDiff {
  ops: WordOp[];
  /** 바뀐 단위 수 / 양쪽 단위 수 */
  ratio: number;
  /** 잎 요소 안쪽에 넣을 HTML(새 쪽 서식 + ins/del) */
  html: string;
}

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();
const startTag = (el: Element): string => `<${el.tagName.toLowerCase()}${[...el.attributes].map((a) => ` ${a.name}="${escapeHtml(a.value)}"`).join('')}>`;

function units(root: Element, kind: Kind): Unit[] {
  const out: Unit[] = [];
  let lead = '';
  const itemLike = kind === 'item' || kind === 'footnote';
  const walk = (node: Node, chain: Element[]): void => {
    for (const child of node.childNodes) {
      if (child.nodeType === TEXT_NODE) {
        for (const s of SEGMENTER.segment(child.nodeValue ?? '')) {
          if (/^\s+$/u.test(s.segment)) {
            lead = ' ';
            continue;
          }
          out.push({ key: `${chain.map((e) => e.tagName).join('>')}\u0001${s.segment}`, chain, lead, text: s.segment, atomic: null });
          lead = '';
        }
        continue;
      }
      if (child.nodeType !== ELEMENT_NODE) continue;
      const el = child as Element;
      if (itemLike && ITEM_NESTED.has(el.tagName)) continue; // 안쪽 목록·코드·표·인용문은 다른 잎
      if (el.matches(ATOMIC)) {
        out.push({ key: `${chain.map((e) => e.tagName).join('>')}\u0002${squash(el.outerHTML)}`, chain, lead, text: '', atomic: el });
        lead = '';
        continue;
      }
      if (itemLike && el.tagName === 'P' && el.parentNode === root) {
        // 느슨한 목록의 문단 껍데기 — 문단 경계는 공백 하나
        walk(el, chain);
        lead = ' ';
        continue;
      }
      walk(el, [...chain, el]);
    }
  };
  walk(root, []);
  return out;
}

type Step = { op: 'same' | 'ins' | 'del'; unit: Unit };

/** 열쇠의 최장 공통 부분열로 연산을 만든다 — 앞뒤 공통 부분을 먼저 뗀다. 표가 너무 크면 null */
function steps(a: Unit[], b: Unit[]): Step[] | null {
  let start = 0;
  while (start < a.length && start < b.length && a[start].key === b[start].key) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1].key === b[endB - 1].key) {
    endA--;
    endB--;
  }
  const n = endA - start;
  const m = endB - start;
  if (n * m > WORD_MAX_CELLS) return null;
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[start + i].key === b[start + j].key ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  const out: Step[] = [];
  for (let k = 0; k < start; k++) out.push({ op: 'same', unit: b[k] });
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[start + i].key === b[start + j].key) {
      out.push({ op: 'same', unit: b[start + j] });
      i++;
      j++;
    } else if (j >= m || (i < n && dp[(i + 1) * w + j] >= dp[i * w + j + 1])) {
      out.push({ op: 'del', unit: a[start + i] });
      i++;
    } else {
      out.push({ op: 'ins', unit: b[start + j] });
      j++;
    }
  }
  for (let k = endB; k < b.length; k++) out.push({ op: 'same', unit: b[k] });
  return out;
}

/** 연산을 HTML로 — 서식 태그는 여는 태그 글자가 같으면 이어 쓰고, 표시(ins/del)는 사슬 가장 안쪽에 둔다 */
function render(list: Step[]): string {
  let html = '';
  const open: Element[] = [];
  let mark: 'ins' | 'del' | null = null;
  /** 방금 닫은 지움 묶음의 앞 공백 — 바로 이어지는 넣음 묶음은 같은 공백을 다시 쓰지 않는다("<del>3</del> <ins>4</ins>"의 겹 공백) */
  let delLead: string | null = null;
  let runLead = '';
  const closeMark = (): void => {
    if (mark) html += `</${mark}>`;
    delLead = mark === 'del' ? runLead : null;
    mark = null;
  };
  for (const { op, unit } of list) {
    const want = op === 'same' ? null : op;
    let k = 0;
    while (k < open.length && k < unit.chain.length && startTag(open[k]) === startTag(unit.chain[k])) k++;
    if (k !== open.length || k !== unit.chain.length || want !== mark) closeMark();
    else delLead = null;
    while (open.length > k) html += `</${open.pop()!.tagName.toLowerCase()}>`;
    const skipLead = want === 'ins' && mark === null && delLead !== null && delLead === unit.lead;
    if (mark === null) runLead = unit.lead;
    if (!skipLead) html += unit.lead;
    delLead = null;
    for (let i = k; i < unit.chain.length; i++) {
      html += startTag(unit.chain[i]);
      open.push(unit.chain[i]);
    }
    if (want && mark !== want) {
      html += `<${want}>`;
      mark = want;
    }
    html += unit.atomic ? unit.atomic.outerHTML : escapeHtml(unit.text);
  }
  closeMark();
  while (open.length) html += `</${open.pop()!.tagName.toLowerCase()}>`;
  return html;
}

/** 모델용 — 같은 연산이 이어진 것을 한 조각으로(서식 태그 없이 글과 원자 요소만) */
function runs(list: Step[]): WordOp[] {
  const out: WordOp[] = [];
  for (const { op, unit } of list) {
    const piece = unit.lead + (unit.atomic ? unit.atomic.outerHTML : escapeHtml(unit.text));
    const last = out[out.length - 1];
    if (last && last.op === op) last.html += piece;
    else out.push({ op, html: piece });
  }
  return out;
}

/** 옛·새 잎 요소의 단어 비교. 표가 너무 크면 null(통째로 낸다) */
export function wordDiff(oldEl: Element, newEl: Element, kind: Kind): WordDiff | null {
  const a = units(oldEl, kind);
  const b = units(newEl, kind);
  const list = steps(a, b);
  if (!list) return null;
  const changed = list.filter((s) => s.op !== 'same').length;
  const total = a.length + b.length;
  return { ops: runs(list), ratio: total ? changed / total : 0, html: render(list) };
}
